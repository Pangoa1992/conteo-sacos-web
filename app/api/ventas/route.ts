import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ventas } from "@/db/schema";
import { z } from "zod";

const ventaInputSchema = z.object({
  conteoId: z.number().int(),
  precioPorSaco: z.number().positive(),
});

/**
 * POST /api/ventas
 * Registra una venta a partir de un conteo ya confirmado.
 * (Módulo de venta — Fase 1, según el requerimiento tentativo N°3
 * del Capítulo II).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ventaInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { conteoId, precioPorSaco } = parsed.data;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        modoSimulado: true,
        recibido: {
          conteoId,
          precioPorSaco,
          totalVentaEstimado: precioPorSaco, // se calcula real cuando haya BD
        },
      },
      { status: 201 }
    );
  }

  const [nueva] = await db.insert(ventas).values(parsed.data).returning();
  return NextResponse.json(nueva, { status: 201 });
}
