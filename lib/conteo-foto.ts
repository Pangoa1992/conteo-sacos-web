// Contar sacos en una fotografía. Tipos compartidos por el panel y la API.
// Fase 1: contar y mostrar (sin base de datos). Fase 2: el personal puede registrar
// el resultado como un lote pendiente de validación, con la foto como evidencia.

/** Origen de los lotes registrados desde una foto: real o de prueba (empieza por «prueba»). */
export const ORIGEN_FOTO = "foto";
export const ORIGEN_FOTO_PRUEBA = "prueba_foto";
/** Fuente que se muestra en Cámaras e Historial para estos lotes. */
export const FUENTE_FOTO = "foto_celular";

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

/**
 * Respuesta de POST /api/contar-foto: el resultado y el comprobante firmado para
 * registrarlo como lote (null si no hay sacos o el servidor no puede firmarlo).
 */
export type RespuestaConteoFoto = ResultadoConteoFoto & { registro: string | null };

/** Respuesta de POST /api/contar-foto/registrar. */
export type LoteRegistradoFoto = {
  lote: { id: number; cantidadSacos: number; origen: string; estadoValidacion: string };
  evidenciaId: number | null;
  yaRegistrado: boolean; // la misma foto ya había creado este lote: no se duplicó
};

export type EstadoConteoFoto = {
  disponible: boolean;
  modelo: string;
  umbralConfianza: number;
};
