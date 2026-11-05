import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conteos, evidencias, evidenciasContenido } from "@/db/schema";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { BYTES_MAXIMOS_FOTO, LONGITUD_MAXIMA_DESCRIPCION } from "@/lib/evidencias";
import { FotoInvalida, procesarFoto } from "@/lib/evidencias-servidor";
import {
  FUENTE_VIDEO,
  ORIGEN_VIDEO,
  ORIGEN_VIDEO_PRUEBA,
  contarVideo,
  parametrosValidos,
  type LoteRegistradoVideo,
} from "@/lib/conteo-video";
import { huellaFotograma, idExternoVideo, verificarFotogramas } from "@/lib/registro-video";

export const dynamic = "force-dynamic";

// Foto de evidencia + hasta 721 firmas (≈ 0,5 KB cada una) + campos.
const BYTES_MAXIMOS_PETICION = BYTES_MAXIMOS_FOTO + 1024 * 1024;
const SIN_CACHE = { "Cache-Control": "no-store" };

const MOTIVO: Record<string, string> = {
  formato: "Los resultados del análisis no son válidos. Vuelva a analizar el video.",
  firma: "Los resultados del análisis no son válidos. Vuelva a analizar el video.",
  secuencia: "Faltan fotogramas del análisis o están desordenados. Vuelva a analizar el video.",
  usuario: "El análisis lo hizo otro usuario: vuelva a analizar el video.",
  vencido: "El análisis venció (60 minutos). Vuelva a analizar el video para registrarlo.",
  sin_clave: "El servidor no puede verificar el análisis (autenticación sin configurar).",
};

const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE });

