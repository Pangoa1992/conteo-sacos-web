import sharp from "sharp";
import { LADO_MAXIMO } from "./evidencias";
import { DeteccionNoDisponible, conteoFotoConfigurado, detectarSacos } from "./conteo-foto-servidor";
import {
  BYTES_MAXIMOS_IMAGEN_WHATSAPP,
  TEXTO_FOTO_ERROR,
  TEXTO_FOTO_INVALIDA,
  TEXTO_FOTO_NO_CONFIGURADO,
  TIPOS_IMAGEN_ACEPTADOS,
  esUrlMedioTwilio,
  textoResultadoFoto,
  tipoBase,
  type AdjuntoWhatsapp,
} from "./whatsapp-foto";

// Solo servidor. Twilio espera la respuesta del webhook en 15 s: descarga + detección
// deben caber en ese tiempo, con margen.
const TIEMPO_DESCARGA_MS = 5_000;
const TIEMPO_DETECCION_MS = 8_000;
// Freno a imágenes enormes (bombas de descompresión): 40 megapíxeles.
const PIXELES_MAXIMOS_ENTRADA = 40_000_000;

class ImagenNoValida extends Error {}

/**
 * Descarga el archivo desde Twilio. Twilio puede exigir autenticación básica
 * (AccountSid + Auth Token) para los archivos; el AccountSid viene en el mensaje
 * ya verificado con la firma. Tras la redirección al almacenamiento de Twilio,
 * fetch no reenvía la cabecera Authorization a otro dominio.
 */
async function descargarImagen(adjunto: AdjuntoWhatsapp, accountSid: string | undefined, authToken: string): Promise<Buffer> {
  if (!esUrlMedioTwilio(adjunto.url)) throw new ImagenNoValida("URL no permitida");
  const headers: Record<string, string> = {};
  if (accountSid && /^AC[0-9a-f]{32}$/.test(accountSid)) {
    headers.Authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }
  const res = await fetch(adjunto.url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIEMPO_DESCARGA_MS) });
  if (!res.ok) throw new Error(`Twilio respondió HTTP ${res.status} al descargar la foto`);
  if (!TIPOS_IMAGEN_ACEPTADOS.has(tipoBase(res.headers.get("content-type")))) throw new ImagenNoValida("No es imagen");
  const declarada = Number(res.headers.get("content-length"));
  if (Number.isFinite(declarada) && declarada > BYTES_MAXIMOS_IMAGEN_WHATSAPP) throw new ImagenNoValida("Demasiado grande");
  const datos = Buffer.from(await res.arrayBuffer());
  if (datos.length === 0 || datos.length > BYTES_MAXIMOS_IMAGEN_WHATSAPP) throw new ImagenNoValida("Tamaño no válido");
  return datos;
}

/**
 * Deja la foto igual que la sube el panel web: orientación aplicada, sin metadatos,
 * lado mayor ≤ 1600 px y JPEG. Así el modelo ve la misma escala en ambos casos.
 */
export async function normalizarImagenWhatsapp(entrada: Buffer): Promise<{ imagen: Buffer; ancho: number; alto: number }> {
  try {
    const { data, info } = await sharp(entrada, { failOn: "warning", limitInputPixels: PIXELES_MAXIMOS_ENTRADA })
      .rotate()
      .resize(LADO_MAXIMO, LADO_MAXIMO, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { imagen: data, ancho: info.width, alto: info.height };
  } catch {
    throw new ImagenNoValida("Imagen dañada");
  }
}

/** Foto contada: lo necesario para responder y guardarla en la bandeja del panel. */
export type FotoContadaWhatsapp = {
  total: number;
  confianzaPromedio: number | null;
  imagen: Buffer; // JPEG normalizado (sin metadatos, ≤ 1600 px)
  ancho: number;
  alto: number;
};

export type AnalisisFotoWhatsapp = { texto: string; ok: boolean; foto: FotoContadaWhatsapp | null };

/**
 * Cuenta los sacos de la foto recibida por WhatsApp. Nunca lanza: cualquier fallo se
 * convierte en un mensaje para el usuario. No usa la base de datos: el webhook decide
 * si guarda la foto (bitácora) y, en ese caso, vuelve a armar el texto con el n.º de bandeja.
 */
export async function analizarFotoWhatsapp(
  adjunto: AdjuntoWhatsapp,
  adjuntos: number,
  accountSid: string | undefined,
  authToken: string
): Promise<AnalisisFotoWhatsapp> {
  if (!conteoFotoConfigurado()) return { texto: TEXTO_FOTO_NO_CONFIGURADO, ok: false, foto: null };
  try {
    const descargada = await descargarImagen(adjunto, accountSid, authToken);
    const { imagen, ancho, alto } = await normalizarImagenWhatsapp(descargada);
    const resultado = await detectarSacos(imagen, ancho, alto, TIEMPO_DETECCION_MS);
    console.info(`[whatsapp] Foto contada: ${resultado.total} sacos (${ancho}x${alto}).`);
    return {
      texto: textoResultadoFoto(resultado, adjuntos),
      ok: true,
      foto: { total: resultado.total, confianzaPromedio: resultado.confianzaPromedio, imagen, ancho, alto },
    };
  } catch (err) {
    if (err instanceof ImagenNoValida) return { texto: TEXTO_FOTO_INVALIDA, ok: false, foto: null };
    if (err instanceof DeteccionNoDisponible) {
      console.warn(`[whatsapp] Conteo por foto no disponible: ${err.message}`);
      return { texto: TEXTO_FOTO_ERROR, ok: false, foto: null };
    }
    // Sin la URL del archivo ni datos de la cuenta en el registro.
    console.error("[whatsapp] Error al contar la foto:", err instanceof Error ? err.message.slice(0, 120) : "desconocido");
    return { texto: TEXTO_FOTO_ERROR, ok: false, foto: null };
  }
}

/** Solo el texto de respuesta (sin guardar nada). */
export async function contarFotoWhatsapp(
  adjunto: AdjuntoWhatsapp,
  adjuntos: number,
  accountSid: string | undefined,
  authToken: string
): Promise<string> {
  return (await analizarFotoWhatsapp(adjunto, adjuntos, accountSid, authToken)).texto;
}
