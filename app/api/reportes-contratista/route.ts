import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos, reportesContratista } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";

const reporteSchema = z.object({
  conteoId: z.number().int(),
  cantidadReportada: z.number().int().nonnegative(),
  nombreContratista: z.string().max(150).optional(), // varchar(150) en la BD
});

/**
 * POST /api/reportes-contratista
 * Registra lo que el contratista dice haber armado (cantidad de sacos),
 * para poder compararlo después contra el conteo automático y detectar
 * discrepancias (módulo de alertas — Fase 2).
 * Solo personal de MACROMEC (rol admin_macromec), igual que en el dashboard.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
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

  const [conteo] = await db.select({ id: conteos.id }).from(conteos).where(eq(conteos.id, parsed.data.conteoId)).limit(1);
  if (!conteo) {
    return NextResponse.json({ error: "El conteo indicado no existe" }, { status: 404 });
  }

  const [nuevo] = await db.insert(reportesContratista).values(parsed.data).returning();
  return NextResponse.json(nuevo, { status: 201 });
}
