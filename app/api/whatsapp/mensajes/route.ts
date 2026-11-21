import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { listarMensajes } from "@/lib/bitacora-whatsapp-servidor";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/whatsapp/mensajes (solo personal de MACROMEC)
 * Bitácora de los últimos 100 mensajes de WhatsApp: quién consultó (número enmascarado y
 * nombre del contacto), qué pidió, el resultado y, si mandó una foto, cuántos sacos contó
 * la IA y si el personal ya la registró como lote o la descartó. Nunca las imágenes.
 *   200 · 401 sin sesión · 403 rol cliente · 503 sin base de datos o migración 0010 pendiente
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Base de datos no configurada" }, { status: 503, headers: SIN_CACHE });
  }
  const mensajes = await listarMensajes();
  if (!mensajes) {
    return NextResponse.json({ error: "No se pudo leer la bitácora de WhatsApp (¿falta aplicar la migración 0010?)." }, { status: 503, headers: SIN_CACHE });
  }
  return NextResponse.json({ mensajes }, { headers: SIN_CACHE });
}
