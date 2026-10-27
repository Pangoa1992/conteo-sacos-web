/**
 * Reportes del contratista (etapa 4A, ampliación del prototipo), compartido
 * por servidor y cliente.
 *
 * Cada reporte es lo que el contratista dice haber armado para un lote. Los
 * reportes nunca se modifican: si hay varios para un mismo lote, el más
 * reciente es el VIGENTE (cuenta en los resúmenes) y los anteriores quedan
 * en el historial como reemplazados.
 *
 * diferencia = sacos reportados − sacos detectados por la IA (con signo).
 * Hay discrepancia cuando |diferencia| > UMBRAL_DISCREPANCIA (lib/conteos).
 * Una discrepancia está "pendiente de revisión" mientras el lote siga
 * pendiente de validación, y "revisada" cuando el personal ya validó el lote
 * (aprobado, observado o rechazado). No existe una acción aparte de
 * "marcar atendida": la revisión ES la validación del lote (etapa 1).
 */
import { UMBRAL_DISCREPANCIA, type EstadoValidacion } from "./conteos";
import { esFechaValida, type TipoDato, TIPOS_DATO } from "./inventario";

export const FILTROS_DISCREPANCIA = ["todos", "con", "sin"] as const;
export type FiltroDiscrepancia = (typeof FILTROS_DISCREPANCIA)[number];

export const ETIQUETA_FILTRO_DISCREPANCIA: Record<FiltroDiscrepancia, string> = {
  todos: "Todos",
  con: "Con discrepancia",
  sin: "Sin discrepancia",
};

export const LONGITUD_MAXIMA_CONTRATISTA = 150;

export type FiltrosReportes = {
  contratista: string | null; // nombre normalizado (ver normalizarContratista)
  lote: number | null; // conteos.id
  desde: string | null; // fecha original del conteo, AAAA-MM-DD, hora de la planta
  hasta: string | null;
  discrepancia: FiltroDiscrepancia; // solo filtra el historial de reportes
  tipo: TipoDato;
};

/**
 * Clave para agrupar por contratista: sin espacios sobrantes y en minúsculas
 * ("Carlos " y "carlos" son el mismo). Sin nombre -> "". La misma regla está
 * en el SQL de GET /api/reportes-contratista: lower(btrim(...)).
 */
export function normalizarContratista(nombre: string | null | undefined): string {
  return (nombre ?? "").trim().toLowerCase();
}

export function hayDiscrepanciaDiferencia(diferencia: number): boolean {
  return Math.abs(diferencia) > UMBRAL_DISCREPANCIA;
}

export type EstadoRevision = "pendiente" | "revisada";

/** Estado de revisión de una discrepancia según la validación del lote; null si no hay discrepancia. */
export function estadoRevision(discrepancia: boolean, estadoValidacion: EstadoValidacion): EstadoRevision | null {
  if (!discrepancia) return null;
  return estadoValidacion === "pendiente" ? "pendiente" : "revisada";
}

