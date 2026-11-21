import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { fotoDeMensaje } from "@/lib/bitacora-whatsapp-servidor";

/**
 * GET /api/whatsapp/mensajes/:id/foto (solo personal de MACROMEC)
 * La foto recibida por WhatsApp, ya normalizada (JPEG sin metadatos, ≤ 1600 px).
 * La URL no termina en .jpg a propósito: el middleware no revisa esas rutas.
 */
export async function GET(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const { id: texto } = await contexto.params;
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (!/^\d{1,9}$/.test(texto) || Number(texto) <= 0) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const imagen = await fotoDeMensaje(Number(texto));
  if (!imagen) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return new NextResponse(new Uint8Array(imagen), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(imagen.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="whatsapp-${texto}.jpg"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
