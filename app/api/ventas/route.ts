import { NextRequest, NextResponse } from "next/server";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { db } from "@/db";
import { ventas, ventasLote, conteos, usuarios } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { esOrigenPrueba } from "@/lib/conteos";
import { LONGITUD_MAXIMA_COMPRADOR, calcularImporte, esRechazoDeVentaEnBD, precioEnCentimos } from "@/lib/ventas";
import { sacosVendidosActivos } from "@/lib/ventas-servidor";

// Filas que devuelve GET de cada lista.
const LIMITE_LISTA = 200;

const ventaInputSchema = z.object({
  conteoId: z.number().int().positive(),
  cantidadSacos: z.number().int().positive().max(1_000_000),
  // Precio por saco en soles, con 2 decimales como máximo.
  precioUnitario: z.number().refine((v) => precioEnCentimos(v) !== null, "Precio mayor que 0 y con 2 decimales como máximo"),
  comprador: z.string().max(LONGITUD_MAXIMA_COMPRADOR).nullish(),
  // Una por operación; el navegador la repite al reintentar la misma venta.
  claveIdempotencia: z.string().uuid(),
});

/** Campos en los que la venta guardada con esa clave difiere de la solicitud. */
function camposDistintos(
  existente: typeof ventasLote.$inferSelect,
  solicitud: { conteoId: number; cantidadSacos: number; precioUnitario: string; comprador: string | null; registradaPor: number }
): string[] {
  const distintos: string[] = [];
  if (existente.conteoId !== solicitud.conteoId) distintos.push("conteoId");
  if (existente.cantidadSacos !== solicitud.cantidadSacos) distintos.push("cantidadSacos");
  if (Number(existente.precioUnitario).toFixed(2) !== solicitud.precioUnitario) distintos.push("precioUnitario");
  if ((existente.comprador ?? null) !== solicitud.comprador) distintos.push("comprador");
  if (existente.registradaPor !== solicitud.registradaPor) distintos.push("usuario");
  return distintos;
}

/** Error de negocio que termina la transacción con una respuesta concreta. */
class Rechazo extends Error {
  constructor(public status: number, public cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error));
  }
}

