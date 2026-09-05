import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos, reportesContratista } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

// Esquema de validación de lo que envía el módulo de visión (Python)
const conteoInputSchema = z.object({
  cantidadSacos: z.number().int().nonnegative(),
  fuenteCamara: z.string().optional(),
  confianzaPromedio: z.number().min(0).max(100).optional(),
});

// A partir de esta diferencia entre el conteo automático y el reporte
// del contratista, se marca como discrepancia (alerta) — Fase 2.
const UMBRAL_DISCREPANCIA = 1;

/**
 * GET /api/conteo
 * Devuelve los últimos conteos registrados, junto con el reporte del
 * contratista (si existe) y si hay discrepancia entre ambos, para que
 * el dashboard muestre la alerta correspondiente.
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

  // Para cada conteo, busca si el contratista reportó una cantidad y
  // calcula si hay discrepancia frente al conteo automático.
  const conteosConAlerta = await Promise.all(
    ultimos.map(async (c) => {
      const [reporte] = await db
        .select()
        .from(reportesContratista)
        .where(eq(reportesContratista.conteoId, c.id))
        .limit(1);

      const discrepancia = reporte
        ? Math.abs(reporte.cantidadReportada - c.cantidadSacos) > UMBRAL_DISCREPANCIA
        : false;

      return {
        ...c,
        reporteContratista: reporte
          ? { cantidadReportada: reporte.cantidadReportada, nombreContratista: reporte.nombreContratista }
          : null,
        discrepancia,
      };
    })
  );

  return NextResponse.json({ modoSimulado: false, conteos: conteosConAlerta });
}

/**
 * POST /api/conteo
 * Endpoint que consume el módulo de Python (api_cliente.py) cada vez
 * que termina de procesar un lote de video y obtiene un conteo.
 *
 * Seguridad (pendiente): validar VISION_API_TOKEN antes de aceptar el
 * envío, para que solo el módulo de visión pueda escribir.
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

  const [nuevo] = await db.insert(conteos).values({
    cantidadSacos: parsed.data.cantidadSacos,
    fuenteCamara: parsed.data.fuenteCamara,
    confianzaPromedio: parsed.data.confianzaPromedio?.toString(),
  }).returning();

  return NextResponse.json(nuevo, { status: 201 });
}

// Datos de ejemplo para poder ver el dashboard funcionando
// mientras no se conecta la cámara real ni la base de datos.
const MOCK_CONTEOS = [
  { id: 1, cantidadSacos: 118, fuenteCamara: "camara_poza_1", confianzaPromedio: 96.4, creadoEn: new Date().toISOString(), reporteContratista: { cantidadReportada: 120, nombreContratista: "Juan Pérez" }, discrepancia: true },
  { id: 2, cantidadSacos: 104, fuenteCamara: "camara_poza_1", confianzaPromedio: 94.1, creadoEn: new Date(Date.now() - 3600_000).toISOString(), reporteContratista: null, discrepancia: false },
  { id: 3, cantidadSacos: 97, fuenteCamara: "camara_poza_1", confianzaPromedio: 95.8, creadoEn: new Date(Date.now() - 7200_000).toISOString(), reporteContratista: { cantidadReportada: 97, nombreContratista: "Juan Pérez" }, discrepancia: false },
];
