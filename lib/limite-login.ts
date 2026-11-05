// Límite de intentos de inicio de sesión. Reglas puras (sin base de datos), usadas por POST /api/auth/login.

/** Contraseñas incorrectas seguidas que bloquean la cuenta. */
export const MAXIMO_INTENTOS_LOGIN = 5;
/** Duración del bloqueo. */
export const BLOQUEO_LOGIN_MS = 15 * 60 * 1000;

/** Milisegundos que faltan para que termine el bloqueo (0 si la cuenta no está bloqueada). */
export function restanteBloqueo(bloqueadoHasta: Date | null | undefined, ahora = Date.now()): number {
  if (!bloqueadoHasta) return 0;
  return Math.max(0, bloqueadoHasta.getTime() - ahora);
}

/** Resultado de registrar una contraseña incorrecta: nuevos valores de la cuenta. */
export function trasFallo(intentosPrevios: number, ahora = Date.now()): { intentosFallidos: number; bloqueadoHasta: Date | null } {
  const intentos = intentosPrevios + 1;
  // Al bloquear, el contador vuelve a cero: cuando termina el bloqueo hay otros 5 intentos.
  return intentos >= MAXIMO_INTENTOS_LOGIN
    ? { intentosFallidos: 0, bloqueadoHasta: new Date(ahora + BLOQUEO_LOGIN_MS) }
    : { intentosFallidos: intentos, bloqueadoHasta: null };
}

export function mensajeBloqueo(restanteMs: number): string {
  const minutos = Math.max(1, Math.ceil(restanteMs / 60000));
  return `Demasiados intentos fallidos. Por seguridad, la cuenta queda bloqueada; intente de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"} o pida al administrador una contraseña nueva.`;
}
