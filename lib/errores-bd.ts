/**
 * Errores de la base de datos.
 *
 * Desde drizzle-orm 0.44 cada error de una consulta llega envuelto en un
 * DrizzleQueryError cuyo mensaje incluye la consulta SQL y TODOS sus parámetros
 * (correos, importes, incluso los bytes de una foto). El error original de
 * PostgreSQL (mensaje de un trigger o restricción) queda en `cause`.
 */

/** Error original del driver de PostgreSQL (o el mismo error si no viene envuelto). */
export function errorOriginalBD(err: unknown): unknown {
  let actual = err;
  // Se recorre la cadena de causas con un límite, por si hubiera un ciclo.
  for (let i = 0; i < 5 && actual instanceof Error && actual.cause !== undefined; i++) actual = actual.cause;
  return actual;
}

/** Mensaje seguro para los registros: el del error original, nunca la consulta ni sus parámetros. */
export function mensajeErrorBD(err: unknown): string {
  const original = errorOriginalBD(err);
  if (original instanceof Error) return original.message;
  return typeof original === "string" ? original : "error desconocido";
}
