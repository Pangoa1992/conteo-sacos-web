/**
 * Respuestas de las consultas por WhatsApp (etapa 4B), calculadas en PostgreSQL.
 * Reglas compartidas con el panel: solo datos REALES (el origen no empieza por
 * «prueba»), fecha original del conteo en hora de la planta, umbral de
 * discrepancia de lib/conteos y regla única del reporte vigente. Nunca se
 * informan ventas ni inventario (son solo del personal de MACROMEC).
 *
 * Modo DEMO (alcance "demo", ver lib/modo-demo-whatsapp.ts): las mismas
 * consultas sobre los lotes de PRUEBA de la BD de demostración; el webhook
 * marca cada respuesta «DEMO · datos de prueba». Por defecto, alcance "real".
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { ETIQUETA_ESTADO_VALIDACION, UMBRAL_DISCREPANCIA, ZONA_HORARIA_PLANTA, type EstadoValidacion } from "./conteos";
import { ordenVigenciaReporteSql } from "./reportes-contratista-servidor";
import { textoDiferencia } from "./reportes-contratista";
import { TEXTO_AYUDA, TEXTO_AYUDA_DEMO, TEXTO_LOTE_INVALIDO, TEXTO_MES_INVALIDO, mesConsultado, type Comando } from "./whatsapp";
import { etiquetaMes, rangoMes } from "./produccion-validada";

const ZONA = sql.raw(`'${ZONA_HORARIA_PLANTA}'`);
const FECHA = sql`coalesce(c.contado_en, c.creado_en)`;
const DIA_PLANTA = sql`((${FECHA} at time zone 'UTC') at time zone ${ZONA})::date`;
const HOY_PLANTA = sql`(now() at time zone ${ZONA})::date`;
const ES_REAL = sql`(lower(c.origen) not like 'prueba%')`;
const ES_PRUEBA = sql`(lower(c.origen) like 'prueba%')`;
const ISO = sql`to_char(${FECHA}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
// Reporte vigente del lote c (misma regla en todo el sistema).
const REPORTE_VIGENTE = sql`left join lateral (select r.cantidad_reportada, r.nombre_contratista from reportes_contratista r
  where r.conteo_id = c.id order by ${ordenVigenciaReporteSql("r")} limit 1) rv on true`;

export type AlcanceWhatsapp = "real" | "demo";
// En modo DEMO se consultan solo los lotes de prueba y los textos dicen «de prueba» en vez de «real».
const filtro = (a: AlcanceWhatsapp) => (a === "demo" ? ES_PRUEBA : ES_REAL);
const real = (a: AlcanceWhatsapp) => (a === "demo" ? "de prueba" : "real");
const reales = (a: AlcanceWhatsapp) => (a === "demo" ? "de prueba" : "reales");

const fmt = (n: number) => n.toLocaleString("es-PE");
const sacos = (n: number) => `${fmt(n)} saco${n === 1 ? "" : "s"}`;
const lotes = (n: number) => `${fmt(n)} lote${n === 1 ? "" : "s"}`;
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: ZONA_HORARIA_PLANTA });
const diaCorto = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const diaLargo = (d: string) => d.split("-").reverse().join("/");
const estado = (e: string) => ETIQUETA_ESTADO_VALIDACION[e as EstadoValidacion] ?? e;

/** Línea del reporte del contratista con la diferencia exacta y si hay discrepancia. */
function lineaReporte(reportado: number | null, nombre: string | null, ia: number, estadoValidacion: string): string {
  if (reportado === null) return "👷 Contratista: sin reporte";
  const d = reportado - ia;
  const quien = nombre?.trim() ? ` (${nombre.trim()})` : "";
  const alerta = Math.abs(d) > UMBRAL_DISCREPANCIA
    ? ` · ⚠ discrepancia ${estadoValidacion === "pendiente" ? "pendiente de revisión" : "revisada"}`
    : "";
  return `👷 Contratista${quien}: ${sacos(reportado)} · diferencia ${textoDiferencia(d)}${alerta}`;
}

type Ultimo = { id: number; cantidadSacos: number; fecha: string; confianza: string | null; estado: string; reportado: number | null; contratista: string | null };