/** Lee y valida los filtros de la URL. */
export function leerFiltrosReportes(p: URLSearchParams): { filtros: FiltrosReportes } | { errores: string[] } {
  const errores: string[] = [];
  const contratistaTexto = p.get("contratista");
  const loteTexto = p.get("lote") || null;
  const desde = p.get("desde") || null;
  const hasta = p.get("hasta") || null;
  const discrepancia = (p.get("discrepancia") || "todos") as FiltroDiscrepancia;
  const tipo = (p.get("tipo") || "real") as TipoDato;

  let lote: number | null = null;
  if (loteTexto !== null) {
    if (/^\d{1,9}$/.test(loteTexto) && Number(loteTexto) > 0) lote = Number(loteTexto);
    else errores.push("«lote» debe ser un número de lote.");
  }
  if (contratistaTexto && contratistaTexto.length > LONGITUD_MAXIMA_CONTRATISTA) errores.push("Contratista demasiado largo.");
  if (desde && !esFechaValida(desde)) errores.push("«desde» debe ser una fecha AAAA-MM-DD.");
  if (hasta && !esFechaValida(hasta)) errores.push("«hasta» debe ser una fecha AAAA-MM-DD.");
  if (desde && hasta && esFechaValida(desde) && esFechaValida(hasta) && desde > hasta) errores.push("«desde» no puede ser posterior a «hasta».");
  if (!FILTROS_DISCREPANCIA.includes(discrepancia)) errores.push(`«discrepancia» debe ser ${FILTROS_DISCREPANCIA.join(", ")}.`);
  if (!TIPOS_DATO.includes(tipo)) errores.push(`«tipo» debe ser ${TIPOS_DATO.join(", ")}.`);

  // contratista=  (vacío) no filtra; para los reportes sin nombre se usa contratista=-
  const contratista = contratistaTexto === null || contratistaTexto === "" ? null : contratistaTexto === "-" ? "" : normalizarContratista(contratistaTexto);
  return errores.length ? { errores } : { filtros: { contratista, lote, desde, hasta, discrepancia, tipo } };
}

/** Parámetros de URL de unos filtros (omite los valores por defecto). */
export function parametrosFiltrosReportes(f: FiltrosReportes): URLSearchParams {
  const p = new URLSearchParams();
  if (f.contratista !== null) p.set("contratista", f.contratista === "" ? "-" : f.contratista);
  if (f.lote !== null) p.set("lote", String(f.lote));
  if (f.desde) p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  if (f.discrepancia !== "todos") p.set("discrepancia", f.discrepancia);
  p.set("tipo", f.tipo);
  return p;
}

/** Un reporte del historial, con la comparación contra la IA y la validación humana. */
export type ReporteDetalle = {
  id: number;
  conteoId: number;
  cantidadReportada: number;
  nombreContratista: string | null;
  contratistaClave: string;
  registradoEn: string; // ISO UTC
  vigente: boolean; // el más reciente del lote
  reportesDelLote: number;
  cantidadIA: number;
  diferencia: number;
  discrepancia: boolean;
  revision: EstadoRevision | null; // solo con sentido en el reporte vigente
  estadoValidacion: EstadoValidacion;
  sacosConformes: number | null;
  sacosObservados: number | null;
  sacosDefectuosos: number | null;
  observacionValidacion: string | null;
  validadoEn: string | null;
  fechaConteo: string; // ISO UTC, fecha original del lote
  fechaHoraPlanta: string; // DD/MM/AAAA HH:MI hora de Lima (CSV)
  registradoHoraPlanta: string;
  origen: string;
  fuenteCamara: string | null;
  esPrueba: boolean;
};

/** Totales de los reportes VIGENTES (un lote cuenta una sola vez). */
export type ResumenReportes = {
  lotes: number;
  reportes: number; // todos, incluidos los reemplazados
  reemplazados: number;
  sacosReportados: number;
  sacosIA: number;
  diferenciaNeta: number;
  diferenciaAbsoluta: number;
  coinciden: number; // |diferencia| = 0
  diferenciaDeUno: number; // |diferencia| = 1 (dentro del umbral, se muestra igual)
  conDiscrepancia: number;
  pendientes: number;
  revisadas: number;
};

export type FilaContratista = {
  contratistaClave: string;
  nombre: string; // escritura del reporte más reciente
  lotes: number;
  sacosReportados: number;
  sacosIA: number;
  diferenciaNeta: number;
  diferenciaAbsoluta: number;
  conDiscrepancia: number;
  pendientes: number;
  revisadas: number;
  ultimoReporte: string; // ISO UTC
};

export const SIN_NOMBRE = "(sin nombre)";

export function textoDiferencia(d: number): string {
  return d > 0 ? `+${d.toLocaleString("es-PE")}` : d.toLocaleString("es-PE");
}
