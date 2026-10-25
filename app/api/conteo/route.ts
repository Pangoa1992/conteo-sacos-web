import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos, reportesContratista } from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { compararSecreto, extraerBearer } from "@/lib/seguridad";
import { esOrigenPrueba } from "@/lib/conteos";

// Cantidad de conteos que devuelve GET (por defecto y máximo).
const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 200;

// Longitud mínima aceptada para VISION_API_TOKEN.
const LONGITUD_MINIMA_TOKEN = 32;

// Margen para relojes desajustados y antigüedad máxima aceptada de contadoEn.
const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const ANTIGUEDAD_MAXIMA_MS = 30 * 24 * 3600_000;

// Esquema de validación de lo que envía el módulo de visión (Python).
// Cada envío es un lote terminado, identificado por idExterno.
const conteoInputSchema = z.object({
  idExterno: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "8-64 caracteres: letras, números, '-' o '_'"),
  cantidadSacos: z.number().int().nonnegative(),
  origen: z.enum(["vision_ip", "prueba_vision"]).default("vision_ip"),
  // Identificador de la cámara (p. ej. camara_poza_1), nunca la ruta de un video.
  fuenteCamara: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Identificador de cámara: letras, números, '-' o '_' (máx. 100)").nullish(),
  // null cuando el detector no pudo calcularla; no se inventa un valor.
  confianzaPromedio: z.number().min(0).max(100).nullish(),
  // Fecha real del conteo en el detector, ISO 8601 con zona (p. ej. ...Z).
  contadoEn: z.string().datetime({ offset: true }),
});

// A partir de esta diferencia entre el conteo automático y el reporte
// del contratista, se marca como discrepancia (alerta) — Fase 2.
const UMBRAL_DISCREPANCIA = 1;

/**
 * GET /api/conteo
 * Devuelve los últimos conteos registrados, junto con el reporte del
 * contratista (si existe) y si hay discrepancia entre ambos, para que
 * el dashboard muestre la alerta correspondiente.
 *
 * Parámetro opcional ?limite=N (1–200, por defecto 20).
 * Cada conteo incluye esPrueba (origen "prueba*") para que el dashboard
 * nunca mezcle datos de prueba con producción real, y fechaConteo: la
 * fecha real del lote (contadoEn) o, si no la tiene, la de recepción. Si hay varios
 * reportes de contratista para un conteo, se usa el más reciente.
 *
 * NOTA: si la base de datos no está configurada, se devuelven datos
 * simulados (mock) marcados con modoSimulado: true.
 */
export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      modoSimulado: true,
      conteos: MOCK_CONTEOS,
    });
  }

  const limiteParam = Number(req.nextUrl.searchParams.get("limite"));
  const limite = Number.isInteger(limiteParam) && limiteParam > 0
    ? Math.min(limiteParam, LIMITE_MAXIMO)
    : LIMITE_POR_DEFECTO;

  // Orden por fecha real del lote (contado_en); los registros antiguos sin
  // ella usan la fecha de recepción.
  const ultimos = await db
    .select()
    .from(conteos)
    .orderBy(desc(sql`coalesce(${conteos.contadoEn}, ${conteos.creadoEn})`), desc(conteos.id))
    .limit(limite);

  // Una sola consulta para todos los reportes (antes: una por conteo).
  const reportes = ultimos.length
    ? await db
        .select()
        .from(reportesContratista)
        .where(inArray(reportesContratista.conteoId, ultimos.map((c) => c.id)))
        .orderBy(asc(reportesContratista.id))
    : [];
  const reportePorConteo = new Map(reportes.map((r) => [r.conteoId, r])); // queda el más reciente

  const conteosConAlerta = ultimos.map((c) => {
    const reporte = reportePorConteo.get(c.id);
    const discrepancia = reporte
      ? Math.abs(reporte.cantidadReportada - c.cantidadSacos) > UMBRAL_DISCREPANCIA
      : false;

    return {
      ...c,
      fechaConteo: c.contadoEn ?? c.creadoEn,
      esPrueba: esOrigenPrueba(c.origen),
      reporteContratista: reporte
        ? { cantidadReportada: reporte.cantidadReportada, nombreContratista: reporte.nombreContratista }
        : null,
      discrepancia,
    };
  });

  return NextResponse.json({ modoSimulado: false, conteos: conteosConAlerta });
}

/**
 * POST /api/conteo
 * Endpoint que consume el módulo de Python (api_cliente.py) cada vez
 * que termina de procesar un lote de video y obtiene un conteo.
 *
 * Idempotente por idExterno:
 *   201 lote nuevo registrado.
 *   200 el mismo lote ya estaba registrado con los mismos datos (reintento).
 *   409 el idExterno ya existe con datos distintos (no se acepta).
 *   400 datos inválidos · 401 token · 503 error temporal (reintentar).
 *
 * Seguridad: exige SIEMPRE el token compartido (VISION_API_TOKEN) en el
 * header "Authorization: Bearer <token>", para que solo el módulo de
 * visión pueda escribir conteos. Si VISION_API_TOKEN no está configurado
 * en el servidor, se rechaza la operación (no se aceptan conteos sin
 * autenticar ni siquiera en desarrollo).
 */
