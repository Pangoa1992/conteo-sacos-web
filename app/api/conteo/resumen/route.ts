import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos } from "@/db/schema";
import { sql } from "drizzle-orm";
import { ZONA_HORARIA_PLANTA, type EstadoValidacion } from "@/lib/conteos";

// Sin esto, Next 14 trata este GET (no lee la petición) como estático y en el
// build lo congela con los datos de ese momento.
export const dynamic = "force-dynamic";

// Días que cubre la serie de producción diaria (incluido hoy).
const DIAS_SERIE = 14;

// La producción se agrupa por la fecha real del lote (contado_en); los
// registros antiguos sin ella usan la de recepción (creado_en). Ambas son
// "timestamp" sin zona guardadas en UTC; se convierten a la hora de la planta.
const FECHA_CONTEO = sql`coalesce(${conteos.contadoEn}, ${conteos.creadoEn})`;
const FECHA_PLANTA = sql`((${FECHA_CONTEO} at time zone 'UTC') at time zone ${sql.raw(`'${ZONA_HORARIA_PLANTA}'`)})::date`;
const HOY_PLANTA = sql`(now() at time zone ${sql.raw(`'${ZONA_HORARIA_PLANTA}'`)})::date`;
const ES_PRUEBA = sql`(lower(${conteos.origen}) like 'prueba%')`;

// Columnas de producción validada (etapa 3A). La clasificación manual solo se
// suma en lotes aprobados; el total detectado por la IA se suma en todos.
const SOLO_APROBADOS = sql`filter (where ${conteos.estadoValidacion} = 'aprobado')`;
const COLUMNAS_VALIDACION = {
  esPrueba: sql<boolean>`${ES_PRUEBA}`,
  estado: sql<EstadoValidacion>`${conteos.estadoValidacion}`,
  registros: sql<number>`count(*)::int`,
  totalSacos: sql<number>`coalesce(sum(${conteos.cantidadSacos}), 0)::int`,
  sacosConformes: sql<number>`coalesce(sum(${conteos.sacosConformes}) ${SOLO_APROBADOS}, 0)::int`,
  sacosObservados: sql<number>`coalesce(sum(${conteos.sacosObservados}) ${SOLO_APROBADOS}, 0)::int`,
  sacosDefectuosos: sql<number>`coalesce(sum(${conteos.sacosDefectuosos}) ${SOLO_APROBADOS}, 0)::int`,
};

/**
 * GET /api/conteo/resumen
 * Indicadores agregados para el dashboard (solo lectura, requiere sesión
 * vía middleware). Separa SIEMPRE los datos reales de los de prueba:
 *   - hoy: fecha de la planta (America/Lima).
 *   - diario: total de sacos y nº de registros por día, últimos 14 días.
 *   - fuentes: último conteo (fecha real) de cada cámara/origen.
 *   - diarioPorEstado: lo mismo que diario, separado por estado de validación
 *     y con la clasificación manual de los lotes aprobados.
 *   - validacion: totales por estado de todo el historial (producción validada).
 * No calcula ni estima nada que no esté en la base de datos.
 */
export async function GET(_req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, hoy: null, diario: [], diarioPorEstado: [], validacion: [], fuentes: [] });
  }

  const [{ hoy }] = await db.execute<{ hoy: string }>(sql`select ${HOY_PLANTA}::text as hoy`);

  const diario = await db
    .select({
      fecha: sql<string>`${FECHA_PLANTA}::text`,
      esPrueba: sql<boolean>`${ES_PRUEBA}`,
      totalSacos: sql<number>`coalesce(sum(${conteos.cantidadSacos}), 0)::int`,
      registros: sql<number>`count(*)::int`,
    })
    .from(conteos)
    .where(sql`${FECHA_PLANTA} > ${HOY_PLANTA} - ${DIAS_SERIE}::int`)
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`);

  const diarioPorEstado = await db
    .select({ fecha: sql<string>`${FECHA_PLANTA}::text`, ...COLUMNAS_VALIDACION })
    .from(conteos)
    .where(sql`${FECHA_PLANTA} > ${HOY_PLANTA} - ${DIAS_SERIE}::int`)
    .groupBy(sql`1`, sql`2`, sql`3`)
    .orderBy(sql`1`, sql`2`, sql`3`);

  const validacion = await db
    .select(COLUMNAS_VALIDACION)
    .from(conteos)
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`, sql`2`);

  const fuentes = await db
    .select({
      fuenteCamara: conteos.fuenteCamara,
      esPrueba: sql<boolean>`${ES_PRUEBA}`,
      // ISO 8601 en UTC (con "Z") para que el navegador lo convierta bien a hora local.
      ultimoRegistro: sql<string>`to_char(max(${FECHA_CONTEO}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      registros: sql<number>`count(*)::int`,
    })
    .from(conteos)
    .groupBy(conteos.fuenteCamara, sql`2`)
    .orderBy(sql`max(${FECHA_CONTEO}) desc`);

  return NextResponse.json({
    modoSimulado: false,
    zonaHoraria: ZONA_HORARIA_PLANTA,
    hoy,
    diasSerie: DIAS_SERIE,
    diario,
    diarioPorEstado,
    validacion,
    fuentes,
  });
}
