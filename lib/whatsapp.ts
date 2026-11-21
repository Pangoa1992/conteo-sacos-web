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
  // Mes 1–12 y año; null = el mes actual / el año que corresponda (ver mesConsultado).
  | { tipo: "mes"; mes: number | null; anio: number | null }
  | { tipo: "mes_invalido" }
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

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * «mes», «mes 10», «mes 10/2026», «mes octubre», «mes octubre 2025», «octubre»…
 * Devuelve null si el texto no pide un mes.
 */
function interpretarMes(primera: string, resto: string[]): Comando | null {
  const esMesSolo = MESES[primera] !== undefined;
  if (primera !== "mes" && !esMesSolo) return null;
  const partes = esMesSolo ? [primera, ...resto] : resto;
  // La normalización quita «.» y «,», no «/» ni «-»: «10/2026» y «10-2026» llegan juntos.
  const texto = partes.join(" ").replace(/^de\s+/, "").trim();
  if (!texto) return { tipo: "mes", mes: null, anio: null };
  const m = /^(?:(\d{1,2})|([a-z]+))(?:\s*(?:\/|-|\s|del?\s)\s*(\d{4}))?$/.exec(texto);
  if (!m) return { tipo: "mes_invalido" };
  const mes = m[1] ? Number(m[1]) : MESES[m[2]];
  const anio = m[3] ? Number(m[3]) : null;
  if (!mes || mes < 1 || mes > 12 || (anio !== null && (anio < 2000 || anio > 2100))) return { tipo: "mes_invalido" };
  return { tipo: "mes", mes, anio };
}

/**
 * Mes AAAA-MM que pide el comando, según la fecha de hoy (AAAA-MM-DD, hora de Lima).
 * Sin año: el mes de este año, o del año pasado si ese mes todavía no llega.
 */
export function mesConsultado(c: { mes: number | null; anio: number | null }, hoy: string): string {
  const anioHoy = Number(hoy.slice(0, 4));
  const mesHoy = Number(hoy.slice(5, 7));
  const mes = c.mes ?? mesHoy;
  const anio = c.anio ?? (mes > mesHoy ? anioHoy - 1 : anioHoy);
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

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
  const mes = interpretarMes(primera, resto);
  if (mes) return mes;
  const tipo = PALABRAS[primera];
  if (tipo && tipo !== "lote") return { tipo } as Comando;
  if (/saco|conteo|cuant/.test(t)) return { tipo: "ultimo" };
  return { tipo: "saludo" };
}

/**
 * Identificador privado que WhatsApp envía en lugar del teléfono cuando el usuario lo oculta
 * («whatsapp:PE.1111111111111111»): código de país ISO, punto y el identificador propio de la cuenta.
 */
const IDENTIFICADOR_WHATSAPP = /^[A-Z]{2}\.[A-Za-z0-9]{6,128}$/;

/**
 * Remitente de WhatsApp normalizado, o null: número internacional (+ y 8 a 15 dígitos)
 * o identificador privado de WhatsApp («PE.1111…»), que se compara exacto.
 */
export function normalizarNumero(valor: string | null | undefined): string | null {
  const sinPrefijo = (valor ?? "").trim().replace(/^whatsapp:/i, "").trim();
  if (IDENTIFICADOR_WHATSAPP.test(sinPrefijo)) return sinPrefijo;
  const limpio = sinPrefijo.replace(/[\s\-().]/g, "");
  return /^\+\d{8,15}$/.test(limpio) ? limpio : null;
}

// Separados por comas, punto y coma o saltos de línea; los espacios dentro de un número se ignoran.
const SEPARADOR_NUMEROS = /[,;\n]+/;

/** Largo máximo del nombre de un contacto autorizado. */
export const LONGITUD_MAXIMA_CONTACTO = 60;

/**
 * Una entrada de la lista: «+51987654321» o, con nombre, «Juan Pérez=+51987654321».
 * El nombre identifica en la bitácora del panel QUIÉN consultó, sin mostrar su número.
 */
