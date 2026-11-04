import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { ZONA_HORARIA_PLANTA, fechaHoyPlanta } from "@/lib/conteos";
import {
  ETIQUETA_ESTADO_STOCK,
  construirCsv,
  estadoStock,
  leerFiltros,
  type FiltrosInventario,
  type LoteEnRevision,
  type LoteInventario,
  type ResumenInventario,
} from "@/lib/inventario";

export const dynamic = "force-dynamic";

// Filas como máximo en la tabla por lote y en la lista de lotes en revisión
// (la pantalla avisa cuántas se omiten). El CSV nunca se exporta parcial: si los
// lotes del filtro superan LIMITE_CSV responde 413 y pide acotar las fechas.
const LIMITE_LOTES = 1000;
const LIMITE_CSV = 20000;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

// Fecha original del conteo (contado_en; los registros antiguos usan creado_en),
// "timestamp" sin zona guardado en UTC, convertida a la hora de la planta.
const ZONA = sql.raw(`'${ZONA_HORARIA_PLANTA}'`);
const FECHA_CONTEO = sql`coalesce(c.contado_en, c.creado_en)`;
const HORA_PLANTA = sql`((${FECHA_CONTEO} at time zone 'UTC') at time zone ${ZONA})`;
const ES_PRUEBA = sql`(lower(c.origen) like 'prueba%')`;

/** Condiciones de fecha, origen y tipo de dato (el estado de stock solo filtra la tabla). */
function condicionesLotes(f: FiltrosInventario): SQL {
  const cs: SQL[] = [sql`true`];
  if (f.tipo === "real") cs.push(sql`not ${ES_PRUEBA}`);
  if (f.tipo === "prueba") cs.push(ES_PRUEBA);
  if (f.desde) cs.push(sql`${HORA_PLANTA}::date >= ${f.desde}::date`);
  if (f.hasta) cs.push(sql`${HORA_PLANTA}::date <= ${f.hasta}::date`);
  if (f.origen) cs.push(sql`c.origen = ${f.origen}`);
  return sql.join(cs, sql` and `);
}

/**
 * Un lote por fila con lo vendido en ventas ACTIVAS de ventas_lote y sus
 * ventas históricas (solo para informar: no restan del stock).
 */
function lotesFiltrados(f: FiltrosInventario): SQL {
  return sql`lotes as (
    select c.id, c.origen, c.fuente_camara, c.estado_validacion, c.cantidad_sacos,
      c.sacos_conformes, c.sacos_observados, c.sacos_defectuosos, c.observacion_validacion,
      ${FECHA_CONTEO} as fecha, ${HORA_PLANTA} as hora_planta, ${ES_PRUEBA} as es_prueba,
      coalesce(va.sacos, 0) as vendidos, coalesce(va.ventas, 0) as ventas_activas,
      coalesce(h.ventas, 0) as historicas, coalesce(h.importe, 0) as importe_historicas
    from conteos c
    left join lateral (select sum(v.cantidad_sacos)::int as sacos, count(*)::int as ventas
      from ventas_lote v where v.conteo_id = c.id and v.anulada_en is null) va on true
    left join lateral (select count(*)::int as ventas, sum(vh.total_venta) as importe
      from ventas vh where vh.conteo_id = c.id) h on true
    where ${condicionesLotes(f)}
  )`;
}

