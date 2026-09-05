import { NextResponse } from "next/server";
import { NOMBRE_COOKIE_SESION } from "@/lib/auth";

/** POST /api/auth/logout — borra la cookie de sesión. */
export async function POST() {
  const respuesta = NextResponse.json({ ok: true });
  respuesta.cookies.set(NOMBRE_COOKIE_SESION, "", { maxAge: 0, path: "/" });
  return respuesta;
}
