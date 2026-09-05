import { NextResponse } from "next/server";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashearPassword } from "@/lib/password";

/**
 * GET /api/dev/seed-usuarios
 *
 * Crea (si no existen) los 2 usuarios de prueba del sistema:
 *   - admin@macromec.com / macromec2026   (rol: admin_macromec)
 *   - dueno@fabrica.com  / fabrica2026    (rol: cliente)
 *
 * Es un endpoint temporal para no tener que armar una pantalla de
 * registro todavía. Se puede borrar cuando exista un panel real de
 * gestión de usuarios.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Base de datos no configurada." },
      { status: 503 }
    );
  }

  const usuariosDemo = [
    { nombre: "Personal MACROMEC", correo: "admin@macromec.com", password: "macromec2026", rol: "admin_macromec" },
    { nombre: "Dueño de la fábrica", correo: "dueno@fabrica.com", password: "fabrica2026", rol: "cliente" },
  ];

  const resultados = [];

  for (const u of usuariosDemo) {
    const [existente] = await db.select().from(usuarios).where(eq(usuarios.correo, u.correo)).limit(1);
    if (existente) {
      resultados.push({ correo: u.correo, estado: "ya existía" });
      continue;
    }

    const passwordHash = await hashearPassword(u.password);
    await db.insert(usuarios).values({
      nombre: u.nombre,
      correo: u.correo,
      passwordHash,
      rol: u.rol,
    });
    resultados.push({ correo: u.correo, estado: "creado" });
  }

  return NextResponse.json({ resultados, credenciales: usuariosDemo.map(({ correo, password, rol }) => ({ correo, password, rol })) });
}
