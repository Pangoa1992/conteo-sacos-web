import { NextRequest, NextResponse } from "next/server";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";

// Rutas que no requieren sesión iniciada.
const RUTAS_PUBLICAS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/dev/seed-usuarios"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

    // El módulo de Python llama a POST /api/conteo sin sesión de navegador;
  // su propia seguridad es el VISION_API_TOKEN (pendiente de validar ahí).
  // Twilio llama a POST /api/whatsapp/webhook igual de forma directa;
  // su seguridad es la validación de firma (X-Twilio-Signature) dentro
  // del propio endpoint, no la cookie de sesión.
  if (
    (pathname === "/api/conteo" && req.method === "POST") ||
    pathname === "/api/whatsapp/webhook"
  ) {
    return NextResponse.next();
  }

  const esRutaPublica = RUTAS_PUBLICAS.some((ruta) => pathname === ruta || pathname.startsWith(ruta + "/"));
  if (esRutaPublica) {
    return NextResponse.next();
  }

  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