async function ultimo(a: AlcanceWhatsapp): Promise<string> {
  const [l] = await db.execute<Ultimo>(sql`
    select c.id, c.cantidad_sacos as "cantidadSacos", ${ISO} as fecha, c.confianza_promedio::text as confianza, c.estado_validacion as estado,
      rv.cantidad_reportada as reportado, rv.nombre_contratista as contratista
    from conteos c ${REPORTE_VIGENTE}
    where ${filtro(a)}
    order by ${FECHA} desc, c.id desc limit 1`);
  if (!l) return `Todavía no hay ningún conteo ${real(a)} registrado.`;
  return (
    `📦 Último conteo: *${sacos(l.cantidadSacos)}* · lote #${l.id}\n` +
    `🕐 Contado: ${fechaHora(l.fecha)}\n` +
    `✅ Confianza: ${l.confianza === null ? "No disponible" : `${l.confianza}%`}\n` +
    `📋 Validación: ${estado(l.estado)}\n` +
    lineaReporte(l.reportado, l.contratista, l.cantidadSacos, l.estado)
  );
}

type FilaPeriodo = {
  dia: string; lotes: number; sacos: number;
  aprobados: number; sacosAprobados: number; conformes: number; observados: number; defectuosos: number;
  lotesObservados: number; lotesRechazados: number; lotesPendientes: number; sacosPendientes: number;
  discrepanciasPendientes: number;
};

/** Producción por día (hora de Lima) de los últimos `dias` días, incluido hoy. */
async function periodo(dias: number, a: AlcanceWhatsapp): Promise<{ hoy: string; filas: FilaPeriodo[] }> {
  const [{ hoy }] = await db.execute<{ hoy: string }>(sql`select ${HOY_PLANTA}::text as hoy`);
  return { hoy, filas: await filasPeriodo(sql`${HOY_PLANTA} - ${dias - 1}::int`, HOY_PLANTA, a) };
}

/** Producción por día (hora de Lima) entre dos fechas incluidas. */
async function filasPeriodo(desde: SQL, hasta: SQL, a: AlcanceWhatsapp): Promise<FilaPeriodo[]> {
  return [...(await db.execute<FilaPeriodo>(sql`
    select ${DIA_PLANTA}::text as dia, count(*)::int as lotes, sum(c.cantidad_sacos)::int as sacos,
      count(*) filter (where c.estado_validacion = 'aprobado')::int as aprobados,
      coalesce(sum(c.cantidad_sacos) filter (where c.estado_validacion = 'aprobado'), 0)::int as "sacosAprobados",
      coalesce(sum(c.sacos_conformes) filter (where c.estado_validacion = 'aprobado'), 0)::int as conformes,
      coalesce(sum(c.sacos_observados) filter (where c.estado_validacion = 'aprobado'), 0)::int as observados,
      coalesce(sum(c.sacos_defectuosos) filter (where c.estado_validacion = 'aprobado'), 0)::int as defectuosos,
      count(*) filter (where c.estado_validacion = 'observado')::int as "lotesObservados",
      count(*) filter (where c.estado_validacion = 'rechazado')::int as "lotesRechazados",
      count(*) filter (where c.estado_validacion = 'pendiente')::int as "lotesPendientes",
      coalesce(sum(c.cantidad_sacos) filter (where c.estado_validacion = 'pendiente'), 0)::int as "sacosPendientes",
      count(*) filter (where c.estado_validacion = 'pendiente' and rv.cantidad_reportada is not null
        and abs(rv.cantidad_reportada - c.cantidad_sacos) > ${UMBRAL_DISCREPANCIA})::int as "discrepanciasPendientes"
    from conteos c ${REPORTE_VIGENTE}
    where ${filtro(a)} and ${DIA_PLANTA} between ${desde} and ${hasta}
    group by 1 order by 1`))];
}

function totales(filas: FilaPeriodo[]): FilaPeriodo {
  const t = { dia: "", lotes: 0, sacos: 0, aprobados: 0, sacosAprobados: 0, conformes: 0, observados: 0, defectuosos: 0,
    lotesObservados: 0, lotesRechazados: 0, lotesPendientes: 0, sacosPendientes: 0, discrepanciasPendientes: 0 };
  for (const f of filas) for (const k of Object.keys(t) as (keyof FilaPeriodo)[]) if (k !== "dia") (t[k] as number) += f[k] as number;
  return t;
}

function bloqueValidacion(t: FilaPeriodo): string {
  return (
    `✅ Aprobados: ${lotes(t.aprobados)} · ${sacos(t.sacosAprobados)} (conformes ${fmt(t.conformes)} · observados ${fmt(t.observados)} · defectuosos ${fmt(t.defectuosos)})\n` +
    `🔎 Observados: ${lotes(t.lotesObservados)} · ⛔ Rechazados: ${lotes(t.lotesRechazados)}\n` +
    `⏳ Pendientes de validar: ${lotes(t.lotesPendientes)} · ${sacos(t.sacosPendientes)}\n` +
    `⚠ Discrepancias con el contratista pendientes de revisión: ${fmt(t.discrepanciasPendientes)}`
  );
}

