"use client";

import { useEffect, useRef, useState } from "react";
import { ReporteContratistaModule, type LoteParaReporte } from "./ReporteContratistaModule";
import { BadgeValidacion } from "./ValidacionConteo";
import type { TipoDato } from "@/lib/inventario";
import {
  ETIQUETA_FILTRO_DISCREPANCIA,
  FILTROS_DISCREPANCIA,
  SIN_NOMBRE,
  parametrosFiltrosReportes,
  textoDiferencia,
  type FilaContratista,
  type FiltroDiscrepancia,
  type FiltrosReportes,
  type ReporteDetalle,
  type ResumenReportes,
} from "@/lib/reportes-contratista";

type Datos = {
  umbral: number;
  resumen: ResumenReportes | null;
  porContratista: FilaContratista[];
  reportes: ReporteDetalle[];
  truncado: boolean;
  totalHistorial: number;
  limiteCsv: number;
  contratistas: { clave: string; nombre: string }[];
};

type Props = {
  esAdmin: boolean; // registra reportes; el cliente solo consulta
  vista: TipoDato; // vista real / prueba / todos del dashboard: tipo inicial del filtro
  lotes: LoteParaReporte[];
  recarga?: unknown; // cambia cuando el dashboard actualiza sus datos
  onRegistrado?: () => void;
};

const fmt = (n: number) => n.toLocaleString("es-PE");
const fecha = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fechaCorta = (d: string) => d.split("-").reverse().join("/");
const ALCANCE_TIPO: Record<TipoDato, string> = { real: "solo datos reales", prueba: "solo datos de prueba", todos: "datos reales y de prueba" };

function EtiquetaPrueba() {
  return <span className="badge badge-prueba" title="Dato de prueba: no es una detección real">Prueba</span>;
}

/** Diferencia exacta con signo; el color indica si supera el umbral. */
function Diferencia({ d, umbral }: { d: number; umbral: number }) {
  const abs = Math.abs(d);
  const clase = abs > umbral ? "badge-critico" : abs === 0 ? "badge-ok" : "badge-agotado";
  const titulo = abs > umbral ? `Discrepancia: diferencia mayor que ${umbral} saco${umbral === 1 ? "" : "s"}` : abs === 0 ? "Coincide" : `Dentro del umbral (±${umbral})`;
  return (
    <span className={`badge ${clase}`} title={titulo}>
      {abs > umbral && <span aria-hidden="true">⚠ </span>}{textoDiferencia(d)}
    </span>
  );
}

function alcance(f: FiltrosReportes, contratistas: Datos["contratistas"]): string {
  const fechas = f.desde && f.hasta ? (f.desde === f.hasta ? `conteos del ${fechaCorta(f.desde)}` : `conteos del ${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)}`)
    : f.desde ? `conteos desde el ${fechaCorta(f.desde)}` : f.hasta ? `conteos hasta el ${fechaCorta(f.hasta)}` : "todas las fechas";
  const quien = f.contratista === null ? "todos los contratistas" : `contratista ${contratistas.find((c) => c.clave === f.contratista)?.nombre ?? (f.contratista || SIN_NOMBRE)}`;
  return `${ALCANCE_TIPO[f.tipo]} · ${fechas} · ${quien}${f.lote !== null ? ` · lote #${f.lote}` : ""}`;
}

/**
 * Contratistas y reportes (etapa 4A): compara lo que reporta el contratista con
 * el conteo de la IA y con la validación del personal. Los cálculos los hace
 * PostgreSQL (GET /api/reportes-contratista). Los resúmenes usan el reporte
 * vigente de cada lote (el más reciente); el historial muestra todos.
 */
