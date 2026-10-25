import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashearPassword } from "@/lib/password";
import { compararSecreto } from "@/lib/seguridad";

// Longitud mínima de las contraseñas de desarrollo y del secreto de seed.
const LONGITUD_MINIMA_PASSWORD = 16;
const LONGITUD_MINIMA_SECRETO = 32;

/**
 * POST /api/dev/seed-usuarios
 * Header requerido: X-Dev-Seed-Secret: <DEV_SEED_SECRET>
 *
 * Crea (si no existen) los usuarios de DESARROLLO definidos en variables
 * de entorno, para no tener que armar una pantalla de registro todavía:
 *   - DEV_ADMIN_CORREO   / DEV_ADMIN_PASSWORD    (rol: admin_macromec)
 *   - DEV_CLIENTE_CORREO / DEV_CLIENTE_PASSWORD  (rol: cliente)
 *
 * Seguridad:
 *   - Deshabilitado (404) en producción y cuando falta DEV_SEED_SECRET.
 *   - El secreto viaja en un header (no en la URL, que queda en logs).
 *   - No hay contraseñas fijas en el código y NUNCA se devuelven en la
 *     respuesta (solo correo, rol y si se creó o ya existía).
 *
 * Se puede borrar cuando exista un panel real de gestión de usuarios.
 */
export async function POST(req: NextRequest) {
  const secretoEsperado = process.env.DEV_SEED_SECRET;

  if (
    process.env.NODE_ENV === "production" ||
    !secretoEsperado ||
    secretoEsperado.length < LONGITUD_MINIMA_SECRETO
  ) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const secretoRecibido = req.headers.get("x-dev-seed-secret") || "";
  if (!secretoRecibido || !compararSecreto(secretoRecibido, secretoEsperado)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Base de datos no configurada." }, { status: 503 });
  }

  const usuariosDev = [
    { nombre: "Admin MACROMEC (dev)", correo: process.env.DEV_ADMIN_CORREO, password: process.env.DEV_ADMIN_PASSWORD, rol: "admin_macromec" },
    { nombre: "Cliente fábrica (dev)", correo: process.env.DEV_CLIENTE_CORREO, password: process.env.DEV_CLIENTE_PASSWORD, rol: "cliente" },
  ];

  const incompletos = usuariosDev.filter(
    (u) => !u.correo || !u.password || u.password.length < LONGITUD_MINIMA_PASSWORD
  );
  if (incompletos.length > 0) {
    return NextResponse.json(
      { error: `Faltan DEV_*_CORREO / DEV_*_PASSWORD (mínimo ${LONGITUD_MINIMA_PASSWORD} caracteres) en el entorno.` },
      { status: 500 }
    );
  }

  const resultados = [];

  for (const u of usuariosDev) {
    const correo = u.correo!;
    const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.correo, correo)).limit(1);
    if (existente) {
      resultados.push({ correo, rol: u.rol, estado: "ya existía" });
      continue;
    }

    const passwordHash = await hashearPassword(u.password!);
    await db.insert(usuarios).values({ nombre: u.nombre, correo, passwordHash, rol: u.rol });
    resultados.push({ correo, rol: u.rol, estado: "creado" });
  }

  return NextResponse.json({ resultados });
}
