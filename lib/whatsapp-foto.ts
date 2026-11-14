/**
 * Conteo de sacos por foto enviada por WhatsApp: reglas sin red ni base de datos,
 * para poder probarlas por separado (ver lib/whatsapp-foto-servidor.ts).
 *
 * El personal autorizado manda una foto al número de WhatsApp y el bot responde
 * cuántos sacos contó el mismo modelo de «Contar por foto» (RF-DETR). La foto y el
 * resultado NO se guardan ni se registran como lote: para eso está el panel web.
 */

/** Tipos de imagen que se aceptan (WhatsApp envía las fotos como JPEG). */
export const TIPOS_IMAGEN_ACEPTADOS = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/** WhatsApp limita las imágenes a 5 MB; se acepta hasta ese tamaño al descargar. */
export const BYTES_MAXIMOS_IMAGEN_WHATSAPP = 5 * 1024 * 1024;

export type AdjuntoWhatsapp = { url: string; tipo: string };

export type MensajeConAdjuntos =
  | { tipo: "sin_adjuntos" }
  | { tipo: "imagen"; adjunto: AdjuntoWhatsapp; adjuntos: number }
  | { tipo: "no_imagen"; adjuntos: number };

/** Host desde el que Twilio sirve los archivos recibidos (la URL viene en el mensaje firmado). */
const HOST_MEDIOS_TWILIO = "api.twilio.com";

/**
 * Indica si la URL del archivo es de Twilio: https, host api.twilio.com y ruta de la
 * cuenta. Aunque el mensaje ya viene firmado, nunca se descarga desde otra dirección.
 */
export function esUrlMedioTwilio(valor: string | null | undefined): boolean {
  try {
    const url = new URL(valor ?? "");
    return url.protocol === "https:" && url.hostname === HOST_MEDIOS_TWILIO && !url.username && !url.password
      && /^\/\d{4}-\d{2}-\d{2}\/Accounts\/AC[0-9a-f]{32}\/Messages\/[A-Za-z0-9]+\/Media\/[A-Za-z0-9]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Tipo de contenido sin parámetros y en minúsculas («image/jpeg; x=1» → «image/jpeg»). */
export function tipoBase(tipo: string | null | undefined): string {
  return (tipo ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Qué adjuntos trae el mensaje de Twilio (NumMedia, MediaUrl0, MediaContentType0…).
 * Se cuenta solo la PRIMERA imagen válida; si hay varias, la respuesta lo aclara.
 */
export function leerAdjuntos(params: Record<string, string>): MensajeConAdjuntos {
  const total = Math.min(Number.parseInt(params["NumMedia"] ?? "0", 10) || 0, 10);
  if (total <= 0) return { tipo: "sin_adjuntos" };
  for (let i = 0; i < total; i++) {
    const url = params[`MediaUrl${i}`];
    const tipo = tipoBase(params[`MediaContentType${i}`]);
    if (TIPOS_IMAGEN_ACEPTADOS.has(tipo) && esUrlMedioTwilio(url)) {
      return { tipo: "imagen", adjunto: { url, tipo }, adjuntos: total };
    }
  }
  return { tipo: "no_imagen", adjuntos: total };
}

/** Datos del conteo necesarios para la respuesta. */
export type ResumenConteoWhatsapp = { total: number; confianzaPromedio: number | null };

const formatoPorcentaje = (n: number) => `${n.toFixed(1)} %`;

/** Respuesta con el resultado del conteo. */
export function textoResultadoFoto(resultado: ResumenConteoWhatsapp, adjuntos = 1): string {
  const varias = adjuntos > 1 ? "\n\nℹ️ Llegaron varias fotos: se contó solo la primera. Envíe una foto por mensaje." : "";
  if (resultado.total === 0) {
    return "📷 Foto recibida.\n\n" +
      "No se detectaron sacos en la foto.\n" +
      "Consejo: tome la foto de frente, con buena luz y con los sacos completos dentro de la imagen." + varias;
  }
  const confianza = resultado.confianzaPromedio !== null
    ? `\nConfianza promedio: ${formatoPorcentaje(resultado.confianzaPromedio)}`
    : "";
  return "📷 Foto recibida.\n\n" +
    `✅ Sacos contados: *${resultado.total}*${confianza}\n\n` +
    "Conteo automático con IA (RF-DETR). Este resultado no se registra como lote; " +
    "para registrarlo use «Contar por foto» en el panel web." + varias;
}

export const TEXTO_FOTO_NO_IMAGEN =
  "Solo puedo contar sacos en *fotos* (JPEG o PNG). Los audios, videos y documentos no se procesan.";

export const TEXTO_FOTO_INVALIDA =
  "No se pudo leer la foto (archivo dañado o demasiado grande). Envíela nuevamente como foto, no como documento.";

export const TEXTO_FOTO_NO_CONFIGURADO =
  "El conteo por foto no está disponible en este momento. Comuníquese con el personal de MACROMEC.";

export const TEXTO_FOTO_ERROR =
  "No se pudo contar la foto en este momento (el servicio de detección no respondió a tiempo). Intente nuevamente en unos minutos.";