/**
 * POST /api/contar-video/registrar  (multipart/form-data)
 *   fotogramas  JSON: las firmas que devolvió /api/contar-video/fotograma, en orden
 *   parametros  JSON: { lineaX, direccion } usados en el análisis
 *   evidencia   índice del fotograma que se guarda como evidencia
 *   foto        ese mismo fotograma (se comprueba su huella)
 *   tipo        "real" | "prueba"  (origen «video» o «prueba_video»)
 *   descripcion opcional (máx. 200)
 *
 * Vuelve a contar los sacos con las detecciones firmadas (mismo seguimiento que el panel)
 * y registra el resultado como un lote PENDIENTE de validación con el fotograma como
 * evidencia, en una transacción. El total lo calcula el servidor. La misma sesión de
 * análisis no crea dos lotes. Solo personal de MACROMEC.
 *
 *   201 lote creado · 200 ya era ese lote · 400 datos inválidos · 401/403 sesión o rol
 *   409 ya registrado con otro tipo · 413 demasiado grande · 503 sin base de datos o error
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return error("No autenticado", 401);
  if (usuario.rol !== "admin_macromec") return error("No autorizado", 403);

  const longitud = Number(req.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > BYTES_MAXIMOS_PETICION) return error("La solicitud es demasiado grande", 413);
  const formulario = await req.formData().catch(() => null);
  if (!formulario) return error("Formulario inválido", 400);
  const foto = formulario.get("foto");
  const tipo = formulario.get("tipo");
  const descripcionCampo = formulario.get("descripcion");
  const indiceEvidencia = Number(formulario.get("evidencia"));
  let firmas: unknown;
  let parametrosCrudos: unknown;
  try {
    firmas = JSON.parse(String(formulario.get("fotogramas") ?? ""));
    parametrosCrudos = JSON.parse(String(formulario.get("parametros") ?? ""));
  } catch {
    return error("Faltan los resultados del análisis o los parámetros", 400);
  }
  if (!(foto instanceof File)) return error("Falta el fotograma de evidencia (campo «foto»)", 400);
  if (foto.size > BYTES_MAXIMOS_FOTO) return error("El fotograma de evidencia supera 1,5 MB", 413);
  if (tipo !== "real" && tipo !== "prueba") return error("Indique si el lote es un dato real o de prueba", 400);
  const parametros = parametrosValidos(parametrosCrudos);
  if (!parametros) return error("Parámetros de conteo inválidos (línea o dirección)", 400);
  const descripcion = typeof descripcionCampo === "string" ? descripcionCampo.trim() : "";
  if (descripcion.length > LONGITUD_MAXIMA_DESCRIPCION) {
    return error(`La descripción admite ${LONGITUD_MAXIMA_DESCRIPCION} caracteres como máximo`, 400);
  }

  const verificacion = verificarFotogramas(firmas, usuario.id);
  if (!verificacion.valido) {
    const status = verificacion.motivo === "sin_clave" ? 503 : verificacion.motivo === "usuario" ? 403 : 400;
    return error(MOTIVO[verificacion.motivo], status);
  }
  const { datos, fotogramas } = verificacion;
  const resultado = contarVideo(fotogramas, parametros);
  if (resultado.total <= 0) return error("Un video sin sacos contados no se registra como lote", 400);

  if (!Number.isSafeInteger(indiceEvidencia) || indiceEvidencia < 0 || indiceEvidencia >= datos.length) {
    return error("Fotograma de evidencia inválido", 400);
  }
  const recibida = Buffer.from(await foto.arrayBuffer());
  if (huellaFotograma(recibida) !== datos[indiceEvidencia].f) {
    return error("El fotograma de evidencia no es uno de los analizados. Vuelva a analizar el video.", 400);
  }
  let procesada;
  try {
    procesada = await procesarFoto(recibida);
  } catch (err) {
    if (err instanceof FotoInvalida) return error(err.message, 400);
    throw err;
  }

  if (!process.env.DATABASE_URL) return error("No hay base de datos configurada: no se puede registrar el lote", 503);

  const origen = tipo === "prueba" ? ORIGEN_VIDEO_PRUEBA : ORIGEN_VIDEO;
  const idExterno = idExternoVideo(datos[0].s, usuario.id);
  const sentido = parametros.direccion === "derecha_a_izquierda" ? "de derecha a izquierda" : "de izquierda a derecha";
  const descripcionFinal = descripcion
    || `Video analizado con «Contar por video»: ${resultado.total} saco${resultado.total === 1 ? "" : "s"} en ${resultado.duracionAnalizada.toLocaleString("es-PE")} s (${resultado.fotogramas} fotogramas, línea al ${Math.round(parametros.lineaX * 100)} %, ${sentido}).`.slice(0, LONGITUD_MAXIMA_DESCRIPCION);

  try {
    const r = await db.transaction(async (tx): Promise<{ status: number; cuerpo: LoteRegistradoVideo | { error: string; loteId: number } }> => {
      const [creado] = await tx.insert(conteos).values({
        cantidadSacos: resultado.total,
        origen,
        fuenteCamara: FUENTE_VIDEO,
        confianzaPromedio: resultado.confianzaPromedio === null ? null : resultado.confianzaPromedio.toFixed(2),
        idExterno,
        contadoEn: new Date(datos[0].e),
      }).onConflictDoNothing({ target: conteos.idExterno }).returning();

      if (!creado) {
        const [existente] = await tx.select().from(conteos).where(eq(conteos.idExterno, idExterno)).limit(1);
        if (existente.origen !== origen) {
          return { status: 409, cuerpo: { error: `Este análisis ya se registró como lote #${existente.id} con otro tipo de dato`, loteId: existente.id } };
        }
        const [ev] = await tx.select({ id: evidencias.id }).from(evidencias).where(eq(evidencias.conteoId, existente.id)).limit(1);
        return {
          status: 200,
          cuerpo: {
            lote: { id: existente.id, cantidadSacos: existente.cantidadSacos, origen: existente.origen, estadoValidacion: existente.estadoValidacion },
            evidenciaId: ev?.id ?? null,
            yaRegistrado: true,
            resultado,
          },
        };
      }

      const [ev] = await tx.insert(evidencias).values({
        conteoId: creado.id,
        descripcion: descripcionFinal,
        sha256: procesada.sha256,
        bytes: procesada.imagen.length,
        ancho: procesada.ancho,
        alto: procesada.alto,
        bytesMiniatura: procesada.miniatura.length,
        tomadaEn: null,
        subidoPor: usuario.id,
      }).returning({ id: evidencias.id });
      await tx.insert(evidenciasContenido).values({ evidenciaId: ev.id, imagen: procesada.imagen, miniatura: procesada.miniatura });

      return {
        status: 201,
        cuerpo: {
          lote: { id: creado.id, cantidadSacos: creado.cantidadSacos, origen: creado.origen, estadoValidacion: creado.estadoValidacion },
          evidenciaId: ev.id,
          yaRegistrado: false,
          resultado,
        },
      };
    });
    return NextResponse.json(r.cuerpo, { status: r.status, headers: SIN_CACHE });
  } catch (err) {
    console.error("[contar-video] Error al registrar el lote:", mensajeErrorBD(err));
    return error("No se pudo registrar el lote. Intente nuevamente.", 503);
  }
}
