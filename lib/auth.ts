import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "clave-de-desarrollo-no-usar-en-produccion"
);

export type SesionUsuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "admin_macromec" | "cliente";
};

/** Genera un JWT firmado con los datos básicos del usuario (válido 7 días). */
export async function crearToken(usuario: SesionUsuario): Promise<string> {
  return await new SignJWT({ ...usuario })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);
}

/** Verifica un JWT y devuelve los datos del usuario, o null si no es válido/expiró. */
export async function verificarToken(token: string): Promise<SesionUsuario | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SesionUsuario;
  } catch {
    return null;
  }
}

export const NOMBRE_COOKIE_SESION = "sesion_token";
