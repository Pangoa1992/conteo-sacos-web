import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { evidencias } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { usuarioDeSesion } from "@/lib/auth";
import { LONGITUD_MAXIMA_MOTIVO } from "@/lib/evidencias";

const anulacionSchema = z.object({
  motivo: z.string().trim().min(1, "Indique el motivo de la anulación").max(LONGITUD_MAXIMA_MOTIVO),
});

class Rechazo extends Error {
  constructor(public status: number, public cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error));
  }
}

/**
 * POST /api/evidencias/:id/anular   { motivo }
 * Solo personal de MACROMEC. La evidencia no se borra: queda registrada con
 * la fecha, el usuario y el motivo, y deja de mostrarse al cliente.
 *   200 anulada · 400 sin motivo · 401/403 · 404 no existe · 409 ya estaba anulada
 */
export async function POST(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const params = await contexto.params;
  const usuario = await usuarioDeSesion(req);
  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const id = Number(params.id);
  if (!/^\d{1,9}$/.test(params.id) || id <= 0) {
    return NextResponse.json({ error: "Identificador de evidencia inválido" }, { status: 400 });
  }

  const parsed = anulacionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", detalles: parsed.error.flatten() }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true });
  }

  try {
    const anulada = await db.transaction(async (tx) => {
      const [evidencia] = await tx.select({ anuladaEn: evidencias.anuladaEn }).from(evidencias)
        .where(eq(evidencias.id, id)).for("update");
      if (!evidencia) {
        throw new Rechazo(404, { error: "La evidencia indicada no existe" });
      }
      if (evidencia.anuladaEn !== null) {
        throw new Rechazo(409, { error: "La evidencia ya estaba anulada" });
      }
      const [actualizada] = await tx.update(evidencias)
        .set({ anuladaEn: new Date(), anuladaPor: usuario.id, motivoAnulacion: parsed.data.motivo })
        .where(eq(evidencias.id, id))
        .returning();
      return actualizada;
    });
    return NextResponse.json(anulada);
  } catch (err) {
    if (err instanceof Rechazo) {
      return NextResponse.json(err.cuerpo, { status: err.status });
    }
    console.error("[evidencias] Error al anular la evidencia:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo anular la evidencia" }, { status: 503 });
  }
}
