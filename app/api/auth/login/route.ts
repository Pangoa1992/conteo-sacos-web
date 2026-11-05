import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { autenticacionConfigurada, crearToken, NOMBRE_COOKIE_SESION, opcionesCookieSesion } from "@/lib/auth";
import { compararPassword, hashearPassword } from "@/lib/password";
import { normalizarCorreo } from "@/lib/usuarios";
import { mensajeBloqueo, restanteBloqueo, trasFallo } from "@/lib/limite-login";

const loginSchema = z.object({
  correo: z.string().email(),
  password: z.string().min(1).max(200),
});

// Hash ficticio para comparar cuando el correo no existe: así la respuesta
// tarda lo mismo y no revela qué correos están registrados.
let hashFicticio: Promise<string> | null = null;

/**
 * POST /api/auth/login
 * Valida correo + contraseña contra la base de datos y, si son correctos,
 * deja una cookie httpOnly con un JWT que identifica al usuario y su rol.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Correo o contraseña inválidos" }, { status: 400 });
  }

  if (!autenticacionConfigurada()) {
    console.error("[auth] JWT_SECRET no configurado o demasiado corto: login deshabilitado.");
    return NextResponse.json(
      { error: "Autenticación no disponible. Contacte al administrador." },
      { status: 503 }
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Base de datos no configurada. No se puede iniciar sesión en modo simulado." },
      { status: 503 }
    );
  }

  const { password } = parsed.data;
  const correo = normalizarCorreo(parsed.data.correo);

  // Sin distinguir mayúsculas: las cuentas nuevas se guardan en minúsculas, las antiguas pueden no estarlo.
  const [usuario] = await db.select().from(usuarios).where(sql`lower(${usuarios.correo}) = ${correo}`).limit(1);

  if (!usuario) {
    hashFicticio ??= hashearPassword("usuario-inexistente");
    await compararPassword(password, await hashFicticio);
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  // Cuenta bloqueada por intentos fallidos: no se compara la contraseña (ni siquiera la correcta).
  const restante = restanteBloqueo(usuario.bloqueadoHasta);
  if (restante > 0) {
    return NextResponse.json({ error: mensajeBloqueo(restante) }, { status: 429, headers: { "Retry-After": String(Math.ceil(restante / 1000)) } });
  }

  const passwordValida = await compararPassword(password, usuario.passwordHash);
  if (!passwordValida) {
    // Incremento atómico en la base: dos intentos simultáneos no se pierden.
    const [fila] = await db.update(usuarios).set({ intentosFallidos: sql`${usuarios.intentosFallidos} + 1` })
      .where(eq(usuarios.id, usuario.id)).returning({ intentos: usuarios.intentosFallidos });
    const siguiente = trasFallo((fila?.intentos ?? 1) - 1);
    if (siguiente.bloqueadoHasta) {
      await db.update(usuarios).set(siguiente).where(eq(usuarios.id, usuario.id));
      console.warn(`[auth] Cuenta ${usuario.id} bloqueada 15 minutos por intentos fallidos.`);
      return NextResponse.json({ error: mensajeBloqueo(restanteBloqueo(siguiente.bloqueadoHasta)) }, { status: 429 });
    }
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  if (usuario.intentosFallidos > 0 || usuario.bloqueadoHasta) {
    await db.update(usuarios).set({ intentosFallidos: 0, bloqueadoHasta: null }).where(eq(usuarios.id, usuario.id));
  }

  // Solo después de una contraseña correcta: así no se revela qué cuentas existen.
  if (!usuario.activo) {
    return NextResponse.json({ error: "Esta cuenta está desactivada. Consulte al administrador de MACROMEC." }, { status: 403 });
  }

  const token = await crearToken(
    {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol as "admin_macromec" | "cliente",
    },
    usuario.sesionVersion
  );

  const respuesta = NextResponse.json({
    nombre: usuario.nombre,
    correo: usuario.correo,
    rol: usuario.rol,
  });

  respuesta.cookies.set(NOMBRE_COOKIE_SESION, token, {
    ...opcionesCookieSesion(req),
    maxAge: 60 * 60 * 24 * 7, // 7 días
  });

  return respuesta;
}
