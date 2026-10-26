/**
 * Evidencias fotográficas (etapa 2, ampliación del prototipo): límites
 * compartidos por el navegador, el servidor y la migración 0004 (CHECK).
 * Una foto es solo evidencia del lote: nunca cambia la cantidad contada por la IA.
 */
export const MAXIMO_EVIDENCIAS_ACTIVAS = 10;
export const LADO_MAXIMO = 1600; // px, lado mayor de la foto guardada
export const LADO_MINIATURA = 320; // px
export const BYTES_MAXIMOS_FOTO = 1_572_864; // 1,5 MB
export const BYTES_MAXIMOS_MINIATURA = 65_536; // 64 KB
export const LONGITUD_MAXIMA_DESCRIPCION = 200;
export const LONGITUD_MAXIMA_MOTIVO = 300;

export type Evidencia = {
  id: number;
  conteoId: number;
  descripcion: string | null;
  sha256: string;
  bytes: number;
  ancho: number;
  alto: number;
  tomadaEn: string | null;
  subidoPorNombre: string | null;
  subidoEn: string;
  // Solo para el personal de MACROMEC: el cliente nunca recibe evidencias anuladas.
  anuladaEn?: string | null;
  anuladaPorNombre?: string | null;
  motivoAnulacion?: string | null;
};

/** URL protegida de la imagen. Sin extensión: el middleware ignora las rutas que acaban en .jpg. */
export function urlImagenEvidencia(id: number, tam: "miniatura" | "completa"): string {
  return `/api/evidencias/${id}/imagen?tam=${tam}`;
}
