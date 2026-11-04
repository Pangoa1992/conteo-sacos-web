import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { usuarios } from "@/db/schema";
import { errorOriginalBD } from "./errores-bd";
import { usuarioDeSesion } from "./sesion-servidor";

/** Solo el personal de MACROMEC (admin_macromec, cuenta activa) administra cuentas. */
export async function administradorDeSesion(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return { respuesta: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (usuario.rol !== "admin_macromec") return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  if (!process.env.DATABASE_URL) {
    return { respuesta: NextResponse.json({ error: "Base de datos no configurada." }, { status: 503 }) };
  }
  return { usuario };
}

/** Columnas que se pueden devolver al navegador: nunca password_hash ni sesion_version. */
export const COLUMNAS_PUBLICAS_USUARIO = {
  id: usuarios.id,
  nombre: usuarios.nombre,
  correo: usuarios.correo,
  rol: usuarios.rol,
  activo: usuarios.activo,
  creadoEn: sql<string>`to_char(${usuarios.creadoEn}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

/** La base rechazó la operación por un valor duplicado (restricción UNIQUE, código 23505). */
export function esCorreoDuplicado(err: unknown): boolean {
  return (errorOriginalBD(err) as { code?: string } | null)?.code === "23505";
}

/** Identificador de cuenta de la URL (/api/usuarios/[id]), o null si no es válido. */
export function idDeRuta(valor: string): number | null {
  return /^\d{1,9}$/.test(valor) && Number(valor) > 0 ? Number(valor) : null;
}
