"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { VentasModule } from "./VentasModule";
import { InventarioModule } from "./InventarioModule";
import { ContratistasModule } from "./ContratistasModule";
import { EstadoWhatsapp } from "./EstadoWhatsapp";
import { ConteoPorFoto } from "./ConteoPorFoto";
import { ConteoPorVideo } from "./ConteoPorVideo";
import { GraficoProduccion, etiquetaDia, type DiaProduccion } from "./GraficoProduccion";
import { ProduccionValidada, type FilaValidacionDiaria } from "./ProduccionValidada";
import { BadgeValidacion, ValidacionConteo } from "./ValidacionConteo";
import { EvidenciasConteo } from "./EvidenciasConteo";
import { UsuariosModule } from "./UsuariosModule";
import { RespaldoModule } from "./RespaldoModule";
import { MiCuenta } from "./MiCuenta";
import { ESTADOS_VALIDACION, ETIQUETA_ESTADO_VALIDACION, type EstadoValidacion } from "@/lib/conteos";
import { etiquetaMes, mesesDisponibles, porcentaje, rangoMes, resumirValidacion, type FilaValidacion, type FilaValidacionMensual } from "@/lib/produccion-validada";
import { parametrosHistorial } from "@/lib/historial";
import { BotonPdf } from "@/components/BotonPdf";

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

type Fuente = { fuenteCamara: string | null; esPrueba: boolean; ultimoRegistro: string; registros: number };
type Resumen = {
  hoy: string | null;
  diasSerie?: number;
  diarioPorEstado?: FilaValidacionDiaria[];
  validacion?: FilaValidacion[];
  mensualPorEstado?: FilaValidacionMensual[];
  fuentes: Fuente[];
};

type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "admin_macromec" | "cliente";
};

/** Qué datos se muestran: los de prueba nunca se mezclan con los reales salvo en "todos". */
type Vista = "real" | "prueba" | "todos";

const LIMITE_HISTORIAL = 200;

type Modulo = { id: string; texto: string };
type Grupo = { id: string; texto: string; modulos: Modulo[] };

/**
 * Menú agrupado (observación de la entrega del 20/11/2026): los módulos que se relacionan
 * van juntos y se eligen con pestañas dentro del grupo. El hash de la URL sigue siendo el
 * del módulo (#historial, #ventas…), así los enlaces anteriores siguen funcionando.
 */
