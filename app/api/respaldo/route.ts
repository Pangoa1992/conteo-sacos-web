import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { conteoPorTabla, generarRespaldo, historialRespaldos, registrarRespaldo } from "@/lib/respaldo-servidor";
import { nombreArchivoRespaldo } from "@/lib/respaldo";
import { mensajeErrorBD } from "@/lib/errores-bd";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/respaldo                 → qué se respalda (registros por tabla) y últimas descargas.
 * GET /api/respaldo?descargar=1     → descarga el ZIP (un CSV por tabla + manifiesto + LEEME) y anota quién y cuándo.
 * Solo personal de MACROMEC. Solo lectura: no modifica ni restaura datos (la restauración la hace el técnico).
 *   200 · 401 sin sesión · 403 rol · 503 base de datos no disponible
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });

  try {
    if (req.nextUrl.searchParams.get("descargar") !== "1") {
      const [tablas, historial] = await Promise.all([conteoPorTabla(), historialRespaldos()]);
      return NextResponse.json({ tablas, historial, historialDisponible: historial !== null }, { headers: SIN_CACHE });
    }

    const ahora = new Date();
    const { zip, manifiesto, huella } = await generarRespaldo(usuario.nombre, ahora);
    const anotado = await registrarRespaldo(usuario.id, manifiesto.totalRegistros, zip.byteLength, huella);
    console.info(`[respaldo] ${usuario.nombre} descargó un respaldo: ${manifiesto.totalRegistros} registros, ${zip.byteLength} bytes${anotado ? "" : " (sin anotar)"}.`);
    return new NextResponse(Buffer.from(zip), {
      headers: {
        ...SIN_CACHE,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${nombreArchivoRespaldo(ahora)}"`,
        "X-Respaldo-Registros": String(manifiesto.totalRegistros),
        "X-Respaldo-Sha256": huella,
      },
    });
  } catch (err) {
    console.error("[respaldo] Error al generar el respaldo:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo generar el respaldo. Intente nuevamente." }, { status: 503, headers: SIN_CACHE });
  }
}
