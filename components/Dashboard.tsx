"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { VentasModule } from "./VentasModule";
import { ReporteContratistaModule } from "./ReporteContratistaModule";

type Conteo = {
  id: number;
  cantidadSacos: number;
  fuenteCamara?: string | null;
  confianzaPromedio?: number | string | null;
  creadoEn: string;
  reporteContratista?: { cantidadReportada: number; nombreContratista?: string | null } | null;
  discrepancia?: boolean;
};

type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "admin_macromec" | "cliente";
};

function tiempoRelativo(fechaISO: string): string {
  const diffMs = Date.now() - new Date(fechaISO).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(fechaISO).toLocaleDateString("es-PE");
}

function fechaCorta(fechaISO: string): string {
  return new Date(fechaISO).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
}

// ---------- Mini gráfico de tendencia (SVG, sin dependencias) ----------
function GraficoTendencia({ datos }: { datos: Conteo[] }) {
  if (datos.length < 2) {
    return <p className="chart-empty">Se necesitan al menos 2 registros para mostrar la tendencia.</p>;
  }
  const ordenado = [...datos].reverse(); // cronológico
  const valores = ordenado.map((c) => c.cantidadSacos);
  const max = Math.max(...valores, 1);
  const min = Math.min(...valores, 0);
  const rango = max - min || 1;
  const W = 640;
  const H = 160;
  const pad = 24;

  const puntos = ordenado.map((c, i) => {
    const x = pad + (i / (ordenado.length - 1)) * (W - pad * 2);
    const y = H - pad - ((c.cantidadSacos - min) / rango) * (H - pad * 2);
    return { x, y, c };
  });

  const linea = puntos.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${linea} L ${puntos[puntos.length - 1].x.toFixed(1)} ${H - pad} L ${puntos[0].x.toFixed(1)} ${H - pad} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" preserveAspectRatio="xMidYMid meet">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} className="trend-axis" />
      <path d={area} className="trend-area" />
      <path d={linea} className="trend-line" />
      {puntos.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.c.discrepancia ? 5 : 3.2} className={p.c.discrepancia ? "trend-dot-flag" : "trend-dot"} />
          <title>{`${fechaCorta(p.c.creadoEn)} — ${p.c.cantidadSacos} sacos`}</title>
        </g>
      ))}
    </svg>
  );
}

