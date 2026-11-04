import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { estadoConfiguracionWhatsapp, type EstadoWhatsapp } from "@/lib/estado-whatsapp";
import { modoDemoWhatsappActivo } from "@/lib/modo-demo-whatsapp-servidor";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/whatsapp/estado
 * Estado de la integración de WhatsApp para el panel (solo administrador).
 * Devuelve únicamente las claves de CLAVES_ESTADO_WHATSAPP: indicadores sí/no
 * y cantidades. Nunca el token, los números, el dominio de la URL pública,
 * datos de la conexión ni mensajes de error internos.
 *   200 · 401 sin sesión · 403 rol cliente
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });

  // Misma regla que el webhook: real = origen que no empieza por «prueba».
  let hayConteosReales: boolean | null = null;
  if (process.env.DATABASE_URL) {
    try {
      const [fila] = await db.execute<{ hay: boolean }>(sql`select exists (select 1 from conteos where lower(origen) not like 'prueba%') as hay`);
      hayConteosReales = fila?.hay === true;
    } catch {
      console.error("[whatsapp] Estado: no se pudo consultar si hay conteos reales.");
    }
  }

  const estado: EstadoWhatsapp = {
    ...estadoConfiguracionWhatsapp(process.env),
    hayConteosReales,
    modoDemo: await modoDemoWhatsappActivo(),
  };
  return NextResponse.json(estado, { headers: SIN_CACHE });
}
