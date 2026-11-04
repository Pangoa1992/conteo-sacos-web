import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { NOMBRE_COOKIE_SESION, verificarToken, type SesionUsuario } from "./auth";
import { mensajeErrorBD } from "./errores-bd";
import { sesionSigueVigente } from "./usuarios";

type PeticionConCookies = { cookies: { get(nombre: string): { value: string } | undefined } };

/**
 * Usuario de la cookie de sesión, o null si no hay sesión válida.
 *
 * Además de la firma del JWT (lo único que ve el middleware), comprueba en la base
 * que la cuenta exista, siga activa y que su sesion_version sea la del token: así,
 * desactivar una cuenta o cambiarle el rol o la contraseña corta sus sesiones
 * abiertas en la siguiente petición. Devuelve el nombre y el rol ACTUALES de la base.
 *
 * Solo para el servidor (usa la base de datos): el middleware usa verificarToken.
 */
export async function usuarioDeSesion(req: PeticionConCookies): Promise<SesionUsuario | null> {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const sesion = token ? await verificarToken(token) : null;
  if (!sesion) return null;

  // Sin base de datos (modo simulado de desarrollo) no hay cuentas que comprobar.
  if (!process.env.DATABASE_URL) {
    const { id, nombre, correo, rol } = sesion;
    return { id, nombre, correo, rol };
  }

  try {
    const [cuenta] = await db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        correo: usuarios.correo,
        rol: usuarios.rol,
        activo: usuarios.activo,
        sesionVersion: usuarios.sesionVersion,
      })
      .from(usuarios)
      .where(eq(usuarios.id, sesion.id))
      .limit(1);

    if (!cuenta || !sesionSigueVigente(cuenta, sesion.sv)) return null;
    return { id: cuenta.id, nombre: cuenta.nombre, correo: cuenta.correo, rol: cuenta.rol as SesionUsuario["rol"] };
  } catch (err) {
    // Falla de forma segura: sin poder comprobar la cuenta, no hay sesión.
    console.error("[auth] No se pudo comprobar la sesión en la base:", mensajeErrorBD(err));
    return null;
  }
}
