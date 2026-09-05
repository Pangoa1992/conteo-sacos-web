import bcrypt from "bcryptjs";

/**
 * Estas funciones usan APIs de Node.js (a través de bcryptjs) que NO son
 * compatibles con el Edge Runtime. Por eso viven en un archivo separado
 * de lib/auth.ts: así el middleware.ts (que sí corre en Edge Runtime)
 * nunca las importa ni arrastra bcryptjs a su bundle.
 */

/** Hashea una contraseña en texto plano para guardarla en la base de datos. */
export async function hashearPassword(passwordPlano: string): Promise<string> {
  return await bcrypt.hash(passwordPlano, 10);
}

/** Compara una contraseña en texto plano contra el hash guardado. */
export async function compararPassword(passwordPlano: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(passwordPlano, hash);
}
