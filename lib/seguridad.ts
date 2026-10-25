import { createHash, timingSafeEqual } from "crypto";

/**
 * Utilidades de seguridad que usan APIs de Node.js (crypto). Igual que
 * lib/password.ts, NO deben importarse desde middleware.ts (Edge Runtime).
 */

/**
 * Compara un secreto recibido contra el esperado en tiempo constante,
 * para no filtrar información por diferencias de tiempo de respuesta.
 * Se comparan los hashes SHA-256 para que ambos lados midan lo mismo
 * aunque las longitudes sean distintas.
 */
export function compararSecreto(recibido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** Extrae el token de un header "Authorization: Bearer <token>". */
export function extraerBearer(authHeader: string | null): string {
  return (authHeader || "").replace(/^Bearer\s+/i, "").trim();
}
