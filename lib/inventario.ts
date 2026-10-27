/**
 * Inventario de sacos (etapa 3C, ampliación del prototipo), compartido por
 * servidor y cliente.
 *
 * Stock disponible = sacos conformes de lotes APROBADOS − ventas activas
 * (no anuladas) de ventas_lote. No hay columna de stock: se calcula en
 * PostgreSQL en cada consulta. Las ventas históricas (tabla ventas, anteriores
 * al control de validación) se conservan aparte y nunca restan del stock.
 * Los sacos observados y defectuosos de lotes aprobados, y los lotes en
 * revisión, se informan por separado: no se pueden vender.
 * Los filtros de fecha usan la fecha original del conteo (contado_en, o
 * creado_en en registros antiguos) en hora de la planta.
 */

export const TIPOS_DATO = ["real", "prueba", "todos"] as const;
export type TipoDato = (typeof TIPOS_DATO)[number];

export const ESTADOS_STOCK = ["todos", "con_stock", "agotado"] as const;
export type EstadoStock = (typeof ESTADOS_STOCK)[number];

export const ETIQUETA_ESTADO_STOCK: Record<EstadoStock, string> = {
  todos: "Todos",
  con_stock: "Con stock",
  agotado: "Agotados",
};

export const LONGITUD_MAXIMA_ORIGEN = 50;

export type FiltrosInventario = {
  desde: string | null; // YYYY-MM-DD (hora de la planta), inclusive
  hasta: string | null;
  origen: string | null; // valor exacto de conteos.origen
  stock: EstadoStock; // solo filtra la tabla por lote, no los totales
  tipo: TipoDato;
};

/** true si es una fecha YYYY-MM-DD que existe en el calendario. */
export function esFechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** Lee y valida los filtros de la URL. Devuelve los errores si alguno no es válido. */
export function leerFiltros(p: URLSearchParams): { filtros: FiltrosInventario } | { errores: string[] } {
  const errores: string[] = [];
  const desde = p.get("desde") || null;
  const hasta = p.get("hasta") || null;
  const origen = p.get("origen") || null;
  const stock = (p.get("stock") || "todos") as EstadoStock;
  const tipo = (p.get("tipo") || "real") as TipoDato;

  if (desde && !esFechaValida(desde)) errores.push("«desde» debe ser una fecha AAAA-MM-DD.");
  if (hasta && !esFechaValida(hasta)) errores.push("«hasta» debe ser una fecha AAAA-MM-DD.");
  if (desde && hasta && esFechaValida(desde) && esFechaValida(hasta) && desde > hasta) {
    errores.push("«desde» no puede ser posterior a «hasta».");
  }
  if (origen && origen.length > LONGITUD_MAXIMA_ORIGEN) errores.push("Origen demasiado largo.");
  if (!ESTADOS_STOCK.includes(stock)) errores.push(`«stock» debe ser ${ESTADOS_STOCK.join(", ")}.`);
  if (!TIPOS_DATO.includes(tipo)) errores.push(`«tipo» debe ser ${TIPOS_DATO.join(", ")}.`);

  return errores.length ? { errores } : { filtros: { desde, hasta, origen, stock, tipo } };
}

/** Parámetros de URL de unos filtros (omite los valores por defecto). */
export function parametrosFiltros(f: FiltrosInventario): URLSearchParams {
  const p = new URLSearchParams();
  if (f.desde) p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  if (f.origen) p.set("origen", f.origen);
  if (f.stock !== "todos") p.set("stock", f.stock);
  p.set("tipo", f.tipo);
  return p;
}

/** Totales del inventario, calculados en PostgreSQL. */
export type ResumenInventario = {
  lotesAprobados: number;
  conformes: number;
  vendidos: number; // ventas activas
  disponibles: number;
  lotesConStock: number;
  lotesAgotados: number;
  ventasActivas: number;
  // Aparte: no se venden.
  observados: number; // de lotes aprobados (clasificación manual)
  defectuosos: number;
  enRevision: { lotes: number; sacos: number }; // estado observado
  pendientes: { lotes: number; sacos: number };
  rechazados: { lotes: number; sacos: number };
  // Ventas históricas de los lotes del filtro: informativas, fuera del stock.
  historicas: { ventas: number; importe: string };
};

export type LoteInventario = {
  conteoId: number;
  fechaConteo: string; // ISO UTC
  fechaPlanta: string; // YYYY-MM-DD en hora de la planta
  fechaHoraPlanta: string; // DD/MM/AAAA HH:MI en hora de la planta (para el CSV)
  origen: string;
  fuenteCamara: string | null;
  esPrueba: boolean;
  cantidadSacos: number; // detectados por la IA (sin modificar)
  conformes: number;
  observados: number;
  defectuosos: number;
  vendidos: number;
  ventasActivas: number;
  disponibles: number;
  ventasHistoricas: number;
};

export type LoteEnRevision = {
  conteoId: number;
  fechaConteo: string;
  origen: string;
  fuenteCamara: string | null;
  esPrueba: boolean;
  cantidadSacos: number;
  observacion: string | null;
};

/** Estado de stock de un lote aprobado. */
export function estadoStock(disponibles: number): Exclude<EstadoStock, "todos"> {
  return disponibles > 0 ? "con_stock" : "agotado";
}

/**
 * Celda CSV entre comillas. Un texto que empieza por = + - @ (o tabulador /
 * retorno) se antepone con ' para que Excel no lo ejecute como fórmula.
 */
export function celdaCsv(v: string | number | null): string {
  let s = v === null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV con BOM UTF-8 y fin de línea CRLF: Excel lo abre con tildes y columnas correctas. */
export function construirCsv(filas: (string | number | null)[][]): string {
  return "﻿" + filas.map((f) => f.map(celdaCsv).join(",")).join("\r\n") + "\r\n";
}
