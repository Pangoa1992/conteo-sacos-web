import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reportesContratista } from "@/db/schema";
import { z } from "zod";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";

const reporteSchema = z.object({
  conteoId: z.number().int(),
  cantidadReportada: z.number().int().nonnegative(),
  nombreContratista: z.string().optional(),
});

/**
 * POST /api/reportes-contratista
 * Registra lo que el contratista dice haber armado (cantidad de sacos),
 * para poder compararlo después contra el conteo automático y detectar
 * discrepancias (módulo de alertas — Fase 2).
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = reporteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, recibido: parsed.data }, { status: 201 });
  }

  const [nuevo] = await db.insert(reportesContratista).values(parsed.data).returning();
  return NextResponse.json(nuevo, { status: 201 });
}