export async function POST(req: NextRequest) {
  const tokenEsperado = process.env.VISION_API_TOKEN;

  if (!tokenEsperado || tokenEsperado.length < LONGITUD_MINIMA_TOKEN) {
    console.error("[conteo] VISION_API_TOKEN no configurado o demasiado corto: registro de conteos deshabilitado.");
    return NextResponse.json({ error: "Registro de conteos no disponible" }, { status: 503 });
  }

  const tokenRecibido = extraerBearer(req.headers.get("authorization"));
  if (!tokenRecibido || !compararSecreto(tokenRecibido, tokenEsperado)) {
    return NextResponse.json({ error: "Token inválido o faltante" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = conteoInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const contadoEn = new Date(parsed.data.contadoEn);
  const ahora = Date.now();
  if (contadoEn.getTime() > ahora + TOLERANCIA_FUTURO_MS || contadoEn.getTime() < ahora - ANTIGUEDAD_MAXIMA_MS) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: { fieldErrors: { contadoEn: ["Fecha fuera del rango aceptado (futura o de hace más de 30 días)"] } } },
      { status: 400 }
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { modoSimulado: true, recibido: parsed.data },
      { status: 201 }
    );
  }

  // numeric(5,2): se redondea aquí para que lo guardado y lo comparado
  // en un reintento sean exactamente el mismo valor.
  const valores = {
    idExterno: parsed.data.idExterno,
    cantidadSacos: parsed.data.cantidadSacos,
    origen: parsed.data.origen,
    fuenteCamara: parsed.data.fuenteCamara ?? null,
    confianzaPromedio: parsed.data.confianzaPromedio == null ? null : parsed.data.confianzaPromedio.toFixed(2),
    contadoEn,
  };

  try {
    // La restricción UNIQUE de id_externo hace la idempotencia en PostgreSQL:
    // ante dos envíos simultáneos del mismo lote solo uno inserta y el otro
    // espera a que termine y no inserta nada.
    const [nuevo] = await db.insert(conteos).values(valores)
      .onConflictDoNothing({ target: conteos.idExterno })
      .returning();
    if (nuevo) {
      return NextResponse.json(nuevo, { status: 201 });
    }

    const [existente] = await db.select().from(conteos).where(eq(conteos.idExterno, valores.idExterno)).limit(1);
    if (!existente) {
      // No debería ocurrir (UNIQUE no se borra); se trata como error temporal.
      throw new Error("conflicto de id_externo sin registro existente");
    }

    const camposDistintos = camposDiferentes(existente, valores);
    if (camposDistintos.length > 0) {
      return NextResponse.json(
        { error: "id_externo ya registrado con datos distintos", idExterno: valores.idExterno, camposDistintos },
        { status: 409 }
      );
    }
    return NextResponse.json({ ...existente, duplicado: true }, { status: 200 });
  } catch (err) {
    console.error("[conteo] Error de base de datos al registrar el conteo:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Base de datos no disponible temporalmente" }, { status: 503 });
  }
}

/** Campos en los que el registro guardado difiere del reenvío del mismo lote. */
function camposDiferentes(
  existente: typeof conteos.$inferSelect,
  recibido: { cantidadSacos: number; origen: string; fuenteCamara: string | null; confianzaPromedio: string | null; contadoEn: Date }
): string[] {
  const distintos: string[] = [];
  const confianzaGuardada = existente.confianzaPromedio == null ? null : Number(existente.confianzaPromedio).toFixed(2);
  if (existente.cantidadSacos !== recibido.cantidadSacos) distintos.push("cantidadSacos");
  if (existente.origen !== recibido.origen) distintos.push("origen");
  if ((existente.fuenteCamara ?? null) !== recibido.fuenteCamara) distintos.push("fuenteCamara");
  if (confianzaGuardada !== recibido.confianzaPromedio) distintos.push("confianzaPromedio");
  if (existente.contadoEn?.getTime() !== recibido.contadoEn.getTime()) distintos.push("contadoEn");
  return distintos;
}

// Datos de ejemplo para poder ver el dashboard funcionando
// mientras no se conecta la cámara real ni la base de datos.
const MOCK_CONTEOS = [
  { id: 1, cantidadSacos: 118, fuenteCamara: "camara_poza_1", confianzaPromedio: 96.4, creadoEn: new Date().toISOString(), reporteContratista: { cantidadReportada: 120, nombreContratista: "Juan Pérez" }, discrepancia: true },
  { id: 2, cantidadSacos: 104, fuenteCamara: "camara_poza_1", confianzaPromedio: 94.1, creadoEn: new Date(Date.now() - 3600_000).toISOString(), reporteContratista: null, discrepancia: false },
  { id: 3, cantidadSacos: 97, fuenteCamara: "camara_poza_1", confianzaPromedio: 95.8, creadoEn: new Date(Date.now() - 7200_000).toISOString(), reporteContratista: { cantidadReportada: 97, nombreContratista: "Juan Pérez" }, discrepancia: false },
];