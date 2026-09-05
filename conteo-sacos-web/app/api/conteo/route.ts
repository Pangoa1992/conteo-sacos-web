import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos } from "@/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod";

// Esquema de validación de lo que envía el módulo de visión (Python)
const conteoInputSchema = z.object({
  cantidadSacos: z.number().int().nonnegative(),
  fuenteCamara: z.string().optional(),
  confianzaPromedio: z.number().min(0).max(100).optional(),
});

/**
 * GET /api/conteo
 * Devuelve los últimos conteos registrados, para que el dashboard
 * los muestre en tiempo real (polling simple por ahora).
 *
 * NOTA (estado actual): mientras no haya conexión con la cámara real
 * ni con la base de datos configurada, se devuelven datos simulados
 * (mock) para poder demostrar el flujo completo end-to-end.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      modoSimulado: true,
      conteos: MOCK_CONTEOS,
    });
  }

  const ultimos = await db
    .select()
    .from(conteos)
    .orderBy(desc(conteos.creadoEn))
    .limit(20);

  return NextResponse.json({ modoSimulado: false, conteos: ultimos });
}

/**
 * POST /api/conteo
 * Endpoint que consume el módulo de Python (api_cliente.py) cada vez
 * que termina de procesar un lote de video y obtiene un conteo.
 *
 * Seguridad (pendiente Fase 2): validar VISION_API_TOKEN antes de
 * aceptar el envío, para que solo el módulo de visión pueda escribir.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = conteoInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!process.env.DATABASE_URL) {
    // Modo simulado: no hay BD configurada todavía, solo confirmamos recepción.
    return NextResponse.json(
      { modoSimulado: true, recibido: parsed.data },
      { status: 201 }
    );
  }

  const [nuevo] = await db.insert(conteos).values(parsed.data).returning();
  return NextResponse.json(nuevo, { status: 201 });
}

// Datos de ejemplo para poder ver el dashboard funcionando
// mientras no se conecta la cámara real ni la base de datos.
const MOCK_CONTEOS = [
  { id: 1, cantidadSacos: 118, fuenteCamara: "camara_poza_1", confianzaPromedio: 96.4, creadoEn: new Date().toISOString() },
  { id: 2, cantidadSacos: 104, fuenteCamara: "camara_poza_1", confianzaPromedio: 94.1, creadoEn: new Date(Date.now() - 3600_000).toISOString() },
  { id: 3, cantidadSacos: 97, fuenteCamara: "camara_poza_1", confianzaPromedio: 95.8, creadoEn: new Date(Date.now() - 7200_000).toISOString() },
];
