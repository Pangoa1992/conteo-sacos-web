import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos, reportesContratista, usuarios, validacionesConteo } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";
import {
  ESTADOS_VALIDACION,
  LONGITUD_MAXIMA_OBSERVACION,
  erroresValidacion,
  hayDiscrepancia,
} from "@/lib/conteos";
import { errorValidacionConVentas, esRechazoDeVentaEnBD } from "@/lib/ventas";
import { sacosVendidosActivos } from "@/lib/ventas-servidor";

const cantidad = z.number().int().nonnegative();

const validacionSchema = z.object({
  estado: z.enum(["aprobado", "observado", "rechazado"]),
  // Clasificación manual por estado físico; null cuando no se clasifica.
  clasificacion: z.object({ conformes: cantidad, observados: cantidad, defectuosos: cantidad }).nullish(),
  observacion: z.string().max(LONGITUD_MAXIMA_OBSERVACION).nullish(),
  // Estado que la persona veía al revisar: si otro usuario lo cambió entretanto, 409.
  estadoEsperado: z.enum(ESTADOS_VALIDACION),
});

/** Error de negocio que termina la transacción con una respuesta concreta. */
class Rechazo extends Error {
  constructor(public status: number, public cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error));
  }
}

function leerId(param: string): number | null {
  const id = Number(param);
  return /^\d{1,9}$/.test(param) && id > 0 ? id : null;
}

/**
 * GET /api/conteo/:id/validacion
 * Historial de revisiones del conteo, de la más reciente a la más antigua.
 * Lo pueden ver todos los usuarios con sesión (middleware).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = leerId(params.id);
  if (!id) {
    return NextResponse.json({ error: "Identificador de conteo inválido" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, historial: [] });
  }

  const [conteo] = await db.select({ id: conteos.id }).from(conteos).where(eq(conteos.id, id)).limit(1);
  if (!conteo) {
    return NextResponse.json({ error: "El conteo indicado no existe" }, { status: 404 });
  }

  const historial = await db
    .select({
      id: validacionesConteo.id,
      estadoAnterior: validacionesConteo.estadoAnterior,
      estado: validacionesConteo.estado,
      sacosConformes: validacionesConteo.sacosConformes,
      sacosObservados: validacionesConteo.sacosObservados,
      sacosDefectuosos: validacionesConteo.sacosDefectuosos,
      observacion: validacionesConteo.observacion,
      usuarioNombre: usuarios.nombre,
      creadoEn: validacionesConteo.creadoEn,
    })
    .from(validacionesConteo)
    .leftJoin(usuarios, eq(validacionesConteo.usuarioId, usuarios.id))
    .where(eq(validacionesConteo.conteoId, id))
    .orderBy(desc(validacionesConteo.id));

  return NextResponse.json({ modoSimulado: false, historial });
}

/**
 * PATCH /api/conteo/:id/validacion
 * El personal de MACROMEC (admin_macromec) aprueba, observa o rechaza un
 * conteo y, si corresponde, registra la clasificación manual de los sacos.
 * Actualiza el estado vigente en conteos y agrega una fila al historial en
 * la misma transacción. No modifica la cantidad detectada.
 *
 *   200 validación registrada · 400 datos incoherentes · 401/403 sesión o rol
 *   404 conteo inexistente · 409 el estado cambió desde que se abrió la revisión
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const id = leerId(params.id);
  if (!id) {
    return NextResponse.json({ error: "Identificador de conteo inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = validacionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const { estado, estadoEsperado } = parsed.data;
  const clasificacion = parsed.data.clasificacion ?? null;
  const observacion = parsed.data.observacion?.trim() ?? "";

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, recibido: parsed.data });
  }

  try {
    const actualizado = await db.transaction(async (tx) => {
      // FOR UPDATE: dos revisiones simultáneas del mismo conteo se hacen una tras otra.
      const [conteo] = await tx.select().from(conteos).where(eq(conteos.id, id)).for("update");
      if (!conteo) {
        throw new Rechazo(404, { error: "El conteo indicado no existe" });
      }
      if (conteo.estadoValidacion !== estadoEsperado) {
        throw new Rechazo(409, {
          error: "Otro usuario cambió la validación de este conteo. Actualice la página y revise de nuevo.",
          estadoActual: conteo.estadoValidacion,
        });
      }

      // Mismo criterio que el dashboard: el reporte más reciente del contratista.
      const [reporte] = await tx
        .select({ cantidadReportada: reportesContratista.cantidadReportada })
        .from(reportesContratista)
        .where(eq(reportesContratista.conteoId, id))
        .orderBy(desc(reportesContratista.id))
        .limit(1);

      const errores = erroresValidacion({
        estado,
        clasificacion,
        observacion,
        cantidadSacos: conteo.cantidadSacos,
        conDiscrepancia: reporte ? hayDiscrepancia(reporte.cantidadReportada, conteo.cantidadSacos) : false,
      });
      if (errores.length > 0) {
        throw new Rechazo(400, { error: "Validación incoherente", errores });
      }

      // Ventas activas del lote: la nueva validación debe seguir respaldándolas
      // (el trigger conteos_proteger_ventas lo vuelve a comprobar en la BD).
      const errorVentas = errorValidacionConVentas(await sacosVendidosActivos(tx, id), estado, clasificacion?.conformes ?? null);
      if (errorVentas) {
        throw new Rechazo(409, { error: "El lote tiene ventas activas", errores: [errorVentas] });
      }

      const valores = {
        sacosConformes: clasificacion?.conformes ?? null,
        sacosObservados: clasificacion?.observados ?? null,
        sacosDefectuosos: clasificacion?.defectuosos ?? null,
      };

      const [nuevo] = await tx
        .update(conteos)
        .set({
          estadoValidacion: estado,
          ...valores,
          observacionValidacion: observacion || null,
          validadoPor: usuario.id,
          validadoEn: new Date(),
        })
        .where(eq(conteos.id, id))
        .returning();

      await tx.insert(validacionesConteo).values({
        conteoId: id,
        estadoAnterior: conteo.estadoValidacion,
        estado,
        ...valores,
        observacion: observacion || null,
        usuarioId: usuario.id,
      });

      return nuevo;
    });

    return NextResponse.json(actualizado);
  } catch (err) {
    if (err instanceof Rechazo) {
      return NextResponse.json(err.cuerpo, { status: err.status });
    }
    const rechazoVenta = esRechazoDeVentaEnBD(err);
    if (rechazoVenta) {
      return NextResponse.json({ error: "El lote tiene ventas activas", errores: [rechazoVenta] }, { status: 409 });
    }
    console.error("[validacion] Error al registrar la validación:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo registrar la validación" }, { status: 503 });
  }
}
