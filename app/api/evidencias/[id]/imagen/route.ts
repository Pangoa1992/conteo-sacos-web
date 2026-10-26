import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { evidencias, evidenciasContenido } from "@/db/schema";
import { eq } from "drizzle-orm";
import { usuarioDeSesion } from "@/lib/auth";

/**
 * GET /api/evidencias/:id/imagen?tam=miniatura|completa
 * Entrega los bytes de una evidencia solo a usuarios con sesión.
 * Una evidencia anulada solo la ve el personal de MACROMEC; para el cliente
 * responde 404, igual que si no existiera.
 * La URL no termina en .jpg a propósito: el middleware no revisa esas rutas.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const id = Number(params.id);
  if (!/^\d{1,9}$/.test(params.id) || id <= 0) {
    return NextResponse.json({ error: "Identificador de evidencia inválido" }, { status: 400 });
  }
  const tam = req.nextUrl.searchParams.get("tam") ?? "completa";
  if (tam !== "completa" && tam !== "miniatura") {
    return NextResponse.json({ error: "Tamaño inválido (miniatura o completa)" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  const [fila] = await db
    .select({
      anuladaEn: evidencias.anuladaEn,
      datos: tam === "miniatura" ? evidenciasContenido.miniatura : evidenciasContenido.imagen,
    })
    .from(evidencias)
    .innerJoin(evidenciasContenido, eq(evidenciasContenido.evidenciaId, evidencias.id))
    .where(eq(evidencias.id, id))
    .limit(1);

  if (!fila || (fila.anuladaEn !== null && usuario.rol !== "admin_macromec")) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(fila.datos), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(fila.datos.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="evidencia-${id}${tam === "miniatura" ? "-miniatura" : ""}.jpg"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
