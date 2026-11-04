import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { hashearPassword } from "@/lib/password";
import { primerError, problemaPassword, restablecerPasswordSchema } from "@/lib/usuarios";
import { administradorDeSesion, idDeRuta } from "@/lib/usuarios-servidor";

/**
 * POST /api/usuarios/[id]/password — el administrador asigna una contraseña nueva a OTRA cuenta
 * (p. ej. si la olvidó) y cierra sus sesiones abiertas. Para la propia: /api/auth/cambiar-password,
 * que exige la contraseña actual.
 *   200 cambiada · 400 contraseña débil · 404 no existe · 409 es la propia cuenta
 */
export async function POST(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const { usuario, respuesta } = await administradorDeSesion(req);
  if (!usuario) return respuesta;

  const id = idDeRuta((await contexto.params).id);
  if (id === null) return NextResponse.json({ error: "Usuario no válido." }, { status: 400 });
  if (id === usuario.id) {
    return NextResponse.json({ error: "Para su propia cuenta use «Mi cuenta», que pide la contraseña actual." }, { status: 409 });
  }

  const parsed = restablecerPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: primerError(parsed.error) }, { status: 400 });

  try {
    const [cuenta] = await db.select({ correo: usuarios.correo }).from(usuarios).where(eq(usuarios.id, id)).limit(1);
    if (!cuenta) return NextResponse.json({ error: "La cuenta no existe." }, { status: 404 });

    const problema = problemaPassword(parsed.data.password, cuenta.correo);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });

    await db
      .update(usuarios)
      .set({ passwordHash: await hashearPassword(parsed.data.password), sesionVersion: sql`${usuarios.sesionVersion} + 1` })
      .where(eq(usuarios.id, id));
    console.info(`[usuarios] Contraseña de la cuenta ${id} restablecida por el usuario ${usuario.id}.`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[usuarios] Error al restablecer la contraseña:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 500 });
  }
}
