/**
 * Consultas por WhatsApp (etapa 4B, ampliación del prototipo): reglas sin
 * acceso a la base de datos, para poder probarlas por separado.
 *
 *  - Solo responden los números de WHATSAPP_NUMEROS_AUTORIZADOS (formato
 *    internacional, p. ej. +51XXXXXXXXX, separados por comas). Lista vacía o
 *    sin configurar = nadie recibe información de producción.
 *  - Los números nunca se escriben completos en registros ni errores.
 *  - Solo datos reales; nunca ventas ni inventario (ver lib/consultas-whatsapp.ts).
 */

/** Twilio corta los mensajes de WhatsApp en 1.600 caracteres. */
export const LONGITUD_MAXIMA_RESPUESTA = 1600;
/** Del mensaje recibido solo se interpreta el comienzo. */
export const LONGITUD_MAXIMA_MENSAJE = 200;

export type Comando =
  | { tipo: "ayuda" }
  | { tipo: "ultimo" }
  | { tipo: "hoy" }
  | { tipo: "semana" }
  | { tipo: "discrepancias" }
  | { tipo: "lote"; lote: number }
  | { tipo: "lote_invalido" }
  | { tipo: "saludo" }; // mensaje que no es un comando: se responde la ayuda

/** Minúsculas, sin tildes ni signos (¿?¡!.,), con espacios simples. */
export function normalizarTexto(texto: string): string {
  return texto
    .slice(0, LONGITUD_MAXIMA_MENSAJE)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:()"'*_~º°]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PALABRAS: Record<string, Comando["tipo"]> = {
  ayuda: "ayuda",
  menu: "ayuda",
  comandos: "ayuda",
  ultimo: "ultimo",
  hoy: "hoy",
  semana: "semana",
  discrepancias: "discrepancias",
  discrepancia: "discrepancias",
};

/**
 * Comando del mensaje. Se reconoce por la PRIMERA palabra («hoy», «Último»,
 * «LOTE 123»…). Un texto libre que pregunta por sacos o por el conteo
 * («¿cuántos sacos van hoy?») mantiene la respuesta anterior: el último lote.
 */
export function interpretarComando(texto: string): Comando {
  const t = normalizarTexto(texto);
  const [primera = "", ...resto] = t.split(" ");
  if (primera === "lote") {
    const numero = resto.join("").replace(/^(n|no|nro|numero)?#?/, "");
    return /^\d{1,9}$/.test(numero) && Number(numero) > 0 ? { tipo: "lote", lote: Number(numero) } : { tipo: "lote_invalido" };
  }
  const tipo = PALABRAS[primera];
  if (tipo && tipo !== "lote") return { tipo } as Comando;
  if (/saco|conteo|cuant/.test(t)) return { tipo: "ultimo" };
  return { tipo: "saludo" };
}

/** Número de WhatsApp en formato internacional (+ y 8 a 15 dígitos), o null. */
export function normalizarNumero(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim().replace(/^whatsapp:/i, "").replace(/[\s\-().]/g, "");
  return /^\+\d{8,15}$/.test(limpio) ? limpio : null;
}

/** Números autorizados de la variable de entorno (se ignoran los mal escritos). */
export function leerNumerosAutorizados(valor: string | null | undefined): Set<string> {
  const numeros = new Set<string>();
  // Separados por comas, punto y coma o saltos de línea; los espacios dentro de un número se ignoran.
  for (const parte of (valor ?? "").split(/[,;\n]+/)) {
    const n = normalizarNumero(parte);
    if (n) numeros.add(n);
  }
  return numeros;
}

/** Número para registros: código de país y dos últimas cifras («+51•••••••34»). */
export function enmascararNumero(valor: string | null | undefined): string {
  const n = normalizarNumero(valor);
  if (!n) return "(número no válido)";
  return `${n.slice(0, 3)}${"•".repeat(n.length - 5)}${n.slice(-2)}`;
}

/** Recorta una respuesta al límite de Twilio sin cortar a mitad de línea si se puede. */
export function limitarRespuesta(texto: string, maximo = LONGITUD_MAXIMA_RESPUESTA): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.lastIndexOf("\n", maximo - 2);
  return texto.slice(0, corte > maximo / 2 ? corte : maximo - 2).trimEnd() + "\n…";
}

export const TEXTO_AYUDA =
  "Hola 👋 Soy el asistente de Conteo de Sacos — MACROMEC.\n\n" +
  "Escriba uno de estos comandos:\n" +
  "• *último* — último lote contado\n" +
  "• *hoy* — producción de hoy\n" +
  "• *semana* — producción de los últimos 7 días\n" +
  "• *discrepancias* — diferencias con el contratista pendientes de revisión\n" +
  "• *lote 123* — detalle de un lote\n\n" +
  "Solo se informan datos reales. La IA cuenta sacos; la clasificación la registra el personal.";

export const TEXTO_NO_AUTORIZADO =
  "Este número no está autorizado para consultar la producción. Comuníquese con el personal de MACROMEC.";

export const TEXTO_SIN_LISTA =
  "El servicio de consultas por WhatsApp aún no está habilitado. Comuníquese con el personal de MACROMEC.";

export const TEXTO_ERROR = "No se pudo consultar la información en este momento. Intente nuevamente en unos minutos.";

export const TEXTO_LOTE_INVALIDO = "Indique el número del lote, por ejemplo: *lote 123*.";
