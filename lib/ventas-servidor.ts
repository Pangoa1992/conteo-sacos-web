import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ventasLote } from "@/db/schema";

type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Sacos vendidos en ventas ACTIVAS (no anuladas) del lote. */
export async function sacosVendidosActivos(tx: Transaccion | typeof db, conteoId: number): Promise<number> {
  const [fila] = await tx
    .select({ vendidos: sql<number>`coalesce(sum(${ventasLote.cantidadSacos}), 0)::int` })
    .from(ventasLote)
    .where(and(eq(ventasLote.conteoId, conteoId), isNull(ventasLote.anuladaEn)));
  return fila?.vendidos ?? 0;
}