const ISO = (col: SQL) => sql`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * GET /api/inventario
 * Inventario de sacos conformes (solo admin_macromec). Todo se calcula en
 * PostgreSQL: disponible = conformes de lotes aprobados − ventas activas.
 *
 * Filtros (opcionales): desde, hasta (AAAA-MM-DD, fecha original del conteo en
 * hora de Lima), origen (exacto), tipo (real | prueba | todos; por defecto
 * real) y stock (todos | con_stock | agotado; solo filtra la tabla por lote).
 * ?formato=csv devuelve la tabla por lote COMPLETA como CSV para Excel.
 *
 *   200 · 400 filtros inválidos · 401 sin sesión · 403 rol cliente
 *   413 (solo CSV) más de LIMITE_CSV lotes: no se exporta una parte como si fuera el todo
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });

  const leidos = leerFiltros(req.nextUrl.searchParams);
  if ("errores" in leidos) {
    return NextResponse.json({ error: "Filtros inválidos", detalles: leidos.errores }, { status: 400, headers: SIN_CACHE });
  }
  const f = leidos.filtros;
  const csv = req.nextUrl.searchParams.get("formato") === "csv";

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, filtros: f, resumen: null, lotes: [], enRevision: [], origenes: [] }, { headers: SIN_CACHE });
  }

  const STOCK = sql`(l.sacos_conformes - l.vendidos)`;
  const condicionStock =
    f.stock === "con_stock" ? sql`and ${STOCK} > 0` : f.stock === "agotado" ? sql`and ${STOCK} <= 0` : sql``;

  // limite + 1 filas: si llega la fila extra, se sabe que hay lotes omitidos.
  const seleccionarLotes = async (limite: number) => [...(await db.execute<LoteInventario>(sql`
    with ${lotesFiltrados(f)}
    select l.id as "conteoId", ${ISO(sql`l.fecha`)} as "fechaConteo",
      l.hora_planta::date::text as "fechaPlanta", to_char(l.hora_planta, 'DD/MM/YYYY HH24:MI') as "fechaHoraPlanta",
      l.origen, l.fuente_camara as "fuenteCamara", l.es_prueba as "esPrueba", l.cantidad_sacos as "cantidadSacos",
      l.sacos_conformes as conformes, l.sacos_observados as observados, l.sacos_defectuosos as defectuosos,
      l.vendidos, l.ventas_activas as "ventasActivas", ${STOCK}::int as disponibles, l.historicas as "ventasHistoricas"
    from lotes l
    where l.estado_validacion = 'aprobado' ${condicionStock}
    order by l.fecha desc, l.id desc
    limit ${limite + 1}`))];

  if (csv) {
    const lotes = await seleccionarLotes(LIMITE_CSV);
    if (lotes.length > LIMITE_CSV) {
      return NextResponse.json(
        { error: `El filtro incluye más de ${LIMITE_CSV.toLocaleString("es-PE")} lotes: acote las fechas para exportar el CSV completo.`, limite: LIMITE_CSV },
        { status: 413, headers: SIN_CACHE }
      );
    }
    const encabezado = ["Lote", "Fecha del conteo (hora Lima)", "Tipo", "Origen", "Camara", "Detectados IA",
      "Conformes", "Observados", "Defectuosos", "Vendidos (ventas activas)", "N ventas activas", "Disponibles",
      "Estado de stock", "Ventas historicas (no restan)"];
    const cuerpo = construirCsv([
      encabezado,
      ...lotes.map((l) => [l.conteoId, l.fechaHoraPlanta, l.esPrueba ? "PRUEBA" : "Real", l.origen, l.fuenteCamara,
        l.cantidadSacos, l.conformes, l.observados, l.defectuosos, l.vendidos, l.ventasActivas, l.disponibles,
        ETIQUETA_ESTADO_STOCK[estadoStock(l.disponibles)], l.ventasHistoricas]),
    ]);
    const nombre = `inventario-${f.tipo}-${fechaHoyPlanta()}.csv`;
    return new NextResponse(cuerpo, {
      headers: {
        ...SIN_CACHE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        // Filas de datos exportadas (siempre todas las del filtro).
        "X-Total-Lotes": String(lotes.length),
      },
    });
  }

  const lotes = await seleccionarLotes(LIMITE_LOTES);
  const truncado = lotes.length > LIMITE_LOTES;
  if (truncado) lotes.length = LIMITE_LOTES;
  // Total de filas de la tabla con los filtros (incluido el de stock), aunque se muestren menos.
  const [{ total: totalLotesTabla }] = await db.execute<{ total: number }>(sql`
    with ${lotesFiltrados(f)}
    select count(*)::int as total from lotes l where l.estado_validacion = 'aprobado' ${condicionStock}`);

  const APROBADO = sql`filter (where l.estado_validacion = 'aprobado')`;
  const [fila] = await db.execute<ResumenInventario & { vendidosFueraDeAprobados: number; historicasVentas: number; historicasImporte: string }>(sql`
    with ${lotesFiltrados(f)}
    select
      count(*) ${APROBADO} ::int as "lotesAprobados",
      coalesce(sum(l.sacos_conformes) ${APROBADO}, 0)::int as conformes,
      coalesce(sum(l.vendidos) ${APROBADO}, 0)::int as vendidos,
      coalesce(sum(l.sacos_conformes - l.vendidos) ${APROBADO}, 0)::int as disponibles,
      count(*) filter (where l.estado_validacion = 'aprobado' and l.sacos_conformes - l.vendidos > 0)::int as "lotesConStock",
      count(*) filter (where l.estado_validacion = 'aprobado' and l.sacos_conformes - l.vendidos <= 0)::int as "lotesAgotados",
      coalesce(sum(l.ventas_activas) ${APROBADO}, 0)::int as "ventasActivas",
      coalesce(sum(l.sacos_observados) ${APROBADO}, 0)::int as observados,
      coalesce(sum(l.sacos_defectuosos) ${APROBADO}, 0)::int as defectuosos,
      json_build_object('lotes', count(*) filter (where l.estado_validacion = 'observado'),
        'sacos', coalesce(sum(l.cantidad_sacos) filter (where l.estado_validacion = 'observado'), 0)) as "enRevision",
      json_build_object('lotes', count(*) filter (where l.estado_validacion = 'pendiente'),
        'sacos', coalesce(sum(l.cantidad_sacos) filter (where l.estado_validacion = 'pendiente'), 0)) as pendientes,
      json_build_object('lotes', count(*) filter (where l.estado_validacion = 'rechazado'),
        'sacos', coalesce(sum(l.cantidad_sacos) filter (where l.estado_validacion = 'rechazado'), 0)) as rechazados,
      -- Debe ser 0: el trigger conteos_proteger_ventas impide ventas activas en lotes no aprobados.
      coalesce(sum(l.vendidos) filter (where l.estado_validacion <> 'aprobado'), 0)::int as "vendidosFueraDeAprobados",
      coalesce(sum(l.historicas), 0)::int as "historicasVentas",
      coalesce(sum(l.importe_historicas), 0)::numeric(14, 2)::text as "historicasImporte"
    from lotes l`);
  const { vendidosFueraDeAprobados, historicasVentas, historicasImporte, ...totales } = fila;
  const resumen: ResumenInventario = { ...totales, historicas: { ventas: historicasVentas, importe: historicasImporte } };

  const enRevision = [...(await db.execute<LoteEnRevision>(sql`
    with ${lotesFiltrados(f)}
    select l.id as "conteoId", ${ISO(sql`l.fecha`)} as "fechaConteo", l.origen, l.fuente_camara as "fuenteCamara",
      l.es_prueba as "esPrueba", l.cantidad_sacos as "cantidadSacos", l.observacion_validacion as observacion
    from lotes l
    where l.estado_validacion = 'observado'
    order by l.fecha desc, l.id desc
    limit ${LIMITE_LOTES}`))];

  // Orígenes existentes para el filtro (de todos los conteos, sin filtrar).
  const origenes = [...(await db.execute<{ origen: string; esPrueba: boolean }>(sql`
    select c.origen, ${ES_PRUEBA} as "esPrueba" from conteos c group by c.origen order by c.origen`))];

  return NextResponse.json(
    { modoSimulado: false, filtros: f, resumen, coherente: vendidosFueraDeAprobados === 0, lotes, truncado, totalLotesTabla,
      enRevision, totalEnRevision: resumen.enRevision.lotes, origenes, limite: LIMITE_LOTES, limiteCsv: LIMITE_CSV },
    { headers: SIN_CACHE }
  );
}
