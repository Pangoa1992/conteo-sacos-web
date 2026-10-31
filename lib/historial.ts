import { ESTADOS_VALIDACION, type EstadoValidacion } from "./conteos";
import { TIPOS_DATO, esFechaValida, type TipoDato } from "./inventario";

// Filtros del historial de conteos, compartidos por el panel y GET /api/conteo?formato=csv
// para que el CSV exporte exactamente lo que se filtra en pantalla, pero de TODO el historial.

export const LONGITUD_MAXIMA_CAMARA = 100;

export type FiltrosHistorial = {
  tipo: TipoDato; // real | prueba | todos (la vista del panel)
  camara: string; // texto contenido en la cámara/origen, sin distinguir mayúsculas ("" = todas)
  desde: string | null; // fecha original del conteo, AAAA-MM-DD en hora de Lima
  hasta: string | null;
  soloDiscrepancias: boolean;
  validacion: EstadoValidacion | null;
};

/** Lee y valida los filtros de la URL. Devuelve los errores si alguno no es válido. */
export function leerFiltrosHistorial(p: URLSearchParams): { filtros: FiltrosHistorial } | { errores: string[] } {
  const errores: string[] = [];
  const tipo = (p.get("tipo") || "real") as TipoDato;
  const camara = (p.get("camara") ?? "").trim();
  const desde = p.get("desde") || null;
  const hasta = p.get("hasta") || null;
  const discrepancias = p.get("discrepancias");
  const validacion = (p.get("validacion") || null) as EstadoValidacion | null;

  if (!TIPOS_DATO.includes(tipo)) errores.push(`«tipo» debe ser ${TIPOS_DATO.join(", ")}.`);
  if (camara.length > LONGITUD_MAXIMA_CAMARA) errores.push("Búsqueda de cámara demasiado larga.");
  if (desde && !esFechaValida(desde)) errores.push("«desde» debe ser una fecha AAAA-MM-DD.");
  if (hasta && !esFechaValida(hasta)) errores.push("«hasta» debe ser una fecha AAAA-MM-DD.");
  if (desde && hasta && esFechaValida(desde) && esFechaValida(hasta) && desde > hasta) errores.push("«desde» no puede ser posterior a «hasta».");
  if (discrepancias !== null && discrepancias !== "" && discrepancias !== "1") errores.push("«discrepancias» debe ser 1 o no indicarse.");
  if (validacion && !ESTADOS_VALIDACION.includes(validacion)) errores.push(`«validacion» debe ser ${ESTADOS_VALIDACION.join(", ")}.`);
  if (errores.length) return { errores };

  return { filtros: { tipo, camara, desde, hasta, soloDiscrepancias: discrepancias === "1", validacion } };
}

/** Parámetros de URL de los filtros (solo los que tienen valor, salvo el tipo). */
export function parametrosHistorial(f: FiltrosHistorial): URLSearchParams {
  const p = new URLSearchParams({ tipo: f.tipo });
  if (f.camara) p.set("camara", f.camara);
  if (f.desde) p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  if (f.soloDiscrepancias) p.set("discrepancias", "1");
  if (f.validacion) p.set("validacion", f.validacion);
  return p;
}
