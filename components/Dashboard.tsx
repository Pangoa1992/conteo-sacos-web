"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { VentasModule } from "./VentasModule";
import { ReporteContratistaModule } from "./ReporteContratistaModule";
import { GraficoProduccion, etiquetaDia, type DiaProduccion } from "./GraficoProduccion";
import { BadgeValidacion, ValidacionConteo } from "./ValidacionConteo";
import { EvidenciasConteo } from "./EvidenciasConteo";
import { ESTADOS_VALIDACION, ETIQUETA_ESTADO_VALIDACION, type EstadoValidacion } from "@/lib/conteos";

export type Conteo = {
  id: number;
  cantidadSacos: number;
  origen?: string | null;
  esPrueba?: boolean;
  fuenteCamara?: string | null;
  confianzaPromedio?: number | string | null;
  creadoEn: string; // recepción en la web
  contadoEn?: string | null; // fecha real del lote en el detector
  fechaConteo?: string; // contadoEn o, si no existe, creadoEn
  reporteContratista?: { cantidadReportada: number; nombreContratista?: string | null } | null;
  discrepancia?: boolean;
  // Validación por el personal (los datos simulados no la traen: se tratan como pendiente)
  estadoValidacion?: EstadoValidacion;
  sacosConformes?: number | null;
  sacosObservados?: number | null;
  sacosDefectuosos?: number | null;
  validadoPorNombre?: string | null;
  validadoEn?: string | null;
  observacionValidacion?: string | null;
};

type FilaDiaria = { fecha: string; esPrueba: boolean; totalSacos: number; registros: number };
type Fuente = { fuenteCamara: string | null; esPrueba: boolean; ultimoRegistro: string; registros: number };
type Resumen = { hoy: string | null; diasSerie?: number; diario: FilaDiaria[]; fuentes: Fuente[] };

type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "admin_macromec" | "cliente";
};

/** Qué datos se muestran: los de prueba nunca se mezclan con los reales salvo en "todos". */
type Vista = "real" | "prueba" | "todos";

const LIMITE_HISTORIAL = 200;
const INTERVALO_ACTUALIZACION_MS = 10_000;

const fmt = (n: number) => n.toLocaleString("es-PE");