export function ContratistasModule({ esAdmin, vista, lotes, recarga, onRegistrado }: Props) {
  const [filtros, setFiltros] = useState<FiltrosReportes>({ contratista: null, lote: null, desde: null, hasta: null, discrepancia: "todos", tipo: vista });
  const [loteTexto, setLoteTexto] = useState("");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const ultimaConsulta = useRef(0);

  useEffect(() => {
    setFiltros((f) => ({ ...f, tipo: vista }));
  }, [vista]);

  const consulta = parametrosFiltrosReportes(filtros).toString();

  useEffect(() => {
    const n = ++ultimaConsulta.current;
    (async () => {
      try {
        const res = await fetch(`/api/reportes-contratista?${consulta}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (n !== ultimaConsulta.current) return;
        if (!res.ok) return setError(data.detalles?.join(" ") || data.error || "No se pudieron cargar los reportes.");
        setDatos(data);
        setError(null);
      } catch {
        if (n === ultimaConsulta.current) setError("No se pudieron actualizar los reportes. Se muestran los últimos datos recibidos.");
      } finally {
        if (n === ultimaConsulta.current) setCargando(false);
      }
    })();
  }, [consulta, recarga]);

  const cambiar = <K extends keyof FiltrosReportes>(clave: K, valor: FiltrosReportes[K]) => setFiltros((f) => ({ ...f, [clave]: valor }));
  const hayFiltros = !!(filtros.contratista !== null || filtros.lote !== null || filtros.desde || filtros.hasta || filtros.discrepancia !== "todos");
  const r = datos?.resumen;
  const umbral = datos?.umbral ?? 1;
  const v = (n: number | undefined) => (cargando || n === undefined ? "—" : fmt(n));
  const esVistaPrueba = filtros.tipo !== "real";
  const csvExcede = !!datos && datos.totalHistorial > datos.limiteCsv;

  return (
    <section className="tarjeta" id="contratistas">
      <div className="tarjeta-head">
        <div>
          <h2>Contratistas y reportes {esVistaPrueba && <EtiquetaPrueba />}</h2>
          <p className="tarjeta-sub">
            Lo que reporta el contratista frente a lo detectado por la IA y a la validación del personal · diferencia = reportado − IA ·
            discrepancia si supera ±{umbral} saco{umbral === 1 ? "" : "s"} · por fecha original del conteo (hora de Lima)
          </p>
        </div>
      </div>

      {esAdmin ? (
        <ReporteContratistaModule lotes={lotes} tipo={vista} contratistas={(datos?.contratistas ?? []).filter((c) => c.clave).map((c) => c.nombre)} onRegistrado={onRegistrado} />
      ) : (
        <p className="aviso aviso-info">Consulta en solo lectura: los reportes los registra el personal de MACROMEC.</p>
      )}

      <h3 className="subtitulo">Reportes registrados</h3>
      <div className="filtros">
        <label className="filtro-fecha">
          Contratista
          <select value={filtros.contratista ?? "*"} onChange={(e) => cambiar("contratista", e.target.value === "*" ? null : e.target.value)}>
            <option value="*">Todos</option>
            {(datos?.contratistas ?? []).map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="filtro-fecha">
          Lote
          <input type="text" inputMode="numeric" className="filtro-lote" placeholder="N.º" value={loteTexto}
            onChange={(e) => { const t = e.target.value.replace(/\D/g, "").slice(0, 9); setLoteTexto(t); cambiar("lote", t ? Number(t) : null); }} />
        </label>
        <label className="filtro-fecha">
          Desde
          <input type="date" value={filtros.desde ?? ""} max={filtros.hasta ?? undefined} onChange={(e) => cambiar("desde", e.target.value || null)} />
        </label>
        <label className="filtro-fecha">
          Hasta
          <input type="date" value={filtros.hasta ?? ""} min={filtros.desde ?? undefined} onChange={(e) => cambiar("hasta", e.target.value || null)} />
        </label>
        <label className="filtro-fecha">
          Discrepancia
          <select value={filtros.discrepancia} onChange={(e) => cambiar("discrepancia", e.target.value as FiltroDiscrepancia)}>
            {FILTROS_DISCREPANCIA.map((d) => <option key={d} value={d}>{ETIQUETA_FILTRO_DISCREPANCIA[d]}</option>)}
          </select>
        </label>
        <label className="filtro-fecha">
          Datos
          <select value={filtros.tipo} onChange={(e) => cambiar("tipo", e.target.value as TipoDato)}>
            <option value="real">Reales</option>
            <option value="prueba">Prueba</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        {hayFiltros && (
          <button type="button" className="btn-secundario" onClick={() => { setLoteTexto(""); setFiltros((f) => ({ ...f, contratista: null, lote: null, desde: null, hasta: null, discrepancia: "todos" })); }}>
            Limpiar filtros
          </button>
        )}
      </div>

      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      {esVistaPrueba && (
        <p className="aviso aviso-prueba">
          {filtros.tipo === "prueba" ? "Reportes de lotes de PRUEBA: no corresponden a detecciones reales." : "Vista combinada: los lotes de prueba están marcados con «Prueba»."}
        </p>
      )}
      <p className="inv-alcance">
        <strong>Resumen:</strong> {alcance(filtros, datos?.contratistas ?? [])} · un lote cuenta una vez, con su reporte vigente.
        {filtros.discrepancia !== "todos" && <> El filtro «{ETIQUETA_FILTRO_DISCREPANCIA[filtros.discrepancia]}» solo afecta al historial de reportes.</>}
      </p>

      <div className="val-kpis inv-kpis">
        <div className="kpi">
          <span className="kpi-label">Lotes con reporte</span>
          <span className="kpi-valor">{v(r?.lotes)}</span>
          <span className="kpi-sub">{r ? `${fmt(r.reportes)} reporte${r.reportes === 1 ? "" : "s"} · ${fmt(r.reemplazados)} reemplazado${r.reemplazados === 1 ? "" : "s"}` : "—"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Reportado / IA</span>
          <span className="kpi-valor kpi-valor-par">{r && !cargando ? `${fmt(r.sacosReportados)} / ${fmt(r.sacosIA)}` : "—"}</span>
          <span className="kpi-sub">sacos (reportes vigentes)</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Diferencia neta</span>
          <span className="kpi-valor">{r && !cargando ? textoDiferencia(r.diferenciaNeta) : "—"}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{r ? `suma de |diferencias|: ${fmt(r.diferenciaAbsoluta)}` : "—"}</span>
        </div>
        <div className={`kpi ${r && r.conDiscrepancia > 0 ? "kpi-alerta" : ""}`}>
          <span className="kpi-label">Con discrepancia</span>
          <span className="kpi-valor">{r && r.conDiscrepancia > 0 && <span className="estado-icono estado-critico" aria-hidden="true">⚠</span>}{v(r?.conDiscrepancia)}</span>
          <span className="kpi-sub">{r ? `${fmt(r.pendientes)} pendiente${r.pendientes === 1 ? "" : "s"} · ${fmt(r.revisadas)} revisada${r.revisadas === 1 ? "" : "s"}` : "—"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Sin discrepancia</span>
          <span className="kpi-valor">{r && !cargando ? fmt(r.coinciden + r.diferenciaDeUno) : "—"}</span>
          <span className="kpi-sub">{r ? `${fmt(r.coinciden)} coinciden · ${fmt(r.diferenciaDeUno)} con ±1` : "—"}</span>
        </div>
      </div>

      {r && r.pendientes > 0 && (
        <p className="aviso aviso-critico" role="alert">
          <span aria-hidden="true">⚠</span> {fmt(r.pendientes)} discrepancia{r.pendientes === 1 ? "" : "s"} pendiente{r.pendientes === 1 ? "" : "s"} de revisión:
          {esAdmin ? " valide el lote en el Historial de conteos." : " el personal de MACROMEC aún no ha validado el lote."}
        </p>
      )}
      <p className="tarjeta-sub">
        «Revisada» significa que el personal ya validó el lote (aprobado, observado o rechazado); «pendiente», que el lote sigue sin validar.
        No hay una acción aparte para marcar una alerta como atendida.
      </p>

      {/* ---- Resumen por contratista ---- */}
      <div className="subtitulo-con-accion">
        <h3 className="subtitulo">Resumen por contratista <span className="tenue inv-alcance-sub">· mismo alcance que el resumen</span></h3>
        <a className={`btn-secundario btn-chico ${!datos || datos.porContratista.length === 0 ? "deshabilitado" : ""}`}
          href={`/api/reportes-contratista?${consulta}&formato=csv&tabla=contratistas`} download
          aria-disabled={!datos || datos.porContratista.length === 0}
          onClick={(e) => { if (!datos || datos.porContratista.length === 0) e.preventDefault(); }}>
          CSV del resumen
        </a>
      </div>
      <div className="tabla-scroll">
        <table className="historial tabla-contratistas">
          <thead>
            <tr>
              <th>Contratista</th>
              <th className="num">Lotes</th>
              <th className="num">Reportado</th>
              <th className="num">IA</th>
              <th className="num">Diferencia neta</th>
              <th className="num">|Dif.| total</th>
              <th className="num">Con discrepancia</th>
              <th>Revisión</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.porContratista ?? []).map((c) => (
              <tr key={c.contratistaClave}>
                <td data-label="Contratista" className="fuerte"><span className="celda-valor">{c.nombre}</span></td>
                <td data-label="Lotes" className="num">{fmt(c.lotes)}</td>
                <td data-label="Reportado" className="num">{fmt(c.sacosReportados)}</td>
                <td data-label="IA" className="num">{fmt(c.sacosIA)}</td>
                <td data-label="Diferencia neta" className="num">{textoDiferencia(c.diferenciaNeta)}</td>
                <td data-label="|Dif.| total" className="num">{fmt(c.diferenciaAbsoluta)}</td>
                <td data-label="Con discrepancia" className="num">{c.conDiscrepancia > 0 ? <span className="badge badge-critico">⚠ {fmt(c.conDiscrepancia)}</span> : "0"}</td>
                <td data-label="Revisión">
                  <span className="celda-valor">
                    {c.conDiscrepancia === 0 ? <span className="tenue">—</span> : <span>{fmt(c.pendientes)} pendiente{c.pendientes === 1 ? "" : "s"} · {fmt(c.revisadas)} revisada{c.revisadas === 1 ? "" : "s"}</span>}
                  </span>
                </td>
              </tr>
            ))}
            {datos && datos.porContratista.length === 0 && (
              <tr className="fila-vacia"><td colSpan={8}>No hay reportes en esta vista.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Historial de reportes ---- */}
      <div className="subtitulo-con-accion">
        <h3 className="subtitulo">Historial de reportes{filtros.discrepancia !== "todos" && ` · ${ETIQUETA_FILTRO_DISCREPANCIA[filtros.discrepancia].toLowerCase()}`}</h3>
        <a className={`btn-acento ${!datos || datos.totalHistorial === 0 || csvExcede ? "deshabilitado" : ""}`}
          href={`/api/reportes-contratista?${consulta}&formato=csv&tabla=reportes`} download
          aria-disabled={!datos || datos.totalHistorial === 0 || csvExcede}
          onClick={(e) => { if (!datos || datos.totalHistorial === 0 || csvExcede) e.preventDefault(); }}>
          Exportar CSV{datos && datos.totalHistorial > 0 ? ` (${fmt(datos.totalHistorial)})` : ""}
        </a>
      </div>
      {datos && (
        <p className="tarjeta-sub">
          {fmt(datos.totalHistorial)} reporte{datos.totalHistorial === 1 ? "" : "s"} · todos se conservan; el más reciente de cada lote es el vigente · del más reciente al más antiguo
        </p>
      )}
      {csvExcede && (
        <p className="nota-critica" role="alert">
          <span aria-hidden="true">⚠</span> El filtro incluye {fmt(datos!.totalHistorial)} reportes, más de los {fmt(datos!.limiteCsv)} que admite el CSV: acote las fechas para exportar.
        </p>
      )}
      {datos?.truncado && (
        <p className="nota-critica" role="status">
          <span aria-hidden="true">⚠</span> Historial parcial: se muestran los {fmt(datos.reportes.length)} reportes más recientes de {fmt(datos.totalHistorial)}.
          {csvExcede ? " Acote las fechas para verlos todos." : " El CSV sí incluye todos."}
        </p>
      )}
      <div className="tabla-scroll">
        <table className="historial tabla-reportes">
          <thead>
            <tr>
              <th>Registrado</th>
              <th>Lote</th>
              <th>Contratista</th>
              <th className="num">Reportado</th>
              <th className="num">IA</th>
              <th className="num">Diferencia</th>
              <th>Validación humana</th>
              <th>Revisión</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.reportes ?? []).map((x) => (
              <tr key={x.id} className={`${x.esPrueba ? "fila-prueba" : ""} ${x.vigente ? "" : "fila-reemplazada"} ${x.vigente && x.discrepancia ? "fila-discrepancia" : ""}`}>
                <td data-label="Registrado">{fecha(x.registradoEn)}</td>
                <td data-label="Lote">
                  <span className="celda-valor">
                    <span>#{x.conteoId} {x.esPrueba && <EtiquetaPrueba />}</span>
                    <span className="tenue celda-sub">conteo {fecha(x.fechaConteo)}</span>
                  </span>
                </td>
                <td data-label="Contratista"><span className="celda-valor">{x.nombreContratista?.trim() || <span className="tenue">{SIN_NOMBRE}</span>}</span></td>
                <td data-label="Reportado" className="num fuerte">{fmt(x.cantidadReportada)}</td>
                <td data-label="IA" className="num">{fmt(x.cantidadIA)}</td>
                <td data-label="Diferencia" className="num"><Diferencia d={x.diferencia} umbral={umbral} /></td>
                <td data-label="Validación humana">
                  <span className="celda-valor">
                    <span><BadgeValidacion estado={x.estadoValidacion} /></span>
                    {x.sacosConformes !== null && <span className="tenue celda-sub">{fmt(x.sacosConformes)} conf. · {fmt(x.sacosObservados ?? 0)} obs. · {fmt(x.sacosDefectuosos ?? 0)} def.</span>}
                    {x.observacionValidacion && <span className="celda-sub" title={x.observacionValidacion}>«{x.observacionValidacion}»</span>}
                  </span>
                </td>
                <td data-label="Revisión">
                  <span className="celda-valor">
                  <span>
                  {x.vigente ? (
                    <>
                      <span className="badge badge-ok">Vigente</span>{" "}
                      {x.revision === "pendiente" && <span className="badge badge-critico">Pendiente de revisión</span>}
                      {x.revision === "revisada" && <span className="badge badge-val-aprobado">Revisada</span>}
                    </>
                  ) : (
                    <span className="badge badge-agotado" title="Hay un reporte más reciente del mismo lote">Reemplazado</span>
                  )}
                  </span>
                  {x.reportesDelLote > 1 && <span className="tenue celda-sub">{x.reportesDelLote} reportes en este lote</span>}
                  </span>
                </td>
              </tr>
            ))}
            {datos && datos.reportes.length === 0 && (
              <tr className="fila-vacia"><td colSpan={8}>{hayFiltros ? "Ningún reporte coincide con los filtros." : "No hay reportes en esta vista."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
