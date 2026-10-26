import { BYTES_MAXIMOS_FOTO, LADO_MAXIMO } from "./evidencias";

// Solo navegador. Reducir la foto antes de subirla ahorra datos móviles y
// cumple el límite de 1,5 MB; al dibujarla en un canvas y volver a codificarla
// se pierden todos los metadatos (EXIF, GPS). El servidor lo vuelve a garantizar.

export type FotoComprimida = {
  blob: Blob;
  ancho: number;
  alto: number;
  anchoOriginal: number;
  altoOriginal: number;
};

const CALIDADES = [0.82, 0.72, 0.6];

/** Decodifica respetando la orientación de la cámara (EXIF). */
async function decodificar(archivo: File): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" });
      return { fuente: bmp, ancho: bmp.width, alto: bmp.height };
    } catch {
      // Algunos navegadores no aceptan la opción: se intenta con <img>.
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function comprimirFoto(archivo: File): Promise<FotoComprimida> {
  let decodificada;
  try {
    decodificada = await decodificar(archivo);
  } catch {
    throw new Error("No se pudo leer la imagen. Use una foto JPEG o PNG (en iPhone: Ajustes › Cámara › Formatos › Más compatible).");
  }
  const { fuente, ancho: anchoOriginal, alto: altoOriginal } = decodificada;
  const escala = Math.min(1, LADO_MAXIMO / Math.max(anchoOriginal, altoOriginal));
  const ancho = Math.max(1, Math.round(anchoOriginal * escala));
  const alto = Math.max(1, Math.round(altoOriginal * escala));

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("El navegador no permite procesar la imagen.");
  ctx.fillStyle = "#fff"; // fondo blanco para imágenes con transparencia (PNG)
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  if ("close" in fuente && typeof fuente.close === "function") fuente.close();

  for (const calidad of CALIDADES) {
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", calidad));
    if (!blob) break;
    if (blob.size <= BYTES_MAXIMOS_FOTO) return { blob, ancho, alto, anchoOriginal, altoOriginal };
  }
  throw new Error("No se pudo comprimir la foto por debajo de 1,5 MB.");
}
