import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { BYTES_MAXIMOS_FOTO, LADO_MAXIMO } from "@/lib/evidencias";
import { DeteccionNoDisponible, conteoFotoConfigurado, detectarSacos } from "@/lib/conteo-foto-servidor";
import { VIDEO_FOTOGRAMAS_MAXIMOS, VIDEO_SEGUNDOS_MAXIMOS, type RespuestaFotogramaVideo } from "@/lib/conteo-video";
import { esSesionVideo, firmarFotograma, huellaFotograma } from "@/lib/registro-video";

export const dynamic = "force-dynamic";

const BYTES_MAXIMOS_PETICION = BYTES_MAXIMOS_FOTO + 16 * 1024;
const SIN_CACHE = { "Cache-Control": "no-store" };

const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE });

/**
 * POST /api/contar-video/fotograma  (multipart/form-data)
 *   foto    fotograma del video en JPEG (≤ 1,5 MB y ≤ 1600 px), extraído en el navegador
 *   sesion  UUID de la sesión de análisis (el mismo para todos los fotogramas del video)
 *   indice  0, 1, 2… en orden
 *   tiempo  segundo del video al que corresponde el fotograma
 *
 * Detecta los sacos del fotograma con RF-DETR (mismo modelo y umbral que «Contar por
 * foto») y devuelve las cajas con una firma que permite registrar el lote después.
 * No guarda nada ni usa la base de datos. Solo personal de MACROMEC.
 *
 *   200 resultado · 400 datos o imagen inválidos · 401/403 sesión o rol · 413 demasiado grande
 *   502 el servicio de detección falló · 503 sin configurar o sin conexión
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return error("No autenticado", 401);
  if (usuario.rol !== "admin_macromec") return error("No autorizado", 403);
  if (!conteoFotoConfigurado()) {
    return error("El conteo por video no está configurado en el servidor (falta la clave del servicio de detección).", 503);
  }

  const longitud = Number(req.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > BYTES_MAXIMOS_PETICION) return error("El fotograma supera 1,5 MB", 413);
  const formulario = await req.formData().catch(() => null);
  const foto = formulario?.get("foto");
  const sesion = formulario?.get("sesion");
  const indice = Number(formulario?.get("indice"));
  const tiempo = Number(formulario?.get("tiempo"));
  if (!formulario || !(foto instanceof File)) return error("Falta el fotograma (campo «foto»)", 400);
  if (foto.size > BYTES_MAXIMOS_FOTO) return error("El fotograma supera 1,5 MB", 413);
  if (!esSesionVideo(sesion)) return error("Sesión de análisis inválida", 400);
  if (!Number.isSafeInteger(indice) || indice < 0 || indice >= VIDEO_FOTOGRAMAS_MAXIMOS) {
    return error(`Se analizan como máximo ${VIDEO_SEGUNDOS_MAXIMOS} segundos de video`, 400);
  }
  if (!Number.isFinite(tiempo) || tiempo < 0 || tiempo > VIDEO_SEGUNDOS_MAXIMOS + 1) return error("Tiempo del fotograma inválido", 400);

  // Validación ligera: el navegador ya lo dibujó en un lienzo (sin metadatos). Solo se lee
  // la cabecera para conocer el tamaño; la imagen se envía al modelo tal como llegó.
  const imagen = Buffer.from(await foto.arrayBuffer());
  if (imagen.length < 3 || imagen[0] !== 0xff || imagen[1] !== 0xd8 || imagen[2] !== 0xff) {
    return error("El fotograma no es una imagen JPEG", 400);
  }
  let ancho: number, alto: number;
  try {
    const meta = await sharp(imagen, { failOn: "warning", limitInputPixels: false }).metadata();
    if (meta.format !== "jpeg" || !meta.width || !meta.height) throw new Error();
    ancho = meta.width;
    alto = meta.height;
  } catch {
    return error("El fotograma no es una imagen JPEG válida", 400);
  }
  if (ancho > LADO_MAXIMO || alto > LADO_MAXIMO) return error(`El fotograma supera ${LADO_MAXIMO} px`, 400);

  try {
    const r = await detectarSacos(imagen, ancho, alto);
    const t = Number(tiempo.toFixed(3));
    const firma = firmarFotograma({
      s: sesion, i: indice, t, w: ancho, h: alto,
      d: r.detecciones.map((d) => [d.x1, d.y1, d.x2, d.y2, d.confianza]),
      u: usuario.id, e: Date.now(), f: huellaFotograma(imagen),
    });
    if (!firma) return error("El servidor no puede firmar el resultado (autenticación sin configurar).", 503);
    const respuesta: RespuestaFotogramaVideo = { indice, tiempo: t, ancho, alto, detecciones: r.detecciones, firma };
    return NextResponse.json(respuesta, { headers: SIN_CACHE });
  } catch (err) {
    if (err instanceof DeteccionNoDisponible) return error(err.message, err.status);
    console.error("[contar-video] Error inesperado al analizar un fotograma:", err instanceof Error ? err.name : "desconocido");
    return error("No se pudo analizar el fotograma. Intente nuevamente.", 502);
  }
}
