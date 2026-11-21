import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { registrarComoLote } from "@/lib/bitacora-whatsapp-servidor";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/whatsapp/mensajes/:id/registrar  { "tipo": "real" | "prueba" } (solo personal de MACROMEC)
 * Registra la foto recibida por WhatsApp como lote PENDIENTE de validación (origen «whatsapp»,
 * fuente «whatsapp_foto»), con la foto como evidencia. El total es el que contó la IA al recibirla.
 *   201 lote creado · 200 ya estaba registrado · 400 sin foto · 404 · 409 descartada · 503 error
 */
export async function POST(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const { id: texto } = await contexto.params;
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });
  if (!/^\d{1,9}$/.test(texto) || Number(texto) <= 0) return NextResponse.json({ error: "Identificador inválido" }, { status: 400, headers: SIN_CACHE });
  const body = await req.json().catch(() => null);
  const tipo = body?.tipo;
  if (tipo !== "real" && tipo !== "prueba") {
    return NextResponse.json({ error: "Indique si el lote es un dato real o de prueba" }, { status: 400, headers: SIN_CACHE });
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Base de datos no configurada" }, { status: 503, headers: SIN_CACHE });

  try {
    const r = await registrarComoLote(Number(texto), tipo, usuario.id);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status, headers: SIN_CACHE });
    return NextResponse.json({ loteId: r.loteId, yaRegistrado: r.yaRevisado }, { status: r.status, headers: SIN_CACHE });
  } catch (err) {
    console.error("[whatsapp] Error al registrar la foto como lote:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo registrar el lote. Intente nuevamente." }, { status: 503, headers: SIN_CACHE });
  }
}
