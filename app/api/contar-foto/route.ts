import { NextRequest, NextResponse } from "next/server";
import { usuarioDeSesion } from "@/lib/auth";
import { BYTES_MAXIMOS_FOTO } from "@/lib/evidencias";
import { FotoInvalida, procesarFoto } from "@/lib/evidencias-servidor";
import {
  DeteccionNoDisponible,
  ROBOFLOW_CONFIANZA,
  ROBOFLOW_MODEL_ID,
  conteoFotoConfigurado,
  detectarSacos,
} from "@/lib/conteo-foto-servidor";
import type { EstadoConteoFoto } from "@/lib/conteo-foto";

// Lee la configuración del servidor en cada petición (no se congela en el build).
export const dynamic = "force-dynamic";

// Margen para la cabecera del formulario multipart.
const BYTES_MAXIMOS_PETICION = BYTES_MAXIMOS_FOTO + 64 * 1024;
const SIN_CACHE = { "Cache-Control": "no-store" };

async function soloAdmin(req: NextRequest): Promise<NextResponse | null> {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  return null;
}

/**
 * GET /api/contar-foto
 * Indica si el conteo por foto está disponible en este servidor. Solo personal
 * de MACROMEC. Nunca devuelve la clave ni la URL del servicio de detección.
 */
export async function GET(req: NextRequest) {
  const rechazo = await soloAdmin(req);
  if (rechazo) return rechazo;
  const estado: EstadoConteoFoto = {
    disponible: conteoFotoConfigurado(),
    modelo: ROBOFLOW_MODEL_ID,
    umbralConfianza: ROBOFLOW_CONFIANZA,
  };
  return NextResponse.json(estado, { headers: SIN_CACHE });
}

/**
 * POST /api/contar-foto  (multipart/form-data, campo «foto»: JPEG ≤ 1,5 MB y ≤ 1600 px)
 * Cuenta los sacos de la foto con RF-DETR y devuelve el total, la confianza y las
 * cajas. Solo personal de MACROMEC. NO guarda la foto ni el resultado y NO crea
 * lotes: no usa la base de datos.
 *
 *   200 resultado · 400 imagen inválida · 401/403 sesión o rol · 413 demasiado grande
 *   502 el servicio de detección falló · 503 sin configurar o sin conexión
 */
export async function POST(req: NextRequest) {
  const rechazo = await soloAdmin(req);
  if (rechazo) return rechazo;

  if (!conteoFotoConfigurado()) {
    return NextResponse.json(
      { error: "El conteo por foto no está configurado en el servidor (falta la clave del servicio de detección)." },
      { status: 503, headers: SIN_CACHE }
    );
  }

  // Se rechaza antes de leer el cuerpo si ya se sabe que es demasiado grande.
  const longitud = Number(req.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > BYTES_MAXIMOS_PETICION) {
    return NextResponse.json({ error: "La foto supera 1,5 MB" }, { status: 413, headers: SIN_CACHE });
  }

  const formulario = await req.formData().catch(() => null);
  const foto = formulario?.get("foto");
  if (!formulario || !(foto instanceof File)) {
    return NextResponse.json({ error: "Falta la foto (campo «foto»)" }, { status: 400, headers: SIN_CACHE });
  }
  if (foto.size > BYTES_MAXIMOS_FOTO) {
    return NextResponse.json({ error: "La foto supera 1,5 MB" }, { status: 413, headers: SIN_CACHE });
  }

  // Misma validación que las evidencias: JPEG íntegro, sin metadatos y con la orientación aplicada.
  let procesada;
  try {
    procesada = await procesarFoto(Buffer.from(await foto.arrayBuffer()));
  } catch (err) {
    if (err instanceof FotoInvalida) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: SIN_CACHE });
    }
    throw err;
  }

  try {
    const resultado = await detectarSacos(procesada.imagen, procesada.ancho, procesada.alto);
    return NextResponse.json(resultado, { headers: SIN_CACHE });
  } catch (err) {
    if (err instanceof DeteccionNoDisponible) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: SIN_CACHE });
    }
    console.error("[contar-foto] Error inesperado al contar la foto:", err instanceof Error ? err.name : "desconocido");
    return NextResponse.json({ error: "No se pudo contar la foto. Intente nuevamente." }, { status: 502, headers: SIN_CACHE });
  }
}
