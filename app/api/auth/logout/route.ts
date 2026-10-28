import { NextRequest, NextResponse } from "next/server";
import { NOMBRE_COOKIE_SESION, opcionesCookieSesion } from "@/lib/auth";

/** POST /api/auth/logout — borra la cookie de sesión (con los mismos atributos con que se creó). */
export async function POST(req: NextRequest) {
  const respuesta = NextResponse.json({ ok: true });
  respuesta.cookies.set(NOMBRE_COOKIE_SESION, "", { ...opcionesCookieSesion(req), maxAge: 0 });
  return respuesta;
}
