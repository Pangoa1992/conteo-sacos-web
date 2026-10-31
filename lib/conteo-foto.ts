// Contar sacos en una fotografía (fase 1). Tipos compartidos por el panel y la API.
// El resultado solo se muestra: no se guarda, no crea lotes ni toca la base de datos.

/** Caja de un saco detectado, en píxeles de la imagen analizada (esquinas). */
export type DeteccionFoto = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confianza: number; // 0–1, la que devuelve RF-DETR
};

export type ResultadoConteoFoto = {
  total: number;
  // Promedio en % (0–100, 2 decimales) como en el detector; null si no hay sacos.
  confianzaPromedio: number | null;
  confianzaMinima: number | null; // 0–1
  confianzaMaxima: number | null; // 0–1
  detecciones: DeteccionFoto[];
  // Tamaño de la imagen analizada: las cajas están en esta escala.
  ancho: number;
  alto: number;
  modelo: string;
  umbralConfianza: number;
};

export type EstadoConteoFoto = {
  disponible: boolean;
  modelo: string;
  umbralConfianza: number;
};
