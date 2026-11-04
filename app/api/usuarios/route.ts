import { NextRequest, NextResponse } from "next/server";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { hashearPassword } from "@/lib/password";
import { crearUsuarioSchema, primerError, problemaPassword } from "@/lib/usuarios";
import { administradorDeSesion, COLUMNAS_PUBLICAS_USUARIO, esCorreoDuplicado } from "@/lib/usuarios-servidor";

/** GET /api/usuarios — lista de cuentas (solo administrador). */
export async function GET(req: NextRequest) {
  const { usuario, respuesta } = await administradorDeSesion(req);
  if (!usuario) return respuesta;

  try {
    const lista = await db.select(COLUMNAS_PUBLICAS_USUARIO).from(usuarios).orderBy(asc(usuarios.id));
    return NextResponse.json({ usuarios: lista, yo: usuario.id });
  } catch (err) {
    console.error("[usuarios] Error al listar:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo consultar la lista de usuarios." }, { status: 500 });
  }
}

/**
 * POST /api/usuarios — crea una cuenta (solo administrador).
 *   201 creada · 400 datos inválidos o contraseña débil · 409 correo ya registrado
 */
export async function POST(req: NextRequest) {
  const { usuario, respuesta } = await administradorDeSesion(req);
  if (!usuario) return respuesta;

  const parsed = crearUsuarioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: primerError(parsed.error) }, { status: 400 });
  const { nombre, correo, rol, password } = parsed.data;

  const problema = problemaPassword(password, correo);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  try {
    const [existente] = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(sql`lower(${usuarios.correo}) = ${correo}`)
      .limit(1);
    if (existente) return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });

    const [creado] = await db
      .insert(usuarios)
      .values({ nombre, correo, rol, passwordHash: await hashearPassword(password) })
      .returning(COLUMNAS_PUBLICAS_USUARIO);
    console.info(`[usuarios] Cuenta ${creado.id} (${rol}) creada por el usuario ${usuario.id}.`);
    return NextResponse.json({ usuario: creado }, { status: 201 });
  } catch (err) {
    // Dos altas simultáneas del mismo correo: decide la restricción UNIQUE de la base.
    if (esCorreoDuplicado(err)) return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
    console.error("[usuarios] Error al crear:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo crear la cuenta." }, { status: 500 });
  }
}
