import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/sesion-servidor";

/**
 * GET /api/auth/me — devuelve los datos del usuario logueado, o null si no hay sesión
 * válida (sin cookie, token vencido, cuenta desactivada o sesión revocada).
 * El nombre y el rol salen de la base, no del token.
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  return NextResponse.json({ usuario });
}
