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

// A partir de esta diferencia entre el conteo automático y el reporte
// del contratista, se marca como discrepancia (alerta).
export const UMBRAL_DISCREPANCIA = 1;

export function hayDiscrepancia(cantidadReportada: number, cantidadAutomatica: number): boolean {
  return Math.abs(cantidadReportada - cantidadAutomatica) > UMBRAL_DISCREPANCIA;
}

/**
 * Validación de conteos (ampliación del prototipo, etapa 1).
 * Todo conteo nace "pendiente"; solo el personal de MACROMEC lo pasa a
 * aprobado, observado o rechazado. La clasificación por estado físico
 * (conforme / observado / defectuoso) la registra una persona al revisar
 * el lote: el modelo de visión solo cuenta sacos, no evalúa su calidad.
 */
export const ESTADOS_VALIDACION = ["pendiente", "aprobado", "observado", "rechazado"] as const;
export type EstadoValidacion = (typeof ESTADOS_VALIDACION)[number];

export const ETIQUETA_ESTADO_VALIDACION: Record<EstadoValidacion, string> = {
  pendiente: "Pendiente",
  aprobado: "Aprobado",
  observado: "Observado",
  rechazado: "Rechazado",
};

export const LONGITUD_MAXIMA_OBSERVACION = 500;

export type ClasificacionManual = { conformes: number; observados: number; defectuosos: number };

/**
 * Reglas de una validación, iguales a las restricciones CHECK de la tabla
 * conteos (migración 0003). La suma de la clasificación debe ser igual al
 * total del conteo: un lote cuyo total real difiere del detectado no se
 * aprueba, se marca observado o rechazado explicando la diferencia.
 * Devuelve la lista de errores (vacía si la validación es coherente).
 */
export function erroresValidacion(datos: {
  estado: Exclude<EstadoValidacion, "pendiente">;
  clasificacion: ClasificacionManual | null;
  observacion: string;
  cantidadSacos: number;
  conDiscrepancia: boolean;
}): string[] {
  const errores: string[] = [];
  const { estado, clasificacion, observacion, cantidadSacos, conDiscrepancia } = datos;

  if (clasificacion) {
    const suma = clasificacion.conformes + clasificacion.observados + clasificacion.defectuosos;
    if (suma !== cantidadSacos) {
      errores.push(`La clasificación suma ${suma} sacos y el conteo tiene ${cantidadSacos}: deben coincidir.`);
    }
  }
  if (estado === "aprobado" && !clasificacion) {
    errores.push("Para aprobar hay que clasificar los sacos (conformes, observados y defectuosos).");
  }
  if (estado === "rechazado" && clasificacion) {
    errores.push("Un conteo rechazado no lleva clasificación.");
  }
  if ((estado === "observado" || estado === "rechazado") && !observacion) {
    errores.push("Indique el motivo en la observación.");
  }
  if (estado === "aprobado" && conDiscrepancia && !observacion) {
    errores.push("El conteo tiene discrepancia con el reporte del contratista: explique en la observación por qué se aprueba.");
  }
  return errores;
}
