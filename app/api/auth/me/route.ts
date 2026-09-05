import { NextRequest, NextResponse } from "next/server";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";

/** GET /api/auth/me — devuelve los datos del usuario logueado, o null si no hay sesión. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;

  if (!token) {
    return NextResponse.json({ usuario: null });
  }

  const usuario = await verificarToken(token);
  return NextResponse.json({ usuario });
}
