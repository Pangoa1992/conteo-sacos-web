import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos, reportesContratista } from "@/db/schema";
import { eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { verificarToken, NOMBRE_COOKIE_SESION, usuarioDeSesion } from "@/lib/auth";
import { UMBRAL_DISCREPANCIA, ZONA_HORARIA_PLANTA, ETIQUETA_ESTADO_VALIDACION, fechaHoyPlanta, type EstadoValidacion } from "@/lib/conteos";
import { construirCsv } from "@/lib/inventario";
import {
  SIN_NOMBRE,
  leerFiltrosReportes,
  type FilaContratista,
  type FiltrosReportes,
  type ReporteDetalle,
  type ResumenReportes,
} from "@/lib/reportes-contratista";
import { ordenVigenciaReporteSql } from "@/lib/reportes-contratista-servidor";

export const dynamic = "force-dynamic";

// Filas como máximo en el historial en pantalla (se avisa cuántas se omiten). El CSV
// nunca se exporta parcial: si supera LIMITE_CSV responde 413 y pide acotar el filtro.
const LIMITE_REPORTES = 1000;
const LIMITE_CSV = 20000;
const SIN_CACHE = { "Cache-Control": "private, no-store" };

// Fecha original del conteo (contado_en; los antiguos usan creado_en) en hora de la planta.
const ZONA = sql.raw(`'${ZONA_HORARIA_PLANTA}'`);
const FECHA_CONTEO = sql`coalesce(c.contado_en, c.creado_en)`;
const HORA_PLANTA = sql`((${FECHA_CONTEO} at time zone 'UTC') at time zone ${ZONA})`;
const ES_PRUEBA = sql`(lower(c.origen) like 'prueba%')`;
const ISO = (col: SQL) => sql`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Reportes con su comparación. La vigencia se calcula sobre TODOS los reportes
 * del lote antes de filtrar (el más reciente es el vigente), así un filtro nunca
 * convierte en vigente un reporte reemplazado.
 */
function reportesFiltrados(f: FiltrosReportes): SQL {
  const cs: SQL[] = [sql`true`];
  if (f.tipo === "real") cs.push(sql`not ${ES_PRUEBA}`);
  if (f.tipo === "prueba") cs.push(ES_PRUEBA);
  if (f.desde) cs.push(sql`${HORA_PLANTA}::date >= ${f.desde}::date`);
  if (f.hasta) cs.push(sql`${HORA_PLANTA}::date <= ${f.hasta}::date`);
  if (f.lote !== null) cs.push(sql`r.conteo_id = ${f.lote}`);
  if (f.contratista !== null) cs.push(sql`r.clave = ${f.contratista}`);
  return sql`todos as (
    select r.*, lower(btrim(coalesce(r.nombre_contratista, ''))) as clave,
      row_number() over (partition by r.conteo_id order by ${ordenVigenciaReporteSql("r")}) = 1 as vigente,
      count(*) over (partition by r.conteo_id)::int as reportes_del_lote
    from reportes_contratista r
    where r.conteo_id is not null
  ),
  d as (
    select r.id, r.conteo_id, r.cantidad_reportada, r.nombre_contratista, r.clave, r.creado_en, r.vigente, r.reportes_del_lote,
      c.cantidad_sacos, r.cantidad_reportada - c.cantidad_sacos as diferencia,
      abs(r.cantidad_reportada - c.cantidad_sacos) > ${UMBRAL_DISCREPANCIA} as discrepancia,
      c.estado_validacion, c.sacos_conformes, c.sacos_observados, c.sacos_defectuosos, c.observacion_validacion, c.validado_en,
      ${FECHA_CONTEO} as fecha, ${HORA_PLANTA} as hora_planta, ${ES_PRUEBA} as es_prueba, c.origen, c.fuente_camara
    from todos r join conteos c on c.id = r.conteo_id
    where ${sql.join(cs, sql` and `)}
  )`;
}

/**
 * GET /api/reportes-contratista
 * Historial de reportes del contratista comparados con el conteo de la IA y la
 * validación humana, resumen y totales por contratista. Lectura para cualquier
 * sesión (admin_macromec y cliente); registrar sigue siendo solo del admin (POST).
 *
 * Filtros: contratista (nombre; "-" = sin nombre), lote, desde/hasta (fecha
 * original del conteo, hora de Lima), tipo (real | prueba | todos; por defecto
 * real) y discrepancia (todos | con | sin; solo filtra el historial).
 * Los resúmenes usan solo el reporte VIGENTE de cada lote (el más reciente).
 * ?formato=csv&tabla=reportes|contratistas: CSV completo para Excel (413 si excede).
 *
 *   200 · 400 filtros inválidos · 401 sin sesión · 413 CSV demasiado grande
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });

  const leidos = leerFiltrosReportes(req.nextUrl.searchParams);
  if ("errores" in leidos) {
    return NextResponse.json({ error: "Filtros inválidos", detalles: leidos.errores }, { status: 400, headers: SIN_CACHE });
  }
  const f = leidos.filtros;
  const formato = req.nextUrl.searchParams.get("formato");
  const tabla = req.nextUrl.searchParams.get("tabla") || "reportes";
  if (formato === "csv" && tabla !== "reportes" && tabla !== "contratistas") {
    return NextResponse.json({ error: "Filtros inválidos", detalles: ["«tabla» debe ser reportes o contratistas."] }, { status: 400, headers: SIN_CACHE });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, filtros: f, resumen: null, porContratista: [], reportes: [], contratistas: [] }, { headers: SIN_CACHE });
  }

  const DISCREPANCIA = f.discrepancia === "con" ? sql`and d.discrepancia` : f.discrepancia === "sin" ? sql`and not d.discrepancia` : sql``;
  const seleccionarReportes = async (limite: number) => [...(await db.execute<ReporteDetalle>(sql`
    with ${reportesFiltrados(f)}
    select d.id, d.conteo_id as "conteoId", d.cantidad_reportada as "cantidadReportada", d.nombre_contratista as "nombreContratista",
      d.clave as "contratistaClave", ${ISO(sql`d.creado_en`)} as "registradoEn", d.vigente, d.reportes_del_lote as "reportesDelLote",
      d.cantidad_sacos as "cantidadIA", d.diferencia, d.discrepancia,
      -- La revisión solo se informa en el reporte vigente: un reporte reemplazado ya no cuenta.
      case when d.vigente and d.discrepancia then (case when d.estado_validacion = 'pendiente' then 'pendiente' else 'revisada' end) end as revision,
      d.estado_validacion as "estadoValidacion", d.sacos_conformes as "sacosConformes", d.sacos_observados as "sacosObservados",
      d.sacos_defectuosos as "sacosDefectuosos", d.observacion_validacion as "observacionValidacion",
      ${ISO(sql`d.validado_en`)} as "validadoEn", ${ISO(sql`d.fecha`)} as "fechaConteo",
      to_char(d.hora_planta, 'DD/MM/YYYY HH24:MI') as "fechaHoraPlanta",
      to_char((d.creado_en at time zone 'UTC') at time zone ${ZONA}, 'DD/MM/YYYY HH24:MI') as "registradoHoraPlanta",
      d.origen, d.fuente_camara as "fuenteCamara", d.es_prueba as "esPrueba"
    from d
    where true ${DISCREPANCIA}
    order by ${ordenVigenciaReporteSql("d")}
    limit ${limite + 1}`))];

  // Un lote cuenta una sola vez: solo su reporte vigente, bajo el contratista de ese reporte.
  const porContratista = [...(await db.execute<FilaContratista>(sql`
    with ${reportesFiltrados(f)}
    select d.clave as "contratistaClave",
      (array_agg(coalesce(nullif(btrim(d.nombre_contratista), ''), ${SIN_NOMBRE}) order by ${ordenVigenciaReporteSql("d")}))[1] as nombre,
      count(*)::int as lotes, sum(d.cantidad_reportada)::int as "sacosReportados", sum(d.cantidad_sacos)::int as "sacosIA",
      sum(d.diferencia)::int as "diferenciaNeta", sum(abs(d.diferencia))::int as "diferenciaAbsoluta",
      count(*) filter (where d.discrepancia)::int as "conDiscrepancia",
      count(*) filter (where d.discrepancia and d.estado_validacion = 'pendiente')::int as pendientes,
      count(*) filter (where d.discrepancia and d.estado_validacion <> 'pendiente')::int as revisadas,
      ${ISO(sql`max(d.creado_en)`)} as "ultimoReporte"
    from d
    where d.vigente
    group by d.clave
    order by "diferenciaAbsoluta" desc, lotes desc, d.clave collate "C"`))];

  if (formato === "csv") {
    let filas: (string | number | null)[][];
    if (tabla === "contratistas") {
      filas = [["Contratista", "Lotes (reporte vigente)", "Sacos reportados", "Sacos IA", "Diferencia neta (reportado - IA)",
        "Diferencia absoluta", "Lotes con discrepancia", "Pendientes de revision", "Revisadas"],
        ...porContratista.map((c) => [c.nombre, c.lotes, c.sacosReportados, c.sacosIA, c.diferenciaNeta, c.diferenciaAbsoluta,
          c.conDiscrepancia, c.pendientes, c.revisadas])];
    } else {
      const reportes = await seleccionarReportes(LIMITE_CSV);
      if (reportes.length > LIMITE_CSV) {
        return NextResponse.json(
          { error: `El filtro incluye más de ${LIMITE_CSV.toLocaleString("es-PE")} reportes: acote las fechas para exportar el CSV completo.`, limite: LIMITE_CSV },
          { status: 413, headers: SIN_CACHE }
        );
      }
      filas = [["Reporte", "Registrado (hora Lima)", "Vigente", "Lote", "Fecha del conteo (hora Lima)", "Tipo", "Origen", "Camara",
        "Contratista", "Sacos reportados", "Sacos IA", "Diferencia (reportado - IA)", `Discrepancia (|dif| > ${UMBRAL_DISCREPANCIA})`,
        "Revision", "Validacion", "Conformes", "Observados", "Defectuosos", "Observacion de la validacion"],
        ...reportes.map((r) => [r.id, r.registradoHoraPlanta, r.vigente ? "Si" : "No (reemplazado)", r.conteoId, r.fechaHoraPlanta,
          r.esPrueba ? "PRUEBA" : "Real", r.origen, r.fuenteCamara, r.nombreContratista?.trim() || SIN_NOMBRE, r.cantidadReportada, r.cantidadIA,
          r.diferencia, r.discrepancia ? "Si" : "No",
          r.revision === null ? "" : r.revision === "pendiente" ? "Pendiente de revision" : "Revisada (lote validado)",
          ETIQUETA_ESTADO_VALIDACION[r.estadoValidacion as EstadoValidacion] ?? r.estadoValidacion,
          r.sacosConformes, r.sacosObservados, r.sacosDefectuosos, r.observacionValidacion])];
    }
    const nombre = `reportes-contratista-${tabla}-${f.tipo}-${fechaHoyPlanta()}.csv`;
    return new NextResponse(construirCsv(filas), {
      headers: {
        ...SIN_CACHE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "X-Total-Filas": String(filas.length - 1),
      },
    });
  }

  const reportes = await seleccionarReportes(LIMITE_REPORTES);
  const truncado = reportes.length > LIMITE_REPORTES;
  if (truncado) reportes.length = LIMITE_REPORTES;

  const [resumen] = await db.execute<ResumenReportes & { totalHistorial: number }>(sql`
    with ${reportesFiltrados(f)}
    select
      count(*) filter (where d.vigente)::int as lotes,
      count(*)::int as reportes,
      count(*) filter (where not d.vigente)::int as reemplazados,
      coalesce(sum(d.cantidad_reportada) filter (where d.vigente), 0)::int as "sacosReportados",
      coalesce(sum(d.cantidad_sacos) filter (where d.vigente), 0)::int as "sacosIA",
      coalesce(sum(d.diferencia) filter (where d.vigente), 0)::int as "diferenciaNeta",
      coalesce(sum(abs(d.diferencia)) filter (where d.vigente), 0)::int as "diferenciaAbsoluta",
      count(*) filter (where d.vigente and d.diferencia = 0)::int as coinciden,
      count(*) filter (where d.vigente and abs(d.diferencia) = 1)::int as "diferenciaDeUno",
      count(*) filter (where d.vigente and d.discrepancia)::int as "conDiscrepancia",
      count(*) filter (where d.vigente and d.discrepancia and d.estado_validacion = 'pendiente')::int as pendientes,
      count(*) filter (where d.vigente and d.discrepancia and d.estado_validacion <> 'pendiente')::int as revisadas,
      (select count(*)::int from d where true ${DISCREPANCIA}) as "totalHistorial"
    from d`);
  const { totalHistorial, ...totales } = resumen;

  // Contratistas para el filtro (de todos los reportes), con la escritura más reciente.
  const contratistas = [...(await db.execute<{ clave: string; nombre: string }>(sql`
    select lower(btrim(coalesce(r.nombre_contratista, ''))) as clave,
      (array_agg(coalesce(nullif(btrim(r.nombre_contratista), ''), ${SIN_NOMBRE}) order by ${ordenVigenciaReporteSql("r")}))[1] as nombre
    from reportes_contratista r group by 1 order by 1`))];

  return NextResponse.json(
    { modoSimulado: false, filtros: f, umbral: UMBRAL_DISCREPANCIA, resumen: totales, porContratista, reportes, truncado, totalHistorial,
      limite: LIMITE_REPORTES, limiteCsv: LIMITE_CSV, contratistas },
    { headers: SIN_CACHE }
  );
}

const reporteSchema = z.object({
  conteoId: z.number().int(),
  cantidadReportada: z.number().int().nonnegative(),
  nombreContratista: z.string().max(150).optional(), // varchar(150) en la BD
});

/**
 * POST /api/reportes-contratista
 * Registra lo que el contratista dice haber armado (cantidad de sacos),
 * para poder compararlo después contra el conteo automático y detectar
 * discrepancias (módulo de alertas — Fase 2).
 * Solo personal de MACROMEC (rol admin_macromec), igual que en el dashboard.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = reporteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, recibido: parsed.data }, { status: 201 });
  }

  const [conteo] = await db.select({ id: conteos.id }).from(conteos).where(eq(conteos.id, parsed.data.conteoId)).limit(1);
  if (!conteo) {
    return NextResponse.json({ error: "El conteo indicado no existe" }, { status: 404 });
  }

  const [nuevo] = await db.insert(reportesContratista).values(parsed.data).returning();
  return NextResponse.json(nuevo, { status: 201 });
}
