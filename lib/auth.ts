import { SignJWT, jwtVerify } from "jose";

export type SesionUsuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "admin_macromec" | "cliente";
};

const ROLES_VALIDOS = ["admin_macromec", "cliente"] as const;

// Longitud mínima del JWT_SECRET para considerarlo seguro (HS256).
const LONGITUD_MINIMA_SECRETO = 32;

/**
 * Devuelve la clave para firmar/verificar JWT, o null si JWT_SECRET no
 * está configurado o es demasiado corto. NO hay clave de respaldo: sin
 * JWT_SECRET no se emiten ni se aceptan sesiones (falla de forma segura).
 */
function obtenerClave(): Uint8Array | null {
  const secreto = process.env.JWT_SECRET;
  if (!secreto || secreto.length < LONGITUD_MINIMA_SECRETO) return null;
  return new TextEncoder().encode(secreto);
}

/** Indica si la autenticación está configurada (JWT_SECRET válido). */
export function autenticacionConfigurada(): boolean {
  return obtenerClave() !== null;
}

/** Genera un JWT firmado con los datos básicos del usuario (válido 7 días). */
export async function crearToken(usuario: SesionUsuario): Promise<string> {
  const clave = obtenerClave();
  if (!clave) {
    throw new Error("JWT_SECRET no configurado o demasiado corto");
  }
  return await new SignJWT({ ...usuario })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(clave);
}

/** Verifica un JWT y devuelve los datos del usuario, o null si no es válido/expiró. */
export async function verificarToken(token: string): Promise<SesionUsuario | null> {
  const clave = obtenerClave();
  if (!clave) return null;

  try {
    const { payload } = await jwtVerify(token, clave, { algorithms: ["HS256"] });
    const { id, nombre, correo, rol } = payload as Record<string, unknown>;

    if (
      typeof id !== "number" ||
      typeof nombre !== "string" ||
      typeof correo !== "string" ||
      !ROLES_VALIDOS.includes(rol as SesionUsuario["rol"])
    ) {
      return null;
    }

    return { id, nombre, correo, rol: rol as SesionUsuario["rol"] };
  } catch {
    return null;
  }
}

export const NOMBRE_COOKIE_SESION = "sesion_token";
