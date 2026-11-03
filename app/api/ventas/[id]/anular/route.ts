import { NextRequest, NextResponse } from "next/server";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { db } from "@/db";
import { conteos, ventasLote } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";
import { LONGITUD_MAXIMA_MOTIVO_ANULACION, esRechazoDeVentaEnBD } from "@/lib/ventas";
import { sacosVendidosActivos } from "@/lib/ventas-servidor";

const anulacionSchema = z.object({
  motivo: z.string().trim().min(1, "Indique el motivo de la anulación").max(LONGITUD_MAXIMA_MOTIVO_ANULACION),
});

function leerId(param: string): number | null {
  const id = Number(param);
  return /^\d{1,9}$/.test(param) && id > 0 ? id : null;
}

/**
 * PATCH /api/ventas/:id/anular
 * Anula una venta parcial con motivo obligatorio (solo admin_macromec).
 * La venta no se borra: queda con fecha, usuario y motivo de anulación, y
 * deja de restar del stock del lote (los sacos vuelven a estar disponibles).
 *
 *   200 anulada · 400 sin motivo · 401/403 sesión o rol · 404 inexistente
 *   409 ya estaba anulada
 */
export async function PATCH(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const params = await contexto.params;
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;
  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const id = leerId(params.id);
  if (!id) {
    return NextResponse.json({ error: "Identificador de venta inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = anulacionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Indique el motivo de la anulación", detalles: parsed.error.flatten() }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, recibido: parsed.data });
  }

  try {
    const resultado = await db.transaction(async (tx) => {
      // FOR UPDATE: dos anulaciones simultáneas de la misma venta se hacen una tras otra.
      const [venta] = await tx.select().from(ventasLote).where(eq(ventasLote.id, id)).for("update");
      if (!venta) return { status: 404, cuerpo: { error: "La venta indicada no existe" } };
      if (venta.anuladaEn) return { status: 409, cuerpo: { error: "La venta ya estaba anulada" } };

      const [anulada] = await tx
        .update(ventasLote)
        .set({ anuladaEn: new Date(), anuladaPor: usuario.id, motivoAnulacion: parsed.data.motivo })
        .where(eq(ventasLote.id, id))
        .returning();
      const [lote] = await tx.select({ sacosConformes: conteos.sacosConformes }).from(conteos).where(eq(conteos.id, venta.conteoId));
      const disponible = (lote?.sacosConformes ?? 0) - (await sacosVendidosActivos(tx, venta.conteoId));
      return { status: 200, cuerpo: { venta: anulada, disponible } };
    });
    return NextResponse.json(resultado.cuerpo, { status: resultado.status });
  } catch (err) {
    const rechazoVenta = esRechazoDeVentaEnBD(err);
    if (rechazoVenta) {
      return NextResponse.json({ error: rechazoVenta }, { status: 409 });
    }
    console.error("[ventas] Error al anular la venta:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo anular la venta" }, { status: 503 });
  }
}
