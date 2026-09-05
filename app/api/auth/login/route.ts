import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { crearToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";
import { compararPassword } from "@/lib/password";

const loginSchema = z.object({
  correo: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Valida correo + contraseña contra la base de datos y, si son correctos,
 * deja una cookie httpOnly con un JWT que identifica al usuario y su rol.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Correo o contraseña inválidos" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Base de datos no configurada. No se puede iniciar sesión en modo simulado." },
      { status: 503 }
    );
  }

  const { correo, password } = parsed.data;

  const [usuario] = await db.select().from(usuarios).where(eq(usuarios.correo, correo)).limit(1);

  if (!usuario) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  const passwordValida = await compararPassword(password, usuario.passwordHash);
  if (!passwordValida) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  const token = await crearToken({
    id: usuario.id,
    nombre: usuario.nombre,
    correo: usuario.correo,
    rol: usuario.rol as "admin_macromec" | "cliente",
  });

  const respuesta = NextResponse.json({
    nombre: usuario.nombre,
    correo: usuario.correo,
    rol: usuario.rol,
  });

  respuesta.cookies.set(NOMBRE_COOKIE_SESION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 días
    path: "/",
  });

  return respuesta;
}
