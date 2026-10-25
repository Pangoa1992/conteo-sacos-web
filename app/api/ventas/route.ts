import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ventas, conteos } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { verificarToken, NOMBRE_COOKIE_SESION } from "@/lib/auth";
import { esOrigenPrueba } from "@/lib/conteos";

const ventaInputSchema = z.object({
  conteoId: z.number().int(),
  precioPorSaco: z.number().positive().max(99_999_999.99),
});

// Máximo representable en numeric(10, 2) (columnas precio_por_saco y total_venta).
const MAXIMO_NUMERIC_10_2 = 99_999_999.99;

/**
 * GET /api/ventas
 * Lista las ventas registradas, junto con el conteo de sacos asociado.
 * Solo visible para personal de MACROMEC (rol admin_macromec).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, ventas: MOCK_VENTAS });
  }

  const lista = await db
    .select({
      id: ventas.id,
      conteoId: ventas.conteoId,
      precioPorSaco: ventas.precioPorSaco,
      totalVenta: ventas.totalVenta,
      confirmada: ventas.confirmada,
      creadoEn: ventas.creadoEn,
      cantidadSacos: conteos.cantidadSacos,
      origenConteo: conteos.origen,
    })
    .from(ventas)
    .leftJoin(conteos, eq(ventas.conteoId, conteos.id))
    .orderBy(desc(ventas.creadoEn))
    .limit(50);

  return NextResponse.json({
    modoSimulado: false,
    ventas: lista.map(({ origenConteo, ...v }) => ({ ...v, esPrueba: esOrigenPrueba(origenConteo) })),
  });
}

/**
 * POST /api/ventas
 * Registra una venta a partir de un conteo ya confirmado.
 * (Módulo de venta — Fase 1, según el requerimiento tentativo N°3
 * del Capítulo II). Solo personal de MACROMEC puede registrar ventas.
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
        recibido: { conteoId, precioPorSaco, totalVentaEstimado: precioPorSaco },
      },
      { status: 201 }
    );
  }

  const [conteo] = await db.select().from(conteos).where(eq(conteos.id, conteoId)).limit(1);
  if (!conteo) {
    return NextResponse.json({ error: "El conteo indicado no existe" }, { status: 404 });
  }

  const totalVenta = precioPorSaco * conteo.cantidadSacos;
  if (totalVenta > MAXIMO_NUMERIC_10_2) {
    return NextResponse.json({ error: "El total de la venta excede el máximo permitido" }, { status: 400 });
  }

  const [nueva] = await db.insert(ventas).values({
    conteoId,
    precioPorSaco: precioPorSaco.toString(),
    totalVenta: totalVenta.toString(),
    confirmada: true,
  }).returning();

  return NextResponse.json(nueva, { status: 201 });
}

const MOCK_VENTAS = [
  { id: 1, conteoId: 1, cantidadSacos: 118, precioPorSaco: 8.5, totalVenta: 1003, confirmada: true, creadoEn: new Date().toISOString() },
];
