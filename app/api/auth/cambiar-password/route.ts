import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { crearToken, NOMBRE_COOKIE_SESION, opcionesCookieSesion } from "@/lib/auth";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { compararPassword, hashearPassword } from "@/lib/password";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { cambiarPasswordSchema, primerError, problemaPassword } from "@/lib/usuarios";

/**
 * POST /api/auth/cambiar-password — cualquier usuario cambia SU contraseña.
 * Exige la contraseña actual. Cierra las demás sesiones abiertas de la cuenta (otro
 * navegador, el celular) y renueva la cookie de esta para que siga dentro.
 *   200 cambiada · 400 contraseña nueva débil o igual a la actual · 401 sin sesión · 403 actual incorrecta
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Base de datos no configurada." }, { status: 503 });

  const parsed = cambiarPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: primerError(parsed.error) }, { status: 400 });
  const { actual, nueva } = parsed.data;

  try {
    const [cuenta] = await db
      .select({ passwordHash: usuarios.passwordHash, correo: usuarios.correo })
      .from(usuarios)
      .where(eq(usuarios.id, usuario.id))
      .limit(1);
    if (!cuenta) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    if (!(await compararPassword(actual, cuenta.passwordHash))) {
      return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 403 });
    }
    if (actual === nueva) {
      return NextResponse.json({ error: "La contraseña nueva debe ser distinta de la actual." }, { status: 400 });
    }
    const problema = problemaPassword(nueva, cuenta.correo);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });

    const [fila] = await db
      .update(usuarios)
      .set({ passwordHash: await hashearPassword(nueva), sesionVersion: sql`${usuarios.sesionVersion} + 1` })
      .where(eq(usuarios.id, usuario.id))
      .returning({ sesionVersion: usuarios.sesionVersion });

    const respuesta = NextResponse.json({ ok: true });
    respuesta.cookies.set(NOMBRE_COOKIE_SESION, await crearToken(usuario, fila.sesionVersion), {
      ...opcionesCookieSesion(req),
      maxAge: 60 * 60 * 24 * 7, // 7 días, como al iniciar sesión
    });
    console.info(`[usuarios] El usuario ${usuario.id} cambió su contraseña.`);
    return respuesta;
  } catch (err) {
    console.error("[usuarios] Error al cambiar la contraseña:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 500 });
  }
}