function leerEntrada(parte: string): { numero: string | null; nombre: string | null } {
  const igual = parte.indexOf("=");
  const nombre = igual >= 0 ? parte.slice(0, igual).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, LONGITUD_MAXIMA_CONTACTO) || null : null;
  return { numero: normalizarNumero(igual >= 0 ? parte.slice(igual + 1) : parte), nombre };
}

/** Contactos autorizados: número normalizado → nombre (o null si no se indicó). */
export function leerContactosAutorizados(valor: string | null | undefined): Map<string, string | null> {
  const contactos = new Map<string, string | null>();
  for (const parte of (valor ?? "").split(SEPARADOR_NUMEROS)) {
    const { numero, nombre } = leerEntrada(parte);
    if (numero && !contactos.get(numero)) contactos.set(numero, nombre);
  }
  return contactos;
}

/** Números autorizados de la variable de entorno (se ignoran los mal escritos). */
export function leerNumerosAutorizados(valor: string | null | undefined): Set<string> {
  return new Set(leerContactosAutorizados(valor).keys());
}

/** Cuántas entradas de la variable no son un número válido (para el estado del panel; nunca cuáles). */
export function contarEntradasNoValidas(valor: string | null | undefined): number {
  return (valor ?? "").split(SEPARADOR_NUMEROS).filter((parte) => parte.trim() !== "" && !leerEntrada(parte).numero).length;
}

/** Número para registros: código de país y dos últimas cifras («+51•••••••34», «PE.•••11»). */
export function enmascararNumero(valor: string | null | undefined): string {
  const n = normalizarNumero(valor);
  if (!n) return "(número no válido)";
  if (!n.startsWith("+")) return `${n.slice(0, 3)}•••${n.slice(-2)}`;
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
  "• *mes* — producción del mes · *mes 10* o *mes octubre 2026* — un mes anterior\n" +
  "• *discrepancias* — diferencias con el contratista pendientes de revisión\n" +
  "• *lote 123* — detalle de un lote\n" +
  "• 📷 Envíe una *foto* de los sacos: le respondo cuántos contó la IA y queda en el panel para que el personal la registre como lote\n\n" +
  "Solo se informan datos reales. La IA cuenta sacos; la clasificación la registra el personal.";

export const TEXTO_NO_AUTORIZADO =
  "Este número no está autorizado para consultar la producción. Comuníquese con el personal de MACROMEC.";

export const TEXTO_SIN_LISTA =
  "El servicio de consultas por WhatsApp aún no está habilitado. Comuníquese con el personal de MACROMEC.";

export const TEXTO_ERROR = "No se pudo consultar la información en este momento. Intente nuevamente en unos minutos.";

export const TEXTO_LOTE_INVALIDO = "Indique el número del lote, por ejemplo: *lote 123*.";

export const TEXTO_MES_INVALIDO = "Indique el mes, por ejemplo: *mes 10*, *mes 10/2026* o *mes octubre*.";

// --- Modo DEMO (ver lib/modo-demo-whatsapp.ts) ---
export const ETIQUETA_DEMO = "🧪 DEMO · datos de prueba";
export const ACLARACION_DEMO = "ℹ️ Demostración: estos no son datos de producción.";

export const TEXTO_AYUDA_DEMO = TEXTO_AYUDA.replace(
  "Solo se informan datos reales.",
  "En esta demostración solo se informan lotes de prueba."
);

/**
 * Respuesta del modo DEMO: la etiqueta al inicio y la aclaración al final.
 * El texto se recorta antes de añadirlas, así que el límite de Twilio
 * nunca quita ninguna de las dos.
 */
export function marcarDemo(texto: string, maximo = LONGITUD_MAXIMA_RESPUESTA): string {
  const inicio = `${ETIQUETA_DEMO}\n\n`;
  const fin = `\n\n${ACLARACION_DEMO}`;
  return inicio + limitarRespuesta(texto, maximo - inicio.length - fin.length) + fin;
}
