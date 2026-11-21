import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { descartarFoto } from "@/lib/bitacora-whatsapp-servidor";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/whatsapp/mensajes/:id/descartar (solo personal de MACROMEC)
 * Saca la foto de la bandeja sin crear un lote. El mensaje sigue en la bitácora.
 *   200 · 400 sin foto · 404 · 409 ya registrada como lote · 503 error
 */
export async function POST(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const { id: texto } = await contexto.params;
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });
  if (!/^\d{1,9}$/.test(texto) || Number(texto) <= 0) return NextResponse.json({ error: "Identificador inválido" }, { status: 400, headers: SIN_CACHE });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Base de datos no configurada" }, { status: 503, headers: SIN_CACHE });

  try {
    const r = await descartarFoto(Number(texto), usuario.id);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status, headers: SIN_CACHE });
    return NextResponse.json({ ok: true, yaDescartada: r.yaRevisado }, { headers: SIN_CACHE });
  } catch (err) {
    console.error("[whatsapp] Error al descartar la foto:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo descartar la foto. Intente nuevamente." }, { status: 503, headers: SIN_CACHE });
  }
}