function tiempoRelativo(fechaISO: string): string {
  const diffMs = Date.now() - new Date(fechaISO).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/** Fecha real del lote; los registros antiguos sin ella usan la de recepción. */
function fechaDe(c: Conteo): string {
  return c.fechaConteo ?? c.contadoEn ?? c.creadoEn;
}

/** Confianza tal como llegó del modelo; null si no se reportó (nunca se inventa). */
function confianzaNumerica(v: Conteo["confianzaPromedio"]): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatoConfianza(v: Conteo["confianzaPromedio"]): string {
  const n = confianzaNumerica(v);
  return n === null ? "No disponible" : `${n.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;
}

/** Suma n días a una fecha YYYY-MM-DD (sin depender de la zona del navegador). */
function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function EtiquetaPrueba() {
  return <span className="badge badge-prueba" title="Dato de prueba: no es una detección real">Prueba</span>;
}

export function Dashboard() {
  const router = useRouter();
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [modoSimulado, setModoSimulado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [actualizadoEn, setActualizadoEn] = useState<Date | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [tema, setTema] = useState<"claro" | "oscuro">("claro");
  const [vista, setVista] = useState<Vista>("real");
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [filaExpandida, setFilaExpandida] = useState<number | null>(null);
  const [seccionActiva, setSeccionActiva] = useState("resumen");

  // Filtros del historial
  const [filtroCamara, setFiltroCamara] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [soloDiscrepancias, setSoloDiscrepancias] = useState(false);
  const [filtroValidacion, setFiltroValidacion] = useState<EstadoValidacion | "">("");

  async function cargar() {
    try {
      const [resConteos, resResumen] = await Promise.all([
        fetch(`/api/conteo?limite=${LIMITE_HISTORIAL}`, { cache: "no-store" }),
        fetch("/api/conteo/resumen", { cache: "no-store" }),
      ]);
      if (!resConteos.ok || !resResumen.ok) throw new Error("respuesta no válida");
      const dataConteos = await resConteos.json();
      const dataResumen = await resResumen.json();
      setConteos(dataConteos.conteos ?? []);
      setModoSimulado(!!dataConteos.modoSimulado);
      setResumen(dataResumen);
      setErrorCarga(false);
      setActualizadoEn(new Date());
    } catch {
      setErrorCarga(true); // se conservan los últimos datos mostrados
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
    const interval = setInterval(cargar, INTERVALO_ACTUALIZACION_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const guardado = typeof window !== "undefined" ? window.localStorage?.getItem("tema-dashboard") : null;
    if (guardado === "claro" || guardado === "oscuro") setTema(guardado);
  }, []);

  function alternarTema() {
    const nuevo = tema === "oscuro" ? "claro" : "oscuro";
    setTema(nuevo);
    try {
      window.localStorage?.setItem("tema-dashboard", nuevo);
    } catch {}
  }

  // En modo simulado (sin BD) todo se trata como dato de prueba.
  const esPrueba = (c: { esPrueba?: boolean }) => modoSimulado || !!c.esPrueba;
  const enVista = (prueba: boolean) => vista === "todos" || (vista === "prueba") === prueba;

  const conteosVista = useMemo(() => conteos.filter((c) => enVista(esPrueba(c))), [conteos, vista, modoSimulado]);
  const ultimo = conteosVista[0];
  const hayReales = conteos.some((c) => !esPrueba(c));
  const cantidadPrueba = conteos.filter((c) => esPrueba(c)).length;

  // ---- Producción diaria (desde /api/conteo/resumen, agregada en la BD) ----
  const hoy = resumen?.hoy ?? null;
  const diasSerie = resumen?.diasSerie ?? 14;
  const dias: DiaProduccion[] = useMemo(() => {
    if (!hoy) return [];
    const porFecha = new Map<string, DiaProduccion>();
    for (let i = diasSerie - 1; i >= 0; i--) {
      const fecha = sumarDias(hoy, -i);
      porFecha.set(fecha, { fecha, totalSacos: 0, registros: 0 });
    }
    for (const fila of resumen?.diario ?? []) {
      const dia = porFecha.get(fila.fecha);
      if (dia && enVista(fila.esPrueba)) {
        dia.totalSacos += fila.totalSacos;
        dia.registros += fila.registros;
      }
    }
    return [...porFecha.values()];
  }, [resumen, hoy, diasSerie, vista]);

  const produccionHoy = dias.find((d) => d.fecha === hoy);
  const ultimos7 = dias.slice(-7).reduce((s, d) => s + d.totalSacos, 0);
  const previos7 = dias.slice(-14, -7).reduce((s, d) => s + d.totalSacos, 0);
  const tendencia = previos7 > 0 ? Math.round(((ultimos7 - previos7) / previos7) * 100) : null;

  // ---- Confianza: solo valores reportados por el modelo ----
  const confianzas = conteosVista.map((c) => confianzaNumerica(c.confianzaPromedio)).filter((n): n is number => n !== null);
  const confianzaMedia = confianzas.length ? confianzas.reduce((s, n) => s + n, 0) / confianzas.length : null;

  const discrepanciasVista = conteosVista.filter((c) => c.discrepancia).length;
  const fuentesVista = (resumen?.fuentes ?? []).filter((f) => enVista(f.esPrueba));
  const estadoDe = (c: Conteo): EstadoValidacion => c.estadoValidacion ?? "pendiente";
  const pendientesVista = conteosVista.filter((c) => estadoDe(c) === "pendiente").length;

  // ---- Historial con filtros ----
  const conteosFiltrados = useMemo(() => {
    return conteosVista.filter((c) => {
      if (soloDiscrepancias && !c.discrepancia) return false;
      if (filtroValidacion && estadoDe(c) !== filtroValidacion) return false;
      if (filtroCamara && !(c.fuenteCamara ?? "").toLowerCase().includes(filtroCamara.toLowerCase())) return false;
      const fecha = new Date(fechaDe(c));
      if (filtroDesde && fecha < new Date(`${filtroDesde}T00:00:00`)) return false;
      if (filtroHasta && fecha > new Date(`${filtroHasta}T23:59:59.999`)) return false;
      return true;
    });
  }, [conteosVista, filtroCamara, filtroDesde, filtroHasta, soloDiscrepancias, filtroValidacion]);

  const totalFiltrado = conteosFiltrados.reduce((sum, c) => sum + c.cantidadSacos, 0);
  const hayDiscrepanciasFiltradas = conteosFiltrados.some((c) => c.discrepancia);

  function exportarCSV() {
    const encabezado = ["ID", "Fecha", "Hora", "Sacos", "Tipo", "Camara/Origen", "Confianza (%)", "Contratista reporto", "Discrepancia",
      "Validacion", "Conformes (manual)", "Observados (manual)", "Defectuosos (manual)", "Validado por", "Fecha validacion", "Observacion"];
    const filas = conteosFiltrados.map((c) => [
      c.id,
      new Date(fechaDe(c)).toLocaleDateString("es-PE"),
      new Date(fechaDe(c)).toLocaleTimeString("es-PE"),
      c.cantidadSacos,
      esPrueba(c) ? "PRUEBA" : "Real",
      c.fuenteCamara ?? "",
      confianzaNumerica(c.confianzaPromedio) ?? "",
      c.reporteContratista?.cantidadReportada ?? "",
      c.discrepancia ? "Si" : "No",
      ETIQUETA_ESTADO_VALIDACION[estadoDe(c)],
      c.sacosConformes ?? "",
      c.sacosObservados ?? "",
      c.sacosDefectuosos ?? "",
      c.validadoPorNombre ?? "",
      c.validadoEn ? new Date(c.validadoEn).toLocaleString("es-PE") : "",
      c.observacionValidacion ?? "",
    ]);
    const csv = [encabezado, ...filas]
      .map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conteo-sacos-${vista}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function limpiarFiltros() {
    setFiltroCamara("");
    setFiltroDesde("");
    setFiltroHasta("");
    setSoloDiscrepancias(false);
    setFiltroValidacion("");
  }

  const hayFiltrosActivos = !!(filtroCamara || filtroDesde || filtroHasta || soloDiscrepancias || filtroValidacion);
  const esAdmin = usuario?.rol === "admin_macromec";
  const conteoParaModulos = ultimo
    ? { id: ultimo.id, cantidadSacos: ultimo.cantidadSacos, creadoEn: fechaDe(ultimo), esPrueba: esPrueba(ultimo) }
    : undefined;

  const secciones = [
    { id: "resumen", texto: "Resumen" },
    { id: "produccion", texto: "Producción diaria" },
    { id: "camaras", texto: "Cámaras" },
    { id: "historial", texto: "Historial" },
    ...(esAdmin ? [{ id: "contratistas", texto: "Contratistas" }, { id: "ventas", texto: "Ventas" }] : []),
  ];

  // Sección activa del menú: la última cuyo inicio ya pasó el primer tercio de la pantalla.
  // Se recalcula al cambiar las secciones (las de admin aparecen al cargar el usuario).
  const idsSecciones = secciones.map((s) => s.id).join(",");
  useEffect(() => {
    const ids = idsSecciones.split(",");
    let cuadro = 0;
    function actualizar() {
      cuadro = 0;
      const umbral = window.innerHeight / 3;
      let actual = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= umbral) actual = id;
      }
      // Al final de la página la última sección puede no alcanzar el umbral.
      const alFinal = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (alFinal && window.scrollY > 0) actual = ids[ids.length - 1];
      setSeccionActiva(actual);
    }
    const programar = () => { if (!cuadro) cuadro = requestAnimationFrame(actualizar); };
    actualizar();
    window.addEventListener("scroll", programar, { passive: true });
    window.addEventListener("resize", programar);
    return () => {
      window.removeEventListener("scroll", programar);
      window.removeEventListener("resize", programar);
      cancelAnimationFrame(cuadro);
    };
  }, [idsSecciones]);

  const etiquetaVista = { real: "Datos reales", prueba: "Datos de prueba", todos: "Todos los datos" }[vista];

  return (
    <div className="app" data-theme={tema}>
      {/* ================= Barra lateral ================= */}
      <aside className="sidebar">
        <div className="sidebar-marca">
          <img src="/logo-macromec.png" alt="" width={40} height={40} className="sidebar-logo" />
          <div>
            <div className="sidebar-nombre">MACROMEC</div>
            <div className="sidebar-sub">J&amp;S S.A.C. · Conteo de sacos</div>
          </div>
          <button
            type="button"
            className="sidebar-menu-btn"
            aria-expanded={menuAbierto}
            aria-controls="nav-principal"
            onClick={() => setMenuAbierto((v) => !v)}
          >
            {menuAbierto ? "Cerrar" : "Menú"}
          </button>
        </div>

        <div className={`sidebar-cuerpo ${menuAbierto ? "abierto" : ""}`}>
          <nav id="nav-principal" className="sidebar-nav" aria-label="Secciones del panel">
            {secciones.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-current={seccionActiva === s.id ? "location" : undefined}
                onClick={() => setMenuAbierto(false)}
              >
                {s.texto}
              </a>
            ))}
          </nav>

          <div className="sidebar-pie">
            {usuario ? (
              <div className="sidebar-usuario">
                <span className="sidebar-usuario-nombre">{usuario.nombre}</span>
                <span className="sidebar-rol">{esAdmin ? "Personal de planta" : "Cliente"}</span>
              </div>
            ) : (
              <span className="sidebar-sub">Cargando…</span>
            )}
            <div className="sidebar-acciones">
              <button type="button" onClick={alternarTema} className="btn-sidebar" aria-label="Cambiar tema claro u oscuro">
                {tema === "oscuro" ? "Tema claro" : "Tema oscuro"}
              </button>
              <button type="button" onClick={cerrarSesion} className="btn-sidebar">Salir</button>
            </div>
          </div>
        </div>
      </aside>

      {/* ================= Contenido ================= */}
      <main className="main">
        <header className="page-head" id="resumen">
          <div>
            <h1>Panel de producción</h1>
            <p className="page-sub">
              Lavadero de zanahorias · {hoy ? `Hoy ${etiquetaDia(hoy)}` : "—"}
              {actualizadoEn && ` · actualizado ${actualizadoEn.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
            </p>
          </div>
          <div className="segmentado" role="radiogroup" aria-label="Datos a mostrar">
            {(["real", "prueba", "todos"] as Vista[]).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={vista === v}
                className={vista === v ? "activo" : ""}
                onClick={() => setVista(v)}
              >
                {{ real: "Reales", prueba: "Prueba", todos: "Todos" }[v]}
              </button>
            ))}
          </div>
        </header>

        {/* ---- Avisos ---- */}
        {modoSimulado && (
          <div className="aviso aviso-prueba">
            Base de datos no configurada: se muestran datos simulados de ejemplo, no detecciones reales.
          </div>
        )}
        {errorCarga && (
          <div className="aviso aviso-critico" role="alert">
            No se pudo actualizar la información. Se muestran los últimos datos recibidos.
          </div>
        )}
        {vista !== "real" && !modoSimulado && (
          <div className="aviso aviso-prueba">
            {vista === "prueba"
              ? "Estás viendo DATOS DE PRUEBA. No corresponden a detecciones reales del sistema de visión."
              : "Vista combinada: los datos de prueba están marcados con la etiqueta «Prueba»."}
          </div>
        )}
        {vista === "real" && !hayReales && !cargando && !modoSimulado && (
          <div className="aviso aviso-info">
            Todavía no hay conteos reales del sistema de visión.
            {cantidadPrueba > 0 && (
              <>
                {" "}Hay {cantidadPrueba} registro{cantidadPrueba !== 1 ? "s" : ""} de prueba.{" "}
                <button type="button" className="btn-link" onClick={() => setVista("prueba")}>Ver datos de prueba</button>
              </>
            )}
          </div>
        )}
        {discrepanciasVista > 0 && (
          <div className="aviso aviso-critico">
            <span aria-hidden="true">⚠</span> {discrepanciasVista} conteo{discrepanciasVista !== 1 ? "s" : ""} con discrepancia
            entre el conteo automático y el reporte del contratista.{" "}
            <button type="button" className="btn-link" onClick={() => { setSoloDiscrepancias(true); location.hash = "historial"; }}>
              Revisar
            </button>
          </div>
        )}

        {/* ---- Indicadores ---- */}
        <section className="kpis" aria-label={`Indicadores · ${etiquetaVista}`}>
          <div className="kpi kpi-hero">
            <span className="kpi-label">Producción de hoy</span>
            <span className="kpi-valor">{cargando ? "—" : fmt(produccionHoy?.totalSacos ?? 0)}<span className="kpi-unidad">sacos</span></span>
            <span className="kpi-sub">
              {produccionHoy?.registros ?? 0} registro{(produccionHoy?.registros ?? 0) !== 1 ? "s" : ""} hoy
              {vista !== "real" && <> · <EtiquetaPrueba /></>}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Último conteo</span>
            <span className="kpi-valor">{ultimo ? fmt(ultimo.cantidadSacos) : "—"}</span>
            <span className="kpi-sub">
              {ultimo ? <>{tiempoRelativo(fechaDe(ultimo))}{esPrueba(ultimo) && <> · <EtiquetaPrueba /></>}</> : "sin registros"}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Últimos 7 días</span>
            <span className="kpi-valor">{fmt(ultimos7)}</span>
            <span className="kpi-sub">
              {tendencia === null ? (
                "sin periodo anterior para comparar"
              ) : (
                <span className={tendencia >= 0 ? "delta-sube" : "delta-baja"}>
                  {tendencia >= 0 ? "▲" : "▼"} {Math.abs(tendencia)} % vs. 7 días previos
                </span>
              )}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Confianza media del modelo</span>
            <span className={`kpi-valor ${confianzaMedia === null ? "kpi-valor-sm" : ""}`}>
              {confianzaMedia === null ? "No disponible" : `${confianzaMedia.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`}
            </span>
            <span className="kpi-sub">
              {confianzaMedia === null
                ? "el detector aún no reporta confianza"
                : `${confianzas.length} de ${conteosVista.length} registros la reportan`}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Discrepancias</span>
            <span className="kpi-valor">
              {discrepanciasVista > 0 && <span className="estado-icono estado-critico" aria-hidden="true">⚠</span>}
              {discrepanciasVista}
            </span>
            <span className="kpi-sub">de {conteosVista.length} registros recientes</span>
          </div>
        </section>

        {/* ---- Producción diaria ---- */}
        <section className="tarjeta" id="produccion">
          {/* Foto de la planta (#81): decorativa, se carga al acercarse a la sección */}
          <img
            className="tarjeta-foto"
            src="/fotos/produccion.webp"
            srcSet="/fotos/produccion-640.webp 640w, /fotos/produccion.webp 1280w"
            sizes="(max-width: 900px) 100vw, 1000px"
            alt="Fila de sacos de zanahoria junto a las pozas de lavado"
            width={1280}
            height={720}
            loading="lazy"
            decoding="async"
          />
          <div className="tarjeta-head">
            <div>
              <h2>Producción diaria</h2>
              <p className="tarjeta-sub">Sacos contados por día · últimos {diasSerie} días · hora de Lima · {etiquetaVista.toLowerCase()}</p>
            </div>
          </div>
          {dias.length > 0 ? <GraficoProduccion dias={dias} hoy={hoy} /> : <p className="vacio">Sin datos de producción.</p>}
        </section>

        {/* ---- Cámaras ---- */}
        <section className="tarjeta" id="camaras">
          <div className="tarjeta-head">
            <div>
              <h2>Cámaras y fuentes de conteo</h2>
              <p className="tarjeta-sub">
                El sistema de visión aún no envía señal de estado (en línea / fuera de línea). Se muestra el último conteo recibido de cada fuente.
              </p>
            </div>
          </div>
          {fuentesVista.length === 0 ? (
            <p className="vacio">Ninguna cámara ha enviado conteos todavía.</p>
          ) : (
            <ul className="fuentes">
              {fuentesVista.map((f) => (
                <li key={`${f.fuenteCamara}-${f.esPrueba}`} className="fuente">
                  <span className="estado-punto estado-desconocido" aria-hidden="true" />
                  <div className="fuente-info">
                    <span className="fuente-nombre">
                      {f.fuenteCamara ?? "Sin identificar"} {f.esPrueba && <EtiquetaPrueba />}
                    </span>
                    <span className="fuente-meta">
                      Estado: sin telemetría · último conteo {tiempoRelativo(f.ultimoRegistro)} ({new Date(f.ultimoRegistro).toLocaleString("es-PE")}) · {f.registros} registro{f.registros !== 1 ? "s" : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Historial ---- */}
        <section className="tarjeta" id="historial">
          <div className="tarjeta-head">
            <div>
              <h2>Historial de conteos</h2>
              <p className="tarjeta-sub">
                {conteosFiltrados.length} registro{conteosFiltrados.length !== 1 ? "s" : ""} · {fmt(totalFiltrado)} sacos
                {hayFiltrosActivos ? " (con filtros)" : ""} · últimos {LIMITE_HISTORIAL} como máximo
                {pendientesVista > 0 && <> · {pendientesVista} pendiente{pendientesVista !== 1 ? "s" : ""} de validación</>}
              </p>
            </div>
            <button onClick={exportarCSV} className="btn-acento" disabled={conteosFiltrados.length === 0}>
              Exportar CSV
            </button>
          </div>

          <div className="filtros">
            <input
              type="search"
              placeholder="Buscar por cámara u origen…"
              value={filtroCamara}
              onChange={(e) => setFiltroCamara(e.target.value)}
              className="filtro-input"
              aria-label="Buscar por cámara u origen"
            />
            <label className="filtro-fecha">
              Desde
              <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
            </label>
            <label className="filtro-fecha">
              Hasta
              <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
            </label>
            <label className="filtro-check">
              <input type="checkbox" checked={soloDiscrepancias} onChange={(e) => setSoloDiscrepancias(e.target.checked)} />
              Solo discrepancias
            </label>
            <label className="filtro-fecha">
              Validación
              <select value={filtroValidacion} onChange={(e) => setFiltroValidacion(e.target.value as EstadoValidacion | "")}>
                <option value="">Todas</option>
                {ESTADOS_VALIDACION.map((e) => (
                  <option key={e} value={e}>{ETIQUETA_ESTADO_VALIDACION[e]}</option>
                ))}
              </select>
            </label>
            {hayFiltrosActivos && (
              <button onClick={limpiarFiltros} className="btn-secundario">Limpiar filtros</button>
            )}
          </div>

          {hayDiscrepanciasFiltradas && (
            <p className="nota-critica"><span aria-hidden="true">⚠</span> Las filas marcadas tienen discrepancia con el reporte del contratista.</p>
          )}

          <div className="tabla-scroll">
            <table className="historial">
              <thead>
                <tr>
                  <th aria-label="Detalle"></th>
                  <th>Fecha y hora</th>
                  <th className="num">Sacos</th>
                  <th>Cámara / origen</th>
                  <th className="num">Confianza</th>
                  <th>Contratista</th>
                  <th>Validación</th>
                </tr>
              </thead>
              <tbody>
                {conteosFiltrados.map((c) => {
                  const expandida = filaExpandida === c.id;
                  const confianza = confianzaNumerica(c.confianzaPromedio);
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={`fila ${c.discrepancia ? "fila-discrepancia" : ""} ${esPrueba(c) ? "fila-prueba" : ""}`}
                        onClick={() => setFilaExpandida(expandida ? null : c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setFilaExpandida(expandida ? null : c.id);
                          }
                        }}
                        tabIndex={0}
                        aria-expanded={expandida}
                      >
                        <td data-label="" className="celda-toggle" aria-hidden="true">{expandida ? "▾" : "▸"}</td>
                        <td data-label="Fecha">
                          {new Date(fechaDe(c)).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {esPrueba(c) && <> <EtiquetaPrueba /></>}
                        </td>
                        <td data-label="Sacos" className="num fuerte">{fmt(c.cantidadSacos)}</td>
                        <td data-label="Origen" className="tenue">{c.fuenteCamara ?? "—"}</td>
                        <td data-label="Confianza" className="num">{confianza === null ? <span className="tenue">—</span> : `${confianza.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`}</td>
                        <td data-label="Contratista">
                          {c.reporteContratista ? (
                            <>
                              {fmt(c.reporteContratista.cantidadReportada)}{" "}
                              {c.discrepancia ? (
                                <span className="badge badge-critico"><span aria-hidden="true">⚠</span> discrepancia</span>
                              ) : (
                                <span className="badge badge-ok"><span aria-hidden="true">✓</span> coincide</span>
                              )}
                            </>
                          ) : (
                            <span className="tenue">sin reporte</span>
                          )}
                        </td>
                        <td data-label="Validación"><BadgeValidacion estado={estadoDe(c)} /></td>
                      </tr>
                      {expandida && (
                        <tr className="fila-detalle">
                          <td colSpan={7}>
                            <dl className="detalle-grid">
                              <div><dt>ID de registro</dt><dd>{c.id}</dd></div>
                              <div><dt>Fecha del conteo</dt><dd>{c.contadoEn ? new Date(c.contadoEn).toLocaleString("es-PE") : <span className="tenue">No informada (registro anterior)</span>}</dd></div>
                              <div><dt>Recibido en la web</dt><dd>{new Date(c.creadoEn).toLocaleString("es-PE")}</dd></div>
                              <div><dt>Tipo de dato</dt><dd>{esPrueba(c) ? "Prueba (no es una detección real)" : "Real"}</dd></div>
                              <div><dt>Origen del registro</dt><dd className="mono">{c.origen ?? "—"}</dd></div>
                              <div><dt>Cámara / fuente</dt><dd className="mono">{c.fuenteCamara ?? "—"}</dd></div>
                              <div><dt>Confianza del modelo</dt><dd>{formatoConfianza(c.confianzaPromedio)}</dd></div>
                              <div>
                                <dt>Reporte del contratista</dt>
                                <dd>
                                  {c.reporteContratista
                                    ? `${fmt(c.reporteContratista.cantidadReportada)} sacos${c.reporteContratista.nombreContratista ? " — " + c.reporteContratista.nombreContratista : ""}`
                                    : "sin reporte"}
                                </dd>
                              </div>
                              <div>
                                <dt>Comparación con el contratista</dt>
                                <dd>{c.discrepancia ? "⚠ Discrepancia con el reporte manual" : "✓ Coincide o sin reporte"}</dd>
                              </div>
                            </dl>
                            {!modoSimulado && (
                              <>
                                <ValidacionConteo conteo={c} esAdmin={esAdmin} onValidado={cargar} />
                                <EvidenciasConteo conteoId={c.id} esAdmin={esAdmin} />
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {conteosFiltrados.length === 0 && (
                  <tr className="fila-vacia">
                    <td colSpan={7}>
                      {conteosVista.length === 0
                        ? vista === "real" ? "Todavía no hay conteos reales registrados." : "No hay conteos en esta vista."
                        : "Ningún registro coincide con los filtros aplicados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {esAdmin && (
          <>
            <ReporteContratistaModule conteo={conteoParaModulos} onRegistrado={cargar} />
            <VentasModule conteo={conteoParaModulos} />
          </>
        )}

        <footer className="pie">MACROMEC J&amp;S S.A.C. · Sistema de conteo automatizado de sacos</footer>
      </main>
    </div>
  );
}