export function Dashboard() {
  const router = useRouter();
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [modoSimulado, setModoSimulado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [tema, setTema] = useState<"oscuro" | "claro">("oscuro");
  const [filaExpandida, setFilaExpandida] = useState<number | null>(null);

  // Filtros
  const [filtroCamara, setFiltroCamara] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [soloDiscrepancias, setSoloDiscrepancias] = useState(false);

  async function cargar() {
    try {
      const res = await fetch("/api/conteo", { cache: "no-store" });
      const data = await res.json();
      setConteos(data.conteos ?? []);
      setModoSimulado(data.modoSimulado ?? true);
    } finally {
      setCargando(false);
    }
  }

  async function cargarUsuario() {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();
    setUsuario(data.usuario);
  }

  async function cerrarSesion() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    cargar();
    cargarUsuario();
    const interval = setInterval(cargar, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const guardado = typeof window !== "undefined" ? window.localStorage?.getItem("tema-conteo") : null;
    if (guardado === "claro" || guardado === "oscuro") setTema(guardado);
  }, []);

  function alternarTema() {
    const nuevo = tema === "oscuro" ? "claro" : "oscuro";
    setTema(nuevo);
    try {
      window.localStorage?.setItem("tema-conteo", nuevo);
    } catch {}
  }

  const ultimo = conteos[0];

  const conteosFiltrados = useMemo(() => {
    return conteos.filter((c) => {
      if (soloDiscrepancias && !c.discrepancia) return false;
      if (filtroCamara && !(c.fuenteCamara ?? "").toLowerCase().includes(filtroCamara.toLowerCase())) return false;
      const fecha = new Date(c.creadoEn);
      if (filtroDesde && fecha < new Date(filtroDesde)) return false;
      if (filtroHasta) {
        const hasta = new Date(filtroHasta);
        hasta.setHours(23, 59, 59, 999);
        if (fecha > hasta) return false;
      }
      return true;
    });
  }, [conteos, filtroCamara, filtroDesde, filtroHasta, soloDiscrepancias]);

  const hayDiscrepancias = conteosFiltrados.some((c) => c.discrepancia);
  const totalHoy = conteosFiltrados.reduce((sum, c) => sum + c.cantidadSacos, 0);
  const confianzaProm =
    conteosFiltrados.length > 0
      ? Math.round(conteosFiltrados.reduce((s, c) => s + Number(c.confianzaPromedio || 0), 0) / conteosFiltrados.length)
      : 0;

  // Tendencia: compara la mitad más reciente vs la mitad anterior
  const tendencia = useMemo(() => {
    if (conteosFiltrados.length < 4) return null;
    const mitad = Math.floor(conteosFiltrados.length / 2);
    const reciente = conteosFiltrados.slice(0, mitad);
    const anterior = conteosFiltrados.slice(mitad, mitad * 2);
    const promReciente = reciente.reduce((s, c) => s + c.cantidadSacos, 0) / reciente.length;
    const promAnterior = anterior.reduce((s, c) => s + c.cantidadSacos, 0) / anterior.length;
    if (promAnterior === 0) return null;
    const cambio = ((promReciente - promAnterior) / promAnterior) * 100;
    return Math.round(cambio);
  }, [conteosFiltrados]);

  function exportarCSV() {
    const encabezado = ["Fecha", "Hora", "Sacos", "Camara/Origen", "Confianza", "Contratista reporto", "Discrepancia"];
    const filas = conteosFiltrados.map((c) => [
      new Date(c.creadoEn).toLocaleDateString("es-PE"),
      new Date(c.creadoEn).toLocaleTimeString("es-PE"),
      c.cantidadSacos,
      c.fuenteCamara ?? "",
      c.confianzaPromedio ?? "",
      c.reporteContratista?.cantidadReportada ?? "",
      c.discrepancia ? "Si" : "No",
    ]);
    const csv = [encabezado, ...filas]
      .map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conteo-sacos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function limpiarFiltros() {
    setFiltroCamara("");
    setFiltroDesde("");
    setFiltroHasta("");
    setSoloDiscrepancias(false);
  }

  const hayFiltrosActivos = !!(filtroCamara || filtroDesde || filtroHasta || soloDiscrepancias);

  return (
    <div className="shell" data-theme={tema}>
      <div className="topbar">
        <div className="plant-id">
          <img src="/logo-macromec.png" alt="MACROMEC" width={32} height={32} className="brand-mark" />
          <div>
            <div className="name">Conteo de Sacos</div>
            <div className="sub">MACROMEC J&S S.A.C. · Lavadero de zanahorias</div>
          </div>
        </div>
        <div className="session">
          <button onClick={alternarTema} className="btn-quiet" title="Cambiar tema" aria-label="Cambiar tema claro/oscuro">
            {tema === "oscuro" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          {usuario ? (
            <>
              <span className="who">{usuario.nombre}</span>
              <span className="role-tag">{usuario.rol === "admin_macromec" ? "Planta" : "Cliente"}</span>
              <button onClick={cerrarSesion} className="btn-quiet">Salir</button>
            </>
          ) : (
            <span>Cargando…</span>
          )}
        </div>
      </div>

      {modoSimulado && (
        <div className="banner banner-caution">
          Mostrando datos simulados — cámara y modelo de conteo aún no conectados en definitivo.
        </div>
      )}

      {hayDiscrepancias && (
        <div className="banner banner-alert">
          Discrepancia detectada entre el conteo automático y el reporte del contratista en al menos un registro.
        </div>
      )}

      <div className="readout">
        <p className="readout-label">Último conteo registrado</p>
        <p className="readout-value">
          {cargando ? "—" : ultimo ? ultimo.cantidadSacos : "0"}
          <span className="unit">sacos</span>
        </p>
        <div className="readout-meta">
          <span>{ultimo ? tiempoRelativo(ultimo.creadoEn) : "sin registros aún"}</span>
          {ultimo && <span>confianza <b>{ultimo.confianzaPromedio ?? "—"}%</b></span>}
          <span>total en el registro <b>{totalHoy}</b> sacos</span>
          {conteosFiltrados.length > 0 && <span>confianza media <b>{confianzaProm}%</b></span>}
        </div>
      </div>

      {/* ---- Tarjetas de resumen ---- */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Total (filtro actual)</span>
          <span className="stat-value">{totalHoy}</span>
          <span className="stat-sub">sacos</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Confianza media</span>
          <span className="stat-value">{confianzaProm}%</span>
          <span className="stat-sub">{conteosFiltrados.length} registros</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Tendencia</span>
          {tendencia === null ? (
            <span className="stat-value stat-value-sm">—</span>
          ) : (
            <span className={`stat-value ${tendencia >= 0 ? "stat-up" : "stat-down"}`}>
              {tendencia >= 0 ? "↑" : "↓"} {Math.abs(tendencia)}%
            </span>
          )}
          <span className="stat-sub">vs. periodo anterior</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Discrepancias</span>
          <span className={`stat-value ${hayDiscrepancias ? "stat-down" : ""}`}>
            {conteosFiltrados.filter((c) => c.discrepancia).length}
          </span>
          <span className="stat-sub">de {conteosFiltrados.length} registros</span>
        </div>
      </div>

      {/* ---- Gráfico de tendencia ---- */}
      <div className="chart-card">
        <div className="section-head">
          <h2>Tendencia de conteo</h2>
        </div>
        <GraficoTendencia datos={conteosFiltrados.slice(0, 30)} />
      </div>

      <div className="section-head">
        <h2>Historial reciente</h2>
        <span className="count">{conteosFiltrados.length} registro{conteosFiltrados.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ---- Filtros ---- */}
      <div className="filters-bar">
        <input
          type="text"
          placeholder="Buscar por cámara/origen…"
          value={filtroCamara}
          onChange={(e) => setFiltroCamara(e.target.value)}
          className="filter-input"
        />
        <label className="filter-date">
          Desde
          <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
        </label>
        <label className="filter-date">
          Hasta
          <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
        </label>
        <label className="filter-check">
          <input type="checkbox" checked={soloDiscrepancias} onChange={(e) => setSoloDiscrepancias(e.target.checked)} />
          Solo discrepancias
        </label>
        {hayFiltrosActivos && (
          <button onClick={limpiarFiltros} className="btn-quiet">Limpiar filtros</button>
        )}
        <button onClick={exportarCSV} className="btn-carrot btn-export" disabled={conteosFiltrados.length === 0}>
          ⬇ Exportar CSV
        </button>
      </div>

      <table className="manifest">
        <thead>
          <tr>
            <th></th>
            <th>Hora</th>
            <th>Sacos</th>
            <th>Cámara / origen</th>
            <th>Confianza</th>
            <th>Contratista</th>
          </tr>
        </thead>
        <tbody>
          {conteosFiltrados.map((c) => {
            const expandida = filaExpandida === c.id;
            return (
              <Fragment key={c.id}>
                <tr
                  className={`${c.discrepancia ? "flagged" : ""} fila-clicable`}
                  onClick={() => setFilaExpandida(expandida ? null : c.id)}
                >
                  <td data-label="" className="expand-toggle">{expandida ? "▾" : "▸"}</td>
                  <td data-label="Hora" className="muted">{new Date(c.creadoEn).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td data-label="Sacos" className="num">{c.cantidadSacos}</td>
                  <td data-label="Origen" className="muted">{c.fuenteCamara ?? "—"}</td>
                  <td data-label="Confianza">{c.confianzaPromedio ?? "—"}%</td>
                  <td data-label="Contratista">
                    {c.reporteContratista ? (
                      <>
                        {c.reporteContratista.cantidadReportada}{" "}
                        {c.discrepancia && <span className="tag tag-flag">discrepancia</span>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
                {expandida && (
                  <tr className="fila-detalle">
                    <td colSpan={6}>
                      <div className="detalle-grid">
                        <div><span className="detalle-label">ID de registro</span><span>{c.id}</span></div>
                        <div><span className="detalle-label">Fecha completa</span><span>{new Date(c.creadoEn).toLocaleString("es-PE")}</span></div>
                        <div><span className="detalle-label">Origen completo</span><span className="detalle-mono">{c.fuenteCamara ?? "—"}</span></div>
                        <div><span className="detalle-label">Confianza del modelo</span><span>{c.confianzaPromedio ?? "—"}%</span></div>
                        <div><span className="detalle-label">Reporte del contratista</span><span>{c.reporteContratista ? `${c.reporteContratista.cantidadReportada} sacos${c.reporteContratista.nombreContratista ? " — " + c.reporteContratista.nombreContratista : ""}` : "sin reporte"}</span></div>
                        <div><span className="detalle-label">Estado</span><span>{c.discrepancia ? "⚠ Discrepancia con el reporte manual" : "✓ Coincide o sin reporte"}</span></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {conteosFiltrados.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>{conteos.length === 0 ? "Todavía no hay conteos registrados." : "Ningún registro coincide con los filtros aplicados."}</td>
            </tr>
          )}
        </tbody>
      </table>

      {usuario?.rol === "admin_macromec" && (
        <>
          <ReporteContratistaModule ultimoConteoId={ultimo?.id} onRegistrado={cargar} />
          <VentasModule ultimoConteoId={ultimo?.id} />
        </>
      )}
    </div>
  );
}