async function hoy(a: AlcanceWhatsapp): Promise<string> {
  const { hoy, filas } = await periodo(1, a);
  const t = totales(filas);
  if (t.lotes === 0) return `📊 Hoy ${diaLargo(hoy)} (hora de Lima) todavía no hay conteos ${reales(a)}.`;
  return `📊 Producción de hoy ${diaLargo(hoy)} (hora de Lima)\nLotes: ${fmt(t.lotes)} · Sacos detectados por la IA: *${fmt(t.sacos)}*\n` + bloqueValidacion(t);
}

async function semana(a: AlcanceWhatsapp): Promise<string> {
  const { hoy, filas } = await periodo(7, a);
  const t = totales(filas);
  const desde = new Date(`${hoy}T00:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - 6);
  const desdeTexto = desde.toISOString().slice(0, 10);
  if (t.lotes === 0) return `📊 Del ${diaCorto(desdeTexto)} al ${diaCorto(hoy)} no hay conteos ${reales(a)}.`;
  const porDia = filas.map((f) => `• ${diaCorto(f.dia)}: ${lotes(f.lotes)} · ${sacos(f.sacos)}`).join("\n");
  return (
    `📊 Últimos 7 días (${diaCorto(desdeTexto)} al ${diaCorto(hoy)}, hora de Lima)\n` +
    `Lotes: ${fmt(t.lotes)} · Sacos detectados por la IA: *${fmt(t.sacos)}*\n` + bloqueValidacion(t) + `\n\nPor día:\n${porDia}`
  );
}

/** Producción de un mes (por defecto el actual), con el detalle por semana. */
async function mes(c: { mes: number | null; anio: number | null }, a: AlcanceWhatsapp): Promise<string> {
  const [{ hoy }] = await db.execute<{ hoy: string }>(sql`select ${HOY_PLANTA}::text as hoy`);
  const m = mesConsultado(c, hoy);
  const { desde, hasta } = rangoMes(m);
  if (desde > hoy) return `📅 ${etiquetaMes(m)} todavía no llega.`;
  const filas = await filasPeriodo(sql`${desde}::date`, sql`${hasta}::date`, a);
  const t = totales(filas);
  const titulo = `📅 Producción de ${etiquetaMes(m)}${m === hoy.slice(0, 7) ? " (mes en curso)" : ""} · hora de Lima`;
  if (t.lotes === 0) return `${titulo}\nNo hay conteos ${reales(a)} en ese mes.`;
  // Semanas del mes: días 1–7, 8–14, 15–21, 22–28 y 29 al fin de mes.
  const semanas = new Map<number, { lotes: number; sacos: number }>();
  for (const f of filas) {
    const s = Math.min(Math.floor((Number(f.dia.slice(8, 10)) - 1) / 7), 4);
    const actual = semanas.get(s) ?? { lotes: 0, sacos: 0 };
    semanas.set(s, { lotes: actual.lotes + f.lotes, sacos: actual.sacos + f.sacos });
  }
  const finMes = Number(hasta.slice(8, 10));
  const porSemana = [...semanas.entries()].sort(([x], [y]) => x - y)
    .map(([s, v]) => `• Del ${s * 7 + 1} al ${s === 4 ? finMes : s * 7 + 7}: ${lotes(v.lotes)} · ${sacos(v.sacos)}`).join("\n");
  return (
    `${titulo}\nLotes: ${fmt(t.lotes)} · Sacos detectados por la IA: *${fmt(t.sacos)}*\n` + bloqueValidacion(t) +
    `\n\nPor semana:\n${porSemana}\n\nPara otro mes escriba, por ejemplo, *mes 10* o *mes octubre 2026*.`
  );
}

type Discrepancia = { id: number; fecha: string; ia: number; reportado: number; contratista: string | null };

async function discrepancias(a: AlcanceWhatsapp): Promise<string> {
  const PENDIENTE = sql`c.estado_validacion = 'pendiente'`;
  const base = sql`from conteos c ${REPORTE_VIGENTE}
    where ${filtro(a)} and rv.cantidad_reportada is not null and abs(rv.cantidad_reportada - c.cantidad_sacos) > ${UMBRAL_DISCREPANCIA}`;
  const [{ pendientes, revisadas }] = await db.execute<{ pendientes: number; revisadas: number }>(sql`
    select count(*) filter (where ${PENDIENTE})::int as pendientes, count(*) filter (where not ${PENDIENTE})::int as revisadas ${base}`);
  if (pendientes === 0) {
    return `✅ No hay discrepancias pendientes de revisión.${revisadas > 0 ? ` (${fmt(revisadas)} ya revisada${revisadas === 1 ? "" : "s"} por el personal)` : ""}`;
  }
  const mayores = [...(await db.execute<Discrepancia>(sql`
    select c.id, ${ISO} as fecha, c.cantidad_sacos as ia, rv.cantidad_reportada as reportado, rv.nombre_contratista as contratista ${base} and ${PENDIENTE}
    order by abs(rv.cantidad_reportada - c.cantidad_sacos) desc, ${FECHA} desc, c.id desc limit 5`))];
  const lineas = mayores.map((m) => `• Lote #${m.id} (${fechaHora(m.fecha)}): IA ${fmt(m.ia)} · contratista${m.contratista?.trim() ? ` ${m.contratista.trim()}` : ""} ${fmt(m.reportado)} · diferencia ${textoDiferencia(m.reportado - m.ia)}`);
  return (
    `⚠ Discrepancias pendientes de revisión: *${fmt(pendientes)}*` + (revisadas > 0 ? ` · revisadas: ${fmt(revisadas)}` : "") +
    `\n(diferencia = contratista − IA; discrepancia si supera ±${UMBRAL_DISCREPANCIA})\n` +
    (pendientes > mayores.length ? `Las ${mayores.length} mayores:\n` : "") + lineas.join("\n") +
    `\n\nSe revisan validando el lote en el panel.`
  );
}

type Lote = Ultimo & { conformes: number | null; observados: number | null; defectuosos: number | null; observacion: string | null; reportes: number };

async function lote(id: number, a: AlcanceWhatsapp): Promise<string> {
  const [l] = await db.execute<Lote>(sql`
    select c.id, c.cantidad_sacos as "cantidadSacos", ${ISO} as fecha, c.confianza_promedio::text as confianza, c.estado_validacion as estado,
      c.sacos_conformes as conformes, c.sacos_observados as observados, c.sacos_defectuosos as defectuosos, c.observacion_validacion as observacion,
      rv.cantidad_reportada as reportado, rv.nombre_contratista as contratista,
      (select count(*)::int from reportes_contratista r where r.conteo_id = c.id) as reportes
    from conteos c ${REPORTE_VIGENTE}
    where ${filtro(a)} and c.id = ${id}`);
  // Un lote de otro alcance (de prueba en modo real) se trata igual que uno inexistente: no se revela.
  if (!l) return `No hay un lote ${real(a)} con el número ${id}.`;
  const clasificacion = l.conformes !== null
    ? `\n📦 Clasificación del personal: conformes ${fmt(l.conformes)} · observados ${fmt(l.observados ?? 0)} · defectuosos ${fmt(l.defectuosos ?? 0)}`
    : "";
  return (
    `🔢 Lote #${l.id}\n` +
    `🕐 Contado: ${fechaHora(l.fecha)}\n` +
    `🤖 Sacos detectados por la IA: *${fmt(l.cantidadSacos)}* · confianza ${l.confianza === null ? "no disponible" : `${l.confianza}%`}\n` +
    `📋 Validación: ${estado(l.estado)}${clasificacion}` +
    (l.observacion ? `\n📝 Observación: ${l.observacion}` : "") +
    `\n${lineaReporte(l.reportado, l.contratista, l.cantidadSacos, l.estado)}` +
    (l.reportes > 1 ? ` (vigente de ${fmt(l.reportes)} reportes)` : "")
  );
}

/** Texto de respuesta de un comando (sin recortar; el webhook aplica el límite). */
export async function responderComando(c: Comando, alcance: AlcanceWhatsapp = "real"): Promise<string> {
  switch (c.tipo) {
    case "ultimo": return ultimo(alcance);
    case "hoy": return hoy(alcance);
    case "semana": return semana(alcance);
    case "discrepancias": return discrepancias(alcance);
    case "lote": return lote(c.lote, alcance);
    case "lote_invalido": return TEXTO_LOTE_INVALIDO;
    case "mes": return mes(c, alcance);
    case "mes_invalido": return TEXTO_MES_INVALIDO;
    case "ayuda":
    case "saludo": return alcance === "demo" ? TEXTO_AYUDA_DEMO : TEXTO_AYUDA;
  }
}