async function usuarioAdmin(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return { respuesta: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (usuario.rol !== "admin_macromec") return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  return { usuario };
}

// Fecha real del lote; "timestamp" sin zona guardado en UTC: se entrega en
// ISO 8601 con "Z" para que el navegador lo convierta bien a hora local.
const FECHA_CONTEO_BD = sql`coalesce(${conteos.contadoEn}, ${conteos.creadoEn})`;
const FECHA_CONTEO = sql<string>`to_char(${FECHA_CONTEO_BD}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
// Columna calificada a mano: con una sola tabla en el FROM, drizzle escribe
// ${conteos.id} como "id" y dentro de la subconsulta se leería v.id.
const VENDIDOS_ACTIVOS = sql<number>`(select coalesce(sum(v.cantidad_sacos), 0)::int from ventas_lote v
  where v.conteo_id = "conteos"."id" and v.anulada_en is null)`;

/**
 * GET /api/ventas
 * Solo personal de MACROMEC (admin_macromec); el cliente no ve ventas.
 *   - ventas: ventas parciales (activas y anuladas) con quién las registró o anuló.
 *   - lotes: lotes aprobados con sus conformes, lo vendido y lo disponible.
 *   - historicas: ventas anteriores al control de validación (solo lectura,
 *     no cuentan para el stock).
 */
export async function GET(req: NextRequest) {
  const { usuario, respuesta } = await usuarioAdmin(req);
  if (!usuario) return respuesta;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, ventas: [], lotes: [], historicas: [] });
  }

  const registrador = alias(usuarios, "registrador");
  const anulador = alias(usuarios, "anulador");
  const listaVentas = await db
    .select({
      id: ventasLote.id,
      conteoId: ventasLote.conteoId,
      cantidadSacos: ventasLote.cantidadSacos,
      precioUnitario: ventasLote.precioUnitario,
      importe: ventasLote.importe,
      comprador: ventasLote.comprador,
      registradaEn: ventasLote.registradaEn,
      registradaPorNombre: registrador.nombre,
      anuladaEn: ventasLote.anuladaEn,
      anuladaPorNombre: anulador.nombre,
      motivoAnulacion: ventasLote.motivoAnulacion,
      origenConteo: conteos.origen,
      fechaConteo: FECHA_CONTEO,
    })
    .from(ventasLote)
    .innerJoin(conteos, eq(ventasLote.conteoId, conteos.id))
    .leftJoin(registrador, eq(ventasLote.registradaPor, registrador.id))
    .leftJoin(anulador, eq(ventasLote.anuladaPor, anulador.id))
    .orderBy(desc(ventasLote.registradaEn), desc(ventasLote.id))
    .limit(LIMITE_LISTA);

  const lotes = await db
    .select({
      conteoId: conteos.id,
      cantidadSacos: conteos.cantidadSacos,
      sacosConformes: conteos.sacosConformes,
      vendidos: VENDIDOS_ACTIVOS,
      origen: conteos.origen,
      fuenteCamara: conteos.fuenteCamara,
      fechaConteo: FECHA_CONTEO,
    })
    .from(conteos)
    .where(eq(conteos.estadoValidacion, "aprobado"))
    .orderBy(desc(FECHA_CONTEO_BD), desc(conteos.id))
    .limit(LIMITE_LISTA);

  const historicas = await db
    .select({
      id: ventas.id,
      conteoId: ventas.conteoId,
      precioPorSaco: ventas.precioPorSaco,
      totalVenta: ventas.totalVenta,
      creadoEn: ventas.creadoEn,
      cantidadSacosConteo: conteos.cantidadSacos,
      origenConteo: conteos.origen,
    })
    .from(ventas)
    .leftJoin(conteos, eq(ventas.conteoId, conteos.id))
    .orderBy(desc(ventas.creadoEn))
    .limit(LIMITE_LISTA);

  return NextResponse.json({
    modoSimulado: false,
    ventas: listaVentas.map(({ origenConteo, ...v }) => ({ ...v, esPrueba: esOrigenPrueba(origenConteo) })),
    lotes: lotes.map(({ origen, ...l }) => ({
      ...l,
      disponible: (l.sacosConformes ?? 0) - l.vendidos,
      esPrueba: esOrigenPrueba(origen),
    })),
    historicas: historicas.map(({ origenConteo, ...h }) => ({ ...h, esPrueba: esOrigenPrueba(origenConteo), historica: true })),
  });
}

/**
 * POST /api/ventas
 * Registra una venta PARCIAL de sacos conformes de un lote aprobado. Puede
 * haber varias ventas por lote hasta agotar lo disponible. El importe lo
 * calcula el servidor (cantidad × precio unitario, en céntimos enteros).
 *
 * Idempotente por claveIdempotencia (UUID que genera el navegador por
 * operación y repite en los reintentos):
 *   201 venta registrada.
 *   200 esa clave ya registró una venta con los mismos datos (doble clic o
 *       reintento): se devuelve la venta original, no se crea otra.
 *   409 la clave ya se usó con datos distintos · lote no aprobado · stock insuficiente.
 *   400 datos inválidos · 401/403 sesión o rol · 404 lote inexistente.
 *
 * Concurrencia: el lote se bloquea con FOR UPDATE, así dos ventas
 * simultáneas del mismo lote (incluido un doble clic) se atienden una tras
 * otra; el trigger ventas_lote_validar_stock repite la comprobación de stock
 * dentro de PostgreSQL y la restricción UNIQUE de la clave impide duplicados
 * aunque la misma clave llegue a la vez para lotes distintos.
 */
export async function POST(req: NextRequest) {
  const { usuario, respuesta } = await usuarioAdmin(req);
  if (!usuario) return respuesta;

  const body = await req.json().catch(() => null);
  const parsed = ventaInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const { conteoId, cantidadSacos } = parsed.data;
  const precioCentimos = precioEnCentimos(parsed.data.precioUnitario)!;
  const comprador = parsed.data.comprador?.trim() || null;
  const importe = calcularImporte(cantidadSacos, precioCentimos);
  if (importe === null) {
    return NextResponse.json({ error: "El importe de la venta excede el máximo permitido" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, recibido: { ...parsed.data, importe } }, { status: 201 });
  }

  const { claveIdempotencia } = parsed.data;
  const solicitud = { conteoId, cantidadSacos, precioUnitario: (precioCentimos / 100).toFixed(2), comprador, registradaPor: usuario.id };

  try {
    const resultado = await db.transaction(async (tx) => {
      /** Respuesta para una clave ya usada: la venta original o el rechazo si los datos difieren. */
      async function respuestaClaveUsada(existente: typeof ventasLote.$inferSelect) {
        const distintos = camposDistintos(existente, solicitud);
        if (distintos.length > 0) {
          throw new Rechazo(409, {
            error: "Esta operación de venta ya se registró con otros datos. Recargue la página e intente de nuevo.",
            camposDistintos: distintos,
          });
        }
        const [lote] = await tx.select({ sacosConformes: conteos.sacosConformes }).from(conteos).where(eq(conteos.id, existente.conteoId));
        const disponible = (lote?.sacosConformes ?? 0) - (await sacosVendidosActivos(tx, existente.conteoId));
        return { status: 200, cuerpo: { venta: existente, disponible, duplicado: true } };
      }
      const buscarClave = async () =>
        (await tx.select().from(ventasLote).where(eq(ventasLote.claveIdempotencia, claveIdempotencia)).limit(1))[0];

      // Reintento de una operación ya confirmada: no se vuelve a validar el stock
      // (esos sacos ya los descontó la propia venta).
      const previa = await buscarClave();
      if (previa) return respuestaClaveUsada(previa);

      const [lote] = await tx.select().from(conteos).where(eq(conteos.id, conteoId)).for("update");
      if (!lote) {
        throw new Rechazo(404, { error: "El lote indicado no existe" });
      }
      // Tras esperar el bloqueo del lote, una solicitud gemela (doble clic) ya pudo confirmarse.
      const gemela = await buscarClave();
      if (gemela) return respuestaClaveUsada(gemela);
      if (lote.estadoValidacion !== "aprobado" || lote.sacosConformes === null) {
        throw new Rechazo(409, { error: "Solo se venden sacos conformes de lotes aprobados." });
      }
      const disponible = lote.sacosConformes - (await sacosVendidosActivos(tx, conteoId));
      if (cantidadSacos > disponible) {
        throw new Rechazo(409, {
          error: `Stock insuficiente: el lote #${conteoId} tiene ${disponible} saco${disponible === 1 ? "" : "s"} conforme${disponible === 1 ? "" : "s"} disponible${disponible === 1 ? "" : "s"}.`,
          disponible,
        });
      }

      // ON CONFLICT: la misma clave enviada a la vez para OTRO lote no espera este
      // bloqueo; la restricción UNIQUE deja entrar solo una y la otra se compara.
      const [nueva] = await tx.insert(ventasLote)
        .values({ ...solicitud, importe, claveIdempotencia })
        .onConflictDoNothing({ target: ventasLote.claveIdempotencia })
        .returning();
      if (!nueva) {
        const otra = await buscarClave();
        if (!otra) throw new Error("conflicto de clave_idempotencia sin venta registrada");
        return respuestaClaveUsada(otra);
      }
      return { status: 201, cuerpo: { venta: nueva, disponible: disponible - cantidadSacos } };
    });

    return NextResponse.json(resultado.cuerpo, { status: resultado.status });
  } catch (err) {
    if (err instanceof Rechazo) {
      return NextResponse.json(err.cuerpo, { status: err.status });
    }
    const rechazoVenta = esRechazoDeVentaEnBD(err);
    if (rechazoVenta) {
      return NextResponse.json({ error: rechazoVenta }, { status: 409 });
    }
    console.error("[ventas] Error al registrar la venta:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo registrar la venta" }, { status: 503 });
  }
}
