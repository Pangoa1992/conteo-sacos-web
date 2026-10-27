"use client";

import { useEffect, useRef, useState } from "react";
import {
  ESTADOS_STOCK,
  ETIQUETA_ESTADO_STOCK,
  estadoStock,
  parametrosFiltros,
  type EstadoStock,
  type FiltrosInventario,
  type LoteEnRevision,
  type LoteInventario,
  type ResumenInventario,
  type TipoDato,
} from "@/lib/inventario";

type Datos = {
  resumen: ResumenInventario | null;
  coherente: boolean;
  lotes: LoteInventario[];
  truncado: boolean;
  totalLotesTabla: number; // filas de la tabla con los filtros, aunque se muestren menos
  limite: number;
  limiteCsv: number;
  enRevision: LoteEnRevision[];
  totalEnRevision: number;
  origenes: { origen: string; esPrueba: boolean }[];
};

type Props = {
  vista: TipoDato; // vista real / prueba / todos del dashboard: tipo inicial del filtro
  recarga?: unknown; // cambia cuando el dashboard actualiza sus datos (venta, anulación, validación)
};

const fmt = (n: number) => n.toLocaleString("es-PE");
const soles = (v: string) => `S/ ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const lotes = (n: number) => `${fmt(n)} lote${n === 1 ? "" : "s"}`;
const sacos = (n: number) => `${fmt(n)} saco${n === 1 ? "" : "s"}`;

const ETIQUETA_TIPO: Record<TipoDato, string> = { real: "Reales", prueba: "Prueba", todos: "Todos" };
const ALCANCE_TIPO: Record<TipoDato, string> = { real: "solo datos reales", prueba: "solo datos de prueba", todos: "datos reales y de prueba" };
const fechaCorta = (d: string) => d.split("-").reverse().join("/");

/** Texto del alcance de los filtros de fecha, origen y datos (los que afectan a los totales). */
function alcanceFiltros(f: FiltrosInventario): string {
  const fechas = f.desde && f.hasta ? (f.desde === f.hasta ? `conteos del ${fechaCorta(f.desde)}` : `conteos del ${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)}`)
    : f.desde ? `conteos desde el ${fechaCorta(f.desde)}` : f.hasta ? `conteos hasta el ${fechaCorta(f.hasta)}` : "todas las fechas";
  return `${ALCANCE_TIPO[f.tipo]} · ${fechas} · ${f.origen ? `origen ${f.origen}` : "todos los orígenes"}`;
}

function EtiquetaPrueba() {
  return <span className="badge badge-prueba" title="Dato de prueba: no es una detección real">Prueba</span>;
}

/**
 * Inventario de sacos conformes (etapa 3C). Solo lo ve el personal de
 * MACROMEC. Los totales, la tabla y el CSV los calcula PostgreSQL
 * (GET /api/inventario): aquí no se suma nada. Los filtros de fecha usan la
 * fecha original del conteo.
 */
export function InventarioModule({ vista, recarga }: Props) {
  const [filtros, setFiltros] = useState<FiltrosInventario>({ desde: null, hasta: null, origen: null, stock: "todos", tipo: vista });
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // Solo se aplica la respuesta de la última consulta (al cambiar filtros rápido
  // o recargar tras una venta, una respuesta vieja no pisa a la nueva).
  const ultimaConsulta = useRef(0);

  // El tipo de dato sigue a la vista general del dashboard.
  useEffect(() => {
    setFiltros((f) => ({ ...f, tipo: vista }));
  }, [vista]);

  const consulta = parametrosFiltros(filtros).toString();

  useEffect(() => {
    const n = ++ultimaConsulta.current;
    (async () => {
      try {
        const res = await fetch(`/api/inventario?${consulta}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (n !== ultimaConsulta.current) return;
        if (!res.ok) {
          setError(data.detalles?.join(" ") || data.error || "No se pudo cargar el inventario.");
          return;
        }
        setDatos(data);
        setError(null);
      } catch {
        if (n === ultimaConsulta.current) setError("No se pudo actualizar el inventario. Se muestran los últimos datos recibidos.");
      } finally {
        if (n === ultimaConsulta.current) setCargando(false);
      }
    })();
  }, [consulta, recarga]);

  const cambiar = <K extends keyof FiltrosInventario>(clave: K, valor: FiltrosInventario[K]) => setFiltros((f) => ({ ...f, [clave]: valor }));
  const hayFiltros = !!(filtros.desde || filtros.hasta || filtros.origen || filtros.stock !== "todos");
  const r = datos?.resumen;
  const v = (n: number | undefined) => (cargando || n === undefined ? "—" : fmt(n));
  const esVistaPrueba = filtros.tipo !== "real";
  // El CSV exporta SIEMPRE todos los lotes del filtro: si son demasiados no se ofrece (el servidor respondería 413).
  const sinLotes = !datos || datos.totalLotesTabla === 0;
  const csvExcede = !!datos && datos.totalLotesTabla > datos.limiteCsv;
  const csvDeshabilitado = sinLotes || csvExcede;

  return (
    <section className="tarjeta" id="inventario">
      <div className="tarjeta-head">
        <div>
          <h2>Inventario de sacos {esVistaPrueba && <EtiquetaPrueba />}</h2>
          <p className="tarjeta-sub">
            Disponible = sacos conformes de lotes aprobados − ventas activas · calculado en la base de datos · por fecha original del conteo (hora de Lima)
          </p>
        </div>
        <a
          className={`btn-acento ${csvDeshabilitado ? "deshabilitado" : ""}`}
          href={`/api/inventario?${consulta}&formato=csv`}
          download
          aria-disabled={csvDeshabilitado}
          title={datos && !csvDeshabilitado ? `Exporta los ${fmt(datos.totalLotesTabla)} lotes de la tabla con los filtros activos` : undefined}
          onClick={(e) => { if (csvDeshabilitado) e.preventDefault(); }}
        >
          Exportar CSV{datos && !sinLotes ? ` (${fmt(datos.totalLotesTabla)})` : ""}
        </a>
      </div>

      <div className="filtros">
        <label className="filtro-fecha">
          Desde
          <input type="date" value={filtros.desde ?? ""} max={filtros.hasta ?? undefined} onChange={(e) => cambiar("desde", e.target.value || null)} />
        </label>
        <label className="filtro-fecha">
          Hasta
          <input type="date" value={filtros.hasta ?? ""} min={filtros.desde ?? undefined} onChange={(e) => cambiar("hasta", e.target.value || null)} />
        </label>
        <label className="filtro-fecha">
          Origen
          <select value={filtros.origen ?? ""} onChange={(e) => cambiar("origen", e.target.value || null)}>
            <option value="">Todos</option>
            {(datos?.origenes ?? []).map((o) => (
              <option key={o.origen} value={o.origen}>{o.origen}{o.esPrueba ? " (prueba)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="filtro-fecha">
          Stock
          <select value={filtros.stock} onChange={(e) => cambiar("stock", e.target.value as EstadoStock)}>
            {ESTADOS_STOCK.map((s) => <option key={s} value={s}>{ETIQUETA_ESTADO_STOCK[s]}</option>)}
          </select>
        </label>
        <label className="filtro-fecha">
          Datos
          <select value={filtros.tipo} onChange={(e) => cambiar("tipo", e.target.value as TipoDato)}>
            {(["real", "prueba", "todos"] as TipoDato[]).map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
          </select>
        </label>
        {hayFiltros && (
          <button type="button" className="btn-secundario" onClick={() => setFiltros((f) => ({ ...f, desde: null, hasta: null, origen: null, stock: "todos" }))}>
            Limpiar filtros
          </button>
        )}
      </div>

      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      {esVistaPrueba && (
        <p className="aviso aviso-prueba">
          {filtros.tipo === "prueba" ? "Inventario de DATOS DE PRUEBA: no es stock real." : "Vista combinada: incluye lotes de prueba, marcados con «Prueba»."}
        </p>
      )}

      <p className="inv-alcance" aria-live="polite">
        <strong>Indicadores:</strong> {alcanceFiltros(filtros)}.
        {filtros.stock !== "todos" && <> El filtro «Stock: {ETIQUETA_ESTADO_STOCK[filtros.stock]}» solo afecta a la tabla por lote.</>}
      </p>
      {csvExcede && (
        <p className="nota-critica" role="alert">
          <span aria-hidden="true">⚠</span> El filtro incluye {fmt(datos!.totalLotesTabla)} lotes, más de los {fmt(datos!.limiteCsv)} que admite el CSV:
          acote las fechas para exportar. No se exporta una parte como si fuera el inventario completo.
        </p>
      )}

      {/* ---- Stock vendible ---- */}
      <div className="val-kpis inv-kpis" aria-live="polite">
        <div className="kpi">
          <span className="kpi-label">Sacos conformes</span>
          <span className="kpi-valor">{v(r?.conformes)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{r ? lotes(r.lotesAprobados) : "—"} aprobado{r?.lotesAprobados === 1 ? "" : "s"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Vendidos</span>
          <span className="kpi-valor">{v(r?.vendidos)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{r ? `${fmt(r.ventasActivas)} venta${r.ventasActivas === 1 ? "" : "s"} activa${r.ventasActivas === 1 ? "" : "s"}` : "—"}</span>
        </div>
        <div className="kpi kpi-validada">
          <span className="kpi-label">Disponibles</span>
          <span className="kpi-valor">{v(r?.disponibles)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">stock vendible</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Lotes con stock</span>
          <span className="kpi-valor">{v(r?.lotesConStock)}</span>
          <span className="kpi-sub">con sacos disponibles</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Lotes agotados</span>
          <span className="kpi-valor">{v(r?.lotesAgotados)}</span>
          <span className="kpi-sub">conformes vendidos por completo</span>
        </div>
      </div>

      {r && !cargando && (r.conformes - r.vendidos === r.disponibles && r.lotesConStock + r.lotesAgotados === r.lotesAprobados && datos?.coherente ? (
        <p className="nota-comprobacion">
          <span aria-hidden="true">✓</span> {fmt(r.conformes)} conformes − {fmt(r.vendidos)} vendidos = {fmt(r.disponibles)} disponibles.
        </p>
      ) : (
        <p className="nota-critica" role="alert">
          <span aria-hidden="true">⚠</span> Los totales del inventario no cuadran. Revise los datos antes de vender.
        </p>
      ))}

      {/* ---- Fuera del stock ---- */}
      <h3 className="subtitulo">Fuera del stock vendible <span className="tenue inv-alcance-sub">· mismo alcance que los indicadores</span></h3>
      <div className="inv-aparte">
        <div className="inv-dato">
          <span className="inv-dato-valor">{v(r?.observados)}</span>
          <span className="inv-dato-texto">sacos observados<br /><span className="tenue">de lotes aprobados</span></span>
        </div>
        <div className="inv-dato">
          <span className="inv-dato-valor">{v(r?.defectuosos)}</span>
          <span className="inv-dato-texto">sacos defectuosos<br /><span className="tenue">de lotes aprobados</span></span>
        </div>
        <div className={`inv-dato ${r && r.enRevision.lotes > 0 ? "inv-dato-aviso" : ""}`}>
          <span className="inv-dato-valor">{v(r?.enRevision.lotes)}</span>
          <span className="inv-dato-texto">lotes en revisión<br /><span className="tenue">observados · {r ? sacos(r.enRevision.sacos) : "—"} detectados</span></span>
        </div>
        <div className="inv-dato">
          <span className="inv-dato-valor">{v(r?.pendientes.lotes)}</span>
          <span className="inv-dato-texto">lotes pendientes<br /><span className="tenue">sin validar · {r ? sacos(r.pendientes.sacos) : "—"}</span></span>
        </div>
        <div className="inv-dato">
          <span className="inv-dato-valor">{v(r?.rechazados.lotes)}</span>
          <span className="inv-dato-texto">lotes rechazados<br /><span className="tenue">{r ? sacos(r.rechazados.sacos) : "—"}</span></span>
        </div>
      </div>
      {r && r.historicas.ventas > 0 && (
        <p className="tarjeta-sub">
          {fmt(r.historicas.ventas)} venta{r.historicas.ventas === 1 ? "" : "s"} histórica{r.historicas.ventas === 1 ? "" : "s"} ({soles(r.historicas.importe)}) de
          estos lotes, anteriores al control de validación: se conservan sin cambios y no restan del stock.
        </p>
      )}

      {/* ---- Tabla por lote ---- */}
      <h3 className="subtitulo">
        Stock por lote aprobado{filtros.stock !== "todos" && ` · ${ETIQUETA_ESTADO_STOCK[filtros.stock].toLowerCase()}`}
      </h3>
      {datos && (
        <p className="tarjeta-sub">
          {lotes(datos.totalLotesTabla)} · mismo alcance que los indicadores
          {filtros.stock !== "todos" ? ` y solo ${ETIQUETA_ESTADO_STOCK[filtros.stock].toLowerCase()}` : ""} · del más reciente al más antiguo por fecha del conteo
        </p>
      )}
      {datos?.truncado && (
        <p className="nota-critica" role="status">
          <span aria-hidden="true">⚠</span> Tabla parcial: se muestran los {fmt(datos.lotes.length)} lotes más recientes de {fmt(datos.totalLotesTabla)}. Acote las fechas para verlos todos
          {csvExcede ? "." : "; el CSV sí incluye todos."}
        </p>
      )}
      <div className="tabla-scroll">
        <table className="historial tabla-inventario">
          <thead>
            <tr>
              <th>Lote</th>
              <th>Fecha del conteo</th>
              <th>Origen</th>
              <th className="num">Detectados IA</th>
              <th className="num">Conformes</th>
              <th className="num">Observados</th>
              <th className="num">Defectuosos</th>
              <th className="num">Vendidos</th>
              <th className="num">Disponibles</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.lotes ?? []).map((l) => (
              <tr key={l.conteoId} className={l.esPrueba ? "fila-prueba" : ""}>
                <td data-label="Lote">#{l.conteoId} {l.esPrueba && <EtiquetaPrueba />}</td>
                <td data-label="Fecha">{fecha(l.fechaConteo)}</td>
                <td data-label="Origen" className="tenue" title={l.fuenteCamara ? `Cámara: ${l.fuenteCamara}` : undefined}>{l.origen}</td>
                <td data-label="Detectados IA" className="num">{fmt(l.cantidadSacos)}</td>
                <td data-label="Conformes" className="num">{fmt(l.conformes)}</td>
                <td data-label="Observados" className="num">{fmt(l.observados)}</td>
                <td data-label="Defectuosos" className="num">{fmt(l.defectuosos)}</td>
                <td data-label="Vendidos" className="num">
                  {fmt(l.vendidos)}
                  {l.ventasHistoricas > 0 && <> <span className="badge badge-historica" title="Tiene ventas históricas: no restan del stock">+hist.</span></>}
                </td>
                <td data-label="Disponibles" className="num fuerte">
                  {estadoStock(l.disponibles) === "agotado" ? <span className="badge badge-agotado">Agotado</span> : fmt(l.disponibles)}
                </td>
              </tr>
            ))}
            {datos && datos.lotes.length === 0 && (
              <tr className="fila-vacia">
                <td colSpan={9}>{hayFiltros ? "Ningún lote aprobado coincide con los filtros." : "No hay lotes aprobados en esta vista."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Lotes en revisión ---- */}
      {datos && datos.enRevision.length > 0 && (
        <details className="historicas">
          <summary>Lotes en revisión ({fmt(datos.totalEnRevision)}) · observados, no se venden hasta aprobarlos</summary>
          {datos.enRevision.length < datos.totalEnRevision && (
            <p className="tarjeta-sub">Se muestran los {fmt(datos.enRevision.length)} más recientes de {fmt(datos.totalEnRevision)}: acote las fechas para ver el resto.</p>
          )}
          <div className="tabla-scroll">
            <table className="historial">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Fecha del conteo</th>
                  <th>Origen</th>
                  <th className="num">Detectados IA</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {datos.enRevision.map((l) => (
                  <tr key={l.conteoId} className={l.esPrueba ? "fila-prueba" : ""}>
                    <td data-label="Lote">#{l.conteoId} {l.esPrueba && <EtiquetaPrueba />}</td>
                    <td data-label="Fecha">{fecha(l.fechaConteo)}</td>
                    <td data-label="Origen" className="tenue">{l.origen}{l.fuenteCamara ? ` · ${l.fuenteCamara}` : ""}</td>
                    <td data-label="Detectados IA" className="num">{fmt(l.cantidadSacos)}</td>
                    <td data-label="Observación">{l.observacion ?? <span className="tenue">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="tarjeta-sub">
        Solo se venden sacos conformes de lotes aprobados. La clasificación por estado físico la registra el personal al revisar el lote: el modelo de visión solo cuenta sacos.
      </p>
    </section>
  );
}
