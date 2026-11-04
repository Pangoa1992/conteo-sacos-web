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

/** Sesión leída del JWT: el usuario y la versión de sesión con la que se emitió. */
export type SesionToken = SesionUsuario & { sv: number };

/**
 * Genera un JWT firmado con los datos básicos del usuario (válido 7 días).
 * `sesionVersion` es usuarios.sesion_version al emitirlo: si después sube (cuenta
 * desactivada, rol o contraseña cambiados), el token deja de valer en el servidor.
 */
export async function crearToken(usuario: SesionUsuario, sesionVersion: number): Promise<string> {
  const clave = obtenerClave();
  if (!clave) {
    throw new Error("JWT_SECRET no configurado o demasiado corto");
  }
  const { id, nombre, correo, rol } = usuario;
  return await new SignJWT({ id, nombre, correo, rol, sv: sesionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(clave);
}

/**
 * Verifica la FIRMA y la vigencia de un JWT y devuelve sus datos, o null.
 * No consulta la base: sirve para el middleware (Edge). Las rutas de la API deben
 * usar usuarioDeSesion (lib/sesion-servidor.ts), que además comprueba que la
 * cuenta siga activa y que la sesión no se haya revocado.
 */
export async function verificarToken(token: string): Promise<SesionToken | null> {
  const clave = obtenerClave();
  if (!clave) return null;

  try {
    const { payload } = await jwtVerify(token, clave, { algorithms: ["HS256"] });
    const { id, nombre, correo, rol, sv } = payload as Record<string, unknown>;

    if (
      typeof id !== "number" ||
      typeof nombre !== "string" ||
      typeof correo !== "string" ||
      !ROLES_VALIDOS.includes(rol as SesionUsuario["rol"])
    ) {
      return null;
    }

    // Tokens emitidos antes del módulo de usuarios no traen «sv»: equivalen a la versión 0.
    const version = typeof sv === "number" && Number.isInteger(sv) && sv >= 0 ? sv : 0;
    return { id, nombre, correo, rol: rol as SesionUsuario["rol"], sv: version };
  } catch {
    return null;
  }
}

export const NOMBRE_COOKIE_SESION = "sesion_token";

// Excepción de la DEMOSTRACIÓN LOCAL: permite la cookie sin «Secure» para entrar
// desde un celular por http://<IP-de-la-red>:puerto con next start. Solo se activa
// con este valor exacto (no "1" ni "true"), que únicamente pone el script
// iniciar_servidor_demo.sh --lan; nunca va en .env.local ni en Vercel.
const VARIABLE_DEMO_LAN = "MACROMEC_DEMO_LAN_HTTP";
const VALOR_DEMO_LAN = "solo_demo_local_conteo_sacos_demo";
const BD_DEMO = "conteo_sacos_demo";

/** Hosts de la propia máquina o de una red privada IPv4 (10/8, 172.16/12, 192.168/16). */
function esHostLocal(host: string): boolean {
  if (host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** La BD configurada es conteo_sacos_demo en este mismo equipo (nunca Neon ni la principal). */
function usaBdDemoLocal(): boolean {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/" + BD_DEMO;
  } catch {
    return false;
  }
}

/**
 * Indica si la cookie de sesión debe llevar «Secure». En producción SIEMPRE,
 * salvo que se cumplan A LA VEZ todas las condiciones de la demostración local:
 * variable con el valor exacto, fuera de Vercel, BD conteo_sacos_demo local,
 * petición por http (no https) y host local o de red privada. Si falta
 * cualquiera, se mantiene «Secure» (falla de forma segura).
 */
export function cookieSesionSegura(req: { nextUrl: URL; headers: Headers }): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env[VARIABLE_DEMO_LAN] !== VALOR_DEMO_LAN) return true;
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL) return true;
  if (!usaBdDemoLocal()) return true;
  if (req.nextUrl.protocol !== "http:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https") return true;
  // Con next start, nextUrl.hostname es la dirección donde escucha el servidor
  // (p. ej. 0.0.0.0), no la que usó el navegador: se toma la cabecera Host.
  return !esHostLocal(hostDeLaPeticion(req.headers));
}

/** Nombre de host (sin puerto) de la cabecera Host, o "" si falta o no es válida. */
function hostDeLaPeticion(headers: Headers): string {
  const host = headers.get("host");
  if (!host) return "";
  try {
    return new URL("http://" + host).hostname;
  } catch {
    return "";
  }
}

/**
 * URL absoluta de `ruta` en el origen que usó el navegador. Con next start,
 * Next 15 arma req.url con "localhost" aunque se entre por http://IP:puerto:
 * una redirección así llevaría al celular a su propio localhost. Solo se toma
 * la cabecera Host si es local o de red privada; si no (p. ej. en Vercel),
 * se usa req.url como antes.
 */
export function urlMismoOrigen(req: { url: string; headers: Headers }, ruta: string): URL {
  const base = new URL(req.url);
  const host = req.headers.get("host");
  if (host && esHostLocal(hostDeLaPeticion(req.headers))) base.host = host;
  return new URL(ruta, base);
}

/** Atributos comunes de la cookie de sesión (al crearla y al borrarla). */
export function opcionesCookieSesion(req: { nextUrl: URL; headers: Headers }) {
  return { httpOnly: true, secure: cookieSesionSegura(req), sameSite: "lax" as const, path: "/" };
}

