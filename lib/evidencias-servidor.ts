import { createHash } from "crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { BYTES_MAXIMOS_FOTO, BYTES_MAXIMOS_MINIATURA, LADO_MAXIMO, LADO_MINIATURA } from "./evidencias";

// Solo servidor (sharp es nativo). Las fotos llegan ya reducidas por el navegador.

export type FotoProcesada = {
  imagen: Buffer;
  miniatura: Buffer;
  ancho: number;
  alto: number;
  sha256: string;
};

export class FotoInvalida extends Error {}

/**
 * Valida una foto JPEG y la vuelve a codificar sin metadatos.
 *  - Comprueba la firma, el formato y las dimensiones declaradas.
 *  - La decodifica COMPLETA con failOn "warning": un JPEG truncado, corrupto
 *    o que solo imita la cabecera se rechaza.
 *  - La recodifica aplicando la orientación EXIF y SIN copiar metadatos
 *    (EXIF, GPS, XMP, ICC, comentarios), aunque el navegador no los hubiera quitado.
 *  - Genera la miniatura y la huella SHA-256 de la imagen que se guarda.
 */
export async function procesarFoto(entrada: Buffer): Promise<FotoProcesada> {
  if (entrada.length === 0) throw new FotoInvalida("El archivo está vacío.");
  if (entrada.length > BYTES_MAXIMOS_FOTO) throw new FotoInvalida("La foto supera 1,5 MB.");
  if (entrada[0] !== 0xff || entrada[1] !== 0xd8 || entrada[2] !== 0xff) {
    throw new FotoInvalida("El archivo no es una imagen JPEG.");
  }

  // limitInputPixels frena imágenes enormes (bombas de descompresión) antes de decodificar.
  const opciones = { failOn: "warning" as const, limitInputPixels: LADO_MAXIMO * LADO_MAXIMO };
  let meta: Metadata;
  try {
    // Solo lee la cabecera (no decodifica píxeles): sin límite, para poder
    // informar las dimensiones reales si la foto es demasiado grande.
    meta = await sharp(entrada, { failOn: "warning", limitInputPixels: false }).metadata();
  } catch {
    throw new FotoInvalida("El archivo no es una imagen JPEG válida.");
  }
  if (meta.format !== "jpeg" || !meta.width || !meta.height) {
    throw new FotoInvalida("El archivo no es una imagen JPEG válida.");
  }
  if (meta.width > LADO_MAXIMO || meta.height > LADO_MAXIMO) {
    throw new FotoInvalida(`La foto supera ${LADO_MAXIMO} px; súbala desde el panel, que la reduce automáticamente.`);
  }

  let imagen: Buffer;
  let info: OutputInfo;
  try {
    ({ data: imagen, info } = await sharp(entrada, opciones)
      .rotate() // aplica la orientación EXIF; la salida no lleva metadatos
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new FotoInvalida("La imagen está dañada o incompleta.");
  }
  if (imagen.length > BYTES_MAXIMOS_FOTO) throw new FotoInvalida("La foto supera 1,5 MB tras procesarla.");

  const miniatura = await sharp(imagen)
    .resize(LADO_MINIATURA, LADO_MINIATURA, { fit: "inside" })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
  if (miniatura.length > BYTES_MAXIMOS_MINIATURA) throw new FotoInvalida("No se pudo generar la miniatura.");

  return {
    imagen,
    miniatura,
    ancho: info.width,
    alto: info.height,
    sha256: createHash("sha256").update(imagen).digest("hex"),
  };
}
