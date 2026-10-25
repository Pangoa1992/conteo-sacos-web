/**
 * Reglas compartidas sobre los conteos (servidor y cliente).
 *
 * Un conteo es "de prueba" cuando su origen empieza por "prueba"
 * (p. ej. "prueba_dev"). Todo lo demás (vision_ip, manual) se trata como
 * dato real. Los datos de prueba NUNCA se suman a los indicadores reales.
 */
export function esOrigenPrueba(origen: string | null | undefined): boolean {
  return (origen ?? "").toLowerCase().startsWith("prueba");
}

/** Zona horaria de la planta: define qué es "hoy" para la producción diaria. */
export const ZONA_HORARIA_PLANTA = "America/Lima";