function gruposDelMenu(esAdmin: boolean, conCuenta: boolean): Grupo[] {
  return [
    { id: "g-resumen", texto: "Resumen", modulos: [{ id: "resumen", texto: "Indicadores" }, { id: "camaras", texto: "Cámaras y fuentes" }] },
    { id: "g-produccion", texto: "Producción", modulos: [{ id: "validada", texto: "Producción validada" }, { id: "produccion", texto: "Producción diaria" }] },
    { id: "g-lotes", texto: "Lotes y contratistas", modulos: [{ id: "historial", texto: "Historial de lotes" }, { id: "contratistas", texto: "Reportes del contratista" }] },
    ...(esAdmin ? [
      { id: "g-registrar", texto: "Registrar conteo", modulos: [{ id: "foto", texto: "Por foto" }, { id: "video", texto: "Por video" }] },
      { id: "g-comercial", texto: "Inventario y ventas", modulos: [{ id: "inventario", texto: "Inventario" }, { id: "ventas", texto: "Ventas" }] },
      { id: "g-whatsapp", texto: "WhatsApp", modulos: [{ id: "whatsapp", texto: "WhatsApp" }] },
      { id: "g-admin", texto: "Administración", modulos: [{ id: "usuarios", texto: "Usuarios" }, { id: "respaldo", texto: "Respaldo" }] },
    ] : []),
    ...(conCuenta ? [{ id: "g-cuenta", texto: "Mi cuenta", modulos: [{ id: "cuenta", texto: "Mi cuenta" }] }] : []),
  ];
}
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
  // Módulo pedido en el hash de la URL (#historial…); el que se muestra se deriva de los permisos (ver abajo).
  const [seccionPedida, setSeccionPedida] = useState("resumen");

  // Filtros del historial
  const [filtroCamara, setFiltroCamara] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [soloDiscrepancias, setSoloDiscrepancias] = useState(false);
  const [filtroValidacion, setFiltroValidacion] = useState<EstadoValidacion | "">("");
  // Lotes del periodo elegido traídos del servidor (meses anteriores incluidos); null = últimos LIMITE_HISTORIAL.
  const [conteosPeriodo, setConteosPeriodo] = useState<Conteo[] | null>(null);
  const [hayMasPeriodo, setHayMasPeriodo] = useState(false);
  const [cargandoPeriodo, setCargandoPeriodo] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState<string | null>(null);

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
    const res = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
    // Servidor caído o respuesta sin JSON: no romper el panel (cargar() ya muestra el aviso de conexión).
    const data = await res?.json().catch(() => null);
    if (!res || !data) return;
    // Sesión revocada (cuenta desactivada, contraseña o rol cambiados) o vencida: volver al login.
    // Recarga completa: no quedan en pantalla los datos de la sesión anterior.
    if (res.ok && !data.usuario) {
      window.location.assign("/login");
      return;
    }
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
  const esPrueba = useCallback((c: { esPrueba?: boolean }) => modoSimulado || !!c.esPrueba, [modoSimulado]);
  const enVista = useCallback((prueba: boolean) => vista === "todos" || (vista === "prueba") === prueba, [vista]);

  const conteosVista = useMemo(() => conteos.filter((c) => enVista(esPrueba(c))), [conteos, enVista, esPrueba]);
  const ultimo = conteosVista[0];
  const hayReales = conteos.some((c) => !esPrueba(c));
  const cantidadPrueba = conteos.filter((c) => esPrueba(c)).length;

  // ---- Producción diaria (desde /api/conteo/resumen, agregada en la BD) ----
  // El total del día es lo detectado por la IA; se reparte por estado de validación.
  const hoy = resumen?.hoy ?? null;
  const diasSerie = resumen?.diasSerie ?? 14;
  const dias: DiaProduccion[] = useMemo(() => {
    if (!hoy) return [];
    const porFecha = new Map<string, DiaProduccion>();
    for (let i = diasSerie - 1; i >= 0; i--) {
      const fecha = sumarDias(hoy, -i);
      porFecha.set(fecha, { fecha, totalSacos: 0, registros: 0, porEstado: { pendiente: 0, aprobado: 0, observado: 0, rechazado: 0 } });
    }
    for (const fila of resumen?.diarioPorEstado ?? []) {
      const dia = porFecha.get(fila.fecha);
      if (dia && enVista(fila.esPrueba) && fila.estado in dia.porEstado) {
        dia.totalSacos += fila.totalSacos;
        dia.registros += fila.registros;
        dia.porEstado[fila.estado] += fila.totalSacos;
      }
    }
    return [...porFecha.values()];
  }, [resumen, hoy, diasSerie, enVista]);

  const produccionHoy = dias.find((d) => d.fecha === hoy);
  // Mes en curso (hora de Lima): detectado y validado, para el Resumen.
  const mesActual = useMemo(() => {
    const mes = hoy?.slice(0, 7);
    return resumirValidacion((resumen?.mensualPorEstado ?? []).filter((f) => f.mes === mes), enVista);
  }, [resumen, hoy, enVista]);
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
  // Con fechas, el historial pide al servidor los lotes de ese periodo: así se consultan meses
  // anteriores aunque no estén entre los últimos LIMITE_HISTORIAL. Se refresca con el panel.
  const hayPeriodo = !!(filtroDesde || filtroHasta);
  useEffect(() => {
    if (!hayPeriodo || modoSimulado) {
      setConteosPeriodo(null);
      setHayMasPeriodo(false);
      return;
    }
    let vigente = true;
    const p = new URLSearchParams({ limite: String(LIMITE_HISTORIAL) });
    if (filtroDesde) p.set("desde", filtroDesde);
    if (filtroHasta) p.set("hasta", filtroHasta);
    setCargandoPeriodo(true);
    fetch(`/api/conteo?${p}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        if (!vigente || !data) return;
        setConteosPeriodo(data.conteos ?? []);
        setHayMasPeriodo(!!data.hayMas);
      })
      .finally(() => { if (vigente) setCargandoPeriodo(false); });
    return () => { vigente = false; };
  }, [hayPeriodo, filtroDesde, filtroHasta, modoSimulado, actualizadoEn]);

  const conteosHistorial = useMemo(
    () => (conteosPeriodo ? conteosPeriodo.filter((c) => enVista(esPrueba(c))) : conteosVista),
    [conteosPeriodo, conteosVista, enVista, esPrueba]
  );
  const mesesHistorial = useMemo(
    () => mesesDisponibles(resumen?.mensualPorEstado ?? [], hoy, enVista),
    [resumen, hoy, enVista]
  );
  // Mes elegido: el que corresponde exactamente a Desde / Hasta.
  const mesFiltro = mesesHistorial.find((m) => { const r = rangoMes(m); return r.desde === filtroDesde && r.hasta === filtroHasta; }) ?? "";
  function elegirMes(mes: string) {
    if (!mes) { setFiltroDesde(""); setFiltroHasta(""); return; }
    const r = rangoMes(mes);
    setFiltroDesde(r.desde);
    setFiltroHasta(r.hasta);
  }

  const conteosFiltrados = useMemo(() => {
    return conteosHistorial.filter((c) => {
      if (soloDiscrepancias && !c.discrepancia) return false;
      if (filtroValidacion && estadoDe(c) !== filtroValidacion) return false;
      if (filtroCamara && !(c.fuenteCamara ?? "").toLowerCase().includes(filtroCamara.toLowerCase())) return false;
      const fecha = new Date(fechaDe(c));
      if (filtroDesde && fecha < new Date(`${filtroDesde}T00:00:00`)) return false;
      if (filtroHasta && fecha > new Date(`${filtroHasta}T23:59:59.999`)) return false;
      return true;
    });
  }, [conteosHistorial, filtroCamara, filtroDesde, filtroHasta, soloDiscrepancias, filtroValidacion]);

  const totalFiltrado = conteosFiltrados.reduce((sum, c) => sum + c.cantidadSacos, 0);
  const hayDiscrepanciasFiltradas = conteosFiltrados.some((c) => c.discrepancia);

  // El CSV lo genera el servidor con TODO el historial y los mismos filtros (la tabla solo
  // muestra los últimos LIMITE_HISTORIAL). Si falla (p. ej. 413 por demasiados lotes) se avisa.
  async function exportarCSV() {
    const consulta = parametrosHistorial({
      tipo: vista,
      camara: filtroCamara.trim(),
      desde: filtroDesde || null,
      hasta: filtroHasta || null,
      soloDiscrepancias,
      validacion: filtroValidacion || null,
    });
    setExportando(true);
    setErrorExportar(null);
    try {
      const res = await fetch(`/api/conteo?${consulta}&formato=csv`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorExportar(data.error || "No se pudo exportar el historial.");
        return;
      }
      const nombre = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "conteo-sacos.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrorExportar("Error de conexión al exportar. Intente nuevamente.");
    } finally {
      setExportando(false);
    }
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
  // Lotes que se pueden elegir al registrar un reporte de contratista (los de la vista actual).
  const lotesParaReporte = useMemo(() => conteosVista.map((c) => ({
    id: c.id,
    cantidadSacos: c.cantidadSacos,
    fechaConteo: fechaDe(c),
    esPrueba: esPrueba(c),
    estadoValidacion: estadoDe(c),
    reporteVigente: c.reporteContratista ?? null,
  })), [conteosVista, esPrueba]);

  const grupos = gruposDelMenu(esAdmin, !!usuario);
  const secciones = grupos.flatMap((g) => g.modulos);

  // Navegación por módulos: el menú cambia el hash (#historial…) y el área principal muestra solo ese
  // módulo. El hash permite enlaces directos y atrás/adelante del navegador.
  useEffect(() => {
    const leer = () => setSeccionPedida(decodeURIComponent(window.location.hash.slice(1)) || "resumen");
    leer();
    // Atrás/adelante: la página vuelve arriba al cambiar de módulo; sin esto el navegador restauraría la
    // posición guardada de esa entrada y podría dejar el encabezado bajo la barra fija.
    window.history.scrollRestoration = "manual";
    // popstate: atrás/adelante entre las entradas que crea el menú con pushState.
    window.addEventListener("hashchange", leer);
    window.addEventListener("popstate", leer);
    return () => {
      window.removeEventListener("hashchange", leer);
      window.removeEventListener("popstate", leer);
    };
  }, []);
  // Un módulo que no está en el menú de este usuario (p. ej. #inventario de un cliente) muestra el Resumen.
  // Las secciones de admin aparecen al cargar el usuario: hasta entonces no se corrige el hash, para no
  // perder un enlace directo válido del administrador.
  const seccionActiva = secciones.some((s) => s.id === seccionPedida) ? seccionPedida : "resumen";
  useEffect(() => {
    if (usuario && seccionPedida !== seccionActiva) {
      window.history.replaceState(null, "", "#resumen");
      setSeccionPedida("resumen");
    }
  }, [usuario, seccionPedida, seccionActiva]);
  // Cada módulo se ve desde su inicio.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [seccionActiva]);
  const oculto = (id: string) => seccionActiva !== id;
  const grupoActivo = grupos.find((g) => g.modulos.some((m) => m.id === seccionActiva)) ?? grupos[0];

  /** Abre un módulo: entrada nueva en el historial del navegador y vuelta arriba. */
  function irA(id: string, e?: MouseEvent) {
    setMenuAbierto(false);
    // Ctrl/Cmd/Mayús o botón central: comportamiento del navegador (abrir en otra pestaña).
    if (e && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
    // Sin el salto del navegador al ancla, que dejaba la sección bajo la barra fija del celular,
    // también al pulsar el módulo ya abierto: siempre se vuelve arriba.
    e?.preventDefault();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
    setSeccionPedida(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  /** Desde Producción validada: historial con los lotes de ese mes. */
  function verLotesDelMes(mes: string) {
    elegirMes(mes);
    irA("historial");
  }

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
            {grupos.map((g) => (
              <a
                key={g.id}
                href={`#${g.modulos[0].id}`}
                aria-current={grupoActivo?.id === g.id ? "location" : undefined}
                onClick={(e) => irA(g.modulos[0].id, e)}
              >
                {g.texto}
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
        {/* Encabezado común (selector Reales / Prueba / Todos) y avisos: visibles en todos los módulos. */}
        <header className="page-head">
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
              ? "Estás viendo DATOS DE PRUEBA (no son detecciones reales)."
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
        {discrepanciasVista > 0 && (grupoActivo?.id === "g-resumen" || grupoActivo?.id === "g-lotes") && (
          <div className="aviso aviso-critico">
            <span aria-hidden="true">⚠</span> {discrepanciasVista} lote{discrepanciasVista !== 1 ? "s" : ""} con discrepancia
            entre la IA y el reporte del contratista.{" "}
            <button type="button" className="btn-link" onClick={() => { setSoloDiscrepancias(true); location.hash = "historial"; }}>
              Revisar
            </button>
          </div>
        )}

        {/* ---- Pestañas del grupo (módulos relacionados) ---- */}
        {grupoActivo && grupoActivo.modulos.length > 1 && (
          <nav className="pestanas-grupo" aria-label={`Módulos de ${grupoActivo.texto}`}>
            {grupoActivo.modulos.map((m) => (
              <a key={m.id} href={`#${m.id}`} className={seccionActiva === m.id ? "activo" : ""}
                aria-current={seccionActiva === m.id ? "page" : undefined} onClick={(e) => irA(m.id, e)}>
                {m.texto}
              </a>
            ))}
          </nav>
        )}

        {/* ---- Módulos: solo se ve el seleccionado. Siguen montados (hidden) para conservar sus datos y filtros. ---- */}
        {/* ---- Indicadores (Resumen) ---- */}
        <div hidden={oculto("resumen")}>
        <section className="kpis" id="resumen" aria-label={`Indicadores · ${etiquetaVista}`}>
          <div className="kpi kpi-hero">
            <span className="kpi-label">Producción de hoy</span>
            <span className="kpi-valor">{cargando ? "—" : fmt(produccionHoy?.totalSacos ?? 0)}<span className="kpi-unidad">sacos</span></span>
            <span className="kpi-sub">
              {produccionHoy?.registros ?? 0} lote{(produccionHoy?.registros ?? 0) !== 1 ? "s" : ""} hoy
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
                "sin semana anterior"
              ) : (
                <span className={tendencia >= 0 ? "delta-sube" : "delta-baja"}>
                  {tendencia >= 0 ? "▲" : "▼"} {Math.abs(tendencia)} % vs. semana anterior
                </span>
              )}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Este mes{hoy ? ` (${etiquetaMes(hoy.slice(0, 7)).split(" ")[0]})` : ""}</span>
            <span className="kpi-valor">{fmt(mesActual.detectado.sacos)}<span className="kpi-unidad">sacos</span></span>
            <span className="kpi-sub">
              {mesActual.detectado.sacos > 0
                ? `${fmt(mesActual.porEstado.aprobado.sacos)} validados (${Math.round(porcentaje(mesActual.porEstado.aprobado.sacos, mesActual.detectado.sacos) ?? 0)} %)`
                : "sin lotes este mes"}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Confianza media del modelo</span>
            <span className={`kpi-valor ${confianzaMedia === null ? "kpi-valor-sm" : ""}`}>
              {confianzaMedia === null ? "No disponible" : `${confianzaMedia.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`}
            </span>
            <span className="kpi-sub">
              {confianzaMedia === null
                ? "el detector aún no la reporta"
                : `en ${confianzas.length} lotes recientes`}
            </span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Discrepancias</span>
            <span className="kpi-valor">
              {discrepanciasVista > 0 && <span className="estado-icono estado-critico" aria-hidden="true">⚠</span>}
              {discrepanciasVista}
            </span>
            <span className="kpi-sub">IA vs. contratista</span>
          </div>

          <div className="kpi">
            <span className="kpi-label">Pendientes de validar</span>
            <span className="kpi-valor">{fmt(pendientesVista)}<span className="kpi-unidad">lotes</span></span>
            <span className="kpi-sub">
              {pendientesVista > 0
                ? <button type="button" className="btn-link" onClick={() => { setFiltroValidacion("pendiente"); irA("historial"); }}>Revisar ahora</button>
                : "todo revisado"}
            </span>
          </div>
        </section>
        </div>

        {/* ---- Producción validada (etapa 3A) ---- */}
        <div hidden={oculto("validada")}>
        <ProduccionValidada
          validacion={modoSimulado ? [] : resumen?.validacion ?? []}
          diarioPorEstado={modoSimulado ? [] : resumen?.diarioPorEstado ?? []}
          mensualPorEstado={modoSimulado ? [] : resumen?.mensualPorEstado ?? []}
          onVerLotesMes={verLotesDelMes}
          hoy={hoy}
          incluir={enVista}
          esVistaPrueba={vista !== "real"}
          etiquetaVista={etiquetaVista}
          cargando={cargando}
        />
        </div>

        {/* ---- Producción diaria ---- */}
        <div hidden={oculto("produccion")}>
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
              <p className="tarjeta-sub">Sacos por día según su validación · últimos {diasSerie} días · {etiquetaVista.toLowerCase()}</p>
            </div>
          </div>
          {dias.length > 0 ? <GraficoProduccion dias={dias} hoy={hoy} /> : <p className="vacio">Sin datos de producción.</p>}
        </section>
        </div>

        {/* ---- Cámaras ---- */}
        <div hidden={oculto("camaras")}>
        <section className="tarjeta" id="camaras">
          <div className="tarjeta-head">
            <div>
              <h2>Cámaras y fuentes de conteo</h2>
              <p className="tarjeta-sub">
                Actividad de cada cámara o fuente según su último conteo recibido.
              </p>
            </div>
          </div>
          {fuentesVista.length === 0 ? (
            <p className="vacio">Ninguna cámara ha enviado conteos todavía.</p>
          ) : (
            <ul className="fuentes">
              {fuentesVista.map((f) => (
                <li key={`${f.fuenteCamara}-${f.esPrueba}`} className="fuente">
                  <span className={`estado-punto ${Date.now() - new Date(f.ultimoRegistro).getTime() < 24 * 3600_000 ? "estado-ok" : "estado-desconocido"}`} aria-hidden="true" />
                  <div className="fuente-info">
                    <span className="fuente-nombre">
                      {f.fuenteCamara ?? "Sin identificar"} {f.esPrueba && <EtiquetaPrueba />}
                    </span>
                    <span className="fuente-meta">
                      {Date.now() - new Date(f.ultimoRegistro).getTime() < 24 * 3600_000 ? "Activa hoy" : "Sin conteos hoy"} · último conteo {tiempoRelativo(f.ultimoRegistro)} · {fmt(f.registros)} lote{f.registros !== 1 ? "s" : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>

        {/* ---- Historial ---- */}
        <div hidden={oculto("historial")}>
        <section className="tarjeta" id="historial">
          <div className="tarjeta-head">
            <div>
              <h2>Historial de conteos</h2>
              <p className="tarjeta-sub">
                {conteosFiltrados.length} registro{conteosFiltrados.length !== 1 ? "s" : ""} · {fmt(totalFiltrado)} sacos
                {hayFiltrosActivos ? " (con filtros)" : ""}
                {hayPeriodo
                  ? <> · {cargandoPeriodo ? "consultando el periodo…" : hayMasPeriodo ? `se muestran los ${LIMITE_HISTORIAL} más recientes; el CSV incluye todos` : "todos los lotes del periodo"}</>
                  : <> · últimos {LIMITE_HISTORIAL} (elija un mes para ver periodos anteriores)</>}
                {pendientesVista > 0 && <> · {pendientesVista} pendiente{pendientesVista !== 1 ? "s" : ""} de validación</>}
              </p>
            </div>
            <div className="acciones-exportar">
            <BotonPdf seccionId="historial" titulo="Historial de conteos" archivo="historial-conteos" deshabilitado={conteosHistorial.length === 0}
              indicadores={() => [
                { etiqueta: "Lotes", valor: fmt(conteosFiltrados.length), detalle: mesFiltro ? etiquetaMes(mesFiltro) : hayFiltrosActivos ? "con los filtros activos" : "lotes recientes" },
                { etiqueta: "Sacos detectados", valor: fmt(totalFiltrado), detalle: "conteo de la IA, sin modificar", destacado: true },
                { etiqueta: "Promedio por lote", valor: conteosFiltrados.length ? fmt(Math.round(totalFiltrado / conteosFiltrados.length)) : "—", detalle: "sacos" },
                { etiqueta: "Pendientes de validar", valor: fmt(pendientesVista), detalle: "lotes sin revisar" },
              ]} />
            <button
              onClick={exportarCSV}
              className="btn-acento"
              disabled={conteosHistorial.length === 0 || exportando}
              title="Exporta todo el historial con los filtros activos (fechas en hora de Lima)"
            >
              {exportando ? "Exportando…" : "Exportar CSV"}
            </button>
            </div>
          </div>
          {errorExportar && <p className="mensaje mensaje-error" role="alert">{errorExportar}</p>}

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
              Mes
              <select value={mesFiltro} onChange={(e) => elegirMes(e.target.value)}>
                <option value="">{hayPeriodo && !mesFiltro ? "Fechas personalizadas" : "Todos (recientes)"}</option>
                {mesesHistorial.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
              </select>
            </label>
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
                      {cargandoPeriodo && conteosPeriodo === null
                        ? "Consultando el periodo…"
                        : conteosHistorial.length === 0 && hayPeriodo
                        ? "No hay lotes en este periodo."
                        : conteosVista.length === 0
                        ? vista === "real" ? "Todavía no hay conteos reales registrados." : "No hay conteos en esta vista."
                        : "Ningún registro coincide con los filtros aplicados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        </div>

        {/* Contratistas y reportes (etapa 4A): el admin registra; el cliente consulta en solo lectura. */}
        <div hidden={oculto("contratistas")}>
        {!modoSimulado && usuario && (
          <ContratistasModule esAdmin={esAdmin} vista={vista} lotes={lotesParaReporte} recarga={actualizadoEn} onRegistrado={cargar} />
        )}
        </div>

        {esAdmin && (
          <>
            {/* Tras vender, anular o validar se recarga todo el panel: el inventario se actualiza al instante. */}
            <div hidden={oculto("inventario")}>
            <InventarioModule vista={vista} recarga={actualizadoEn} />
            </div>
            <div hidden={oculto("ventas")}>
            <VentasModule incluir={enVista} esVistaPrueba={vista !== "real"} recarga={actualizadoEn} onCambio={cargar} />
            </div>
            {/* Estado de WhatsApp (etapa 5): solo indicadores, sin token, números ni URL. */}
            <div hidden={oculto("whatsapp")}>
            <EstadoWhatsapp recarga={actualizadoEn} onRegistrado={cargar} />
            </div>
            {/* Contar por foto: muestra el resultado y, si el personal lo decide, lo registra como lote pendiente. */}
            <div hidden={oculto("foto")}>
            <ConteoPorFoto visible={!oculto("foto")} onRegistrado={cargar} />
            </div>
            {/* Contar por video: el navegador toma los fotogramas; el servidor detecta y, al registrar, vuelve a contar. */}
            <div hidden={oculto("video")}>
            <ConteoPorVideo visible={!oculto("video")} onRegistrado={cargar} />
            </div>
            {/* Usuarios: alta, rol, contraseña nueva y desactivar (solo personal de MACROMEC). Se monta al abrirlo. */}
            {!oculto("usuarios") && <UsuariosModule />}
            {/* Respaldo: descarga de todos los datos en un ZIP (solo lectura). Se monta al abrirlo. */}
            {!oculto("respaldo") && <RespaldoModule />}
          </>
        )}

        {/* Mi cuenta: cambio de la contraseña propia (todos los roles). */}
        {usuario && !oculto("cuenta") && <MiCuenta usuario={usuario} />}

        <footer className="pie">MACROMEC J&amp;S S.A.C. · Sistema de conteo automatizado de sacos</footer>
      </main>
    </div>
  );
}
