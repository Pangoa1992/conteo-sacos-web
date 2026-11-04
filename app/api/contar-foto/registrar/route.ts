import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conteos, evidencias, evidenciasContenido } from "@/db/schema";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { BYTES_MAXIMOS_FOTO, LONGITUD_MAXIMA_DESCRIPCION } from "@/lib/evidencias";
import { FotoInvalida, procesarFoto } from "@/lib/evidencias-servidor";
import { FUENTE_FOTO, ORIGEN_FOTO, ORIGEN_FOTO_PRUEBA, type LoteRegistradoFoto } from "@/lib/conteo-foto";
import { huellaFoto, idExternoFoto, verificarRegistro } from "@/lib/registro-foto";

export const dynamic = "force-dynamic";

// Margen para la cabecera del formulario multipart y el comprobante.
const BYTES_MAXIMOS_PETICION = BYTES_MAXIMOS_FOTO + 64 * 1024;
const SIN_CACHE = { "Cache-Control": "no-store" };

const MOTIVO_COMPROBANTE: Record<string, string> = {
  formato: "El comprobante del conteo no es válido. Vuelva a contar la foto.",
  firma: "El comprobante del conteo no es válido. Vuelva a contar la foto.",
  vencido: "El conteo venció (30 minutos). Vuelva a contar la foto para registrarla.",
  sin_clave: "El servidor no puede verificar el conteo (autenticación sin configurar).",
};

/**
 * POST /api/contar-foto/registrar  (multipart/form-data)
 *   foto         la MISMA foto que se contó (se comprueba su huella SHA-256)
 *   registro     comprobante firmado que devolvió POST /api/contar-foto
 *   tipo         "real" | "prueba"  (origen «foto» o «prueba_foto»)
 *   descripcion  opcional (máx. 200), se guarda en la evidencia
 *
 * Registra el resultado como un lote PENDIENTE de validación y guarda la foto como su
 * evidencia, en una sola transacción. El total y la confianza salen del comprobante,
 * nunca del navegador. La misma foto no crea dos lotes (id_externo derivado de su huella).
 * Solo personal de MACROMEC.
 *
 *   201 lote creado · 200 la foto ya era ese lote · 400 datos, foto o comprobante inválidos
 *   401/403 sesión o rol · 409 la foto ya se registró con otro tipo · 413 demasiado grande
 *   503 sin base de datos o error al guardar
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const longitud = Number(req.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > BYTES_MAXIMOS_PETICION) {
    return NextResponse.json({ error: "La foto supera 1,5 MB" }, { status: 413, headers: SIN_CACHE });
  }
  const formulario = await req.formData().catch(() => null);
  const foto = formulario?.get("foto");
  const comprobante = formulario?.get("registro");
  const tipo = formulario?.get("tipo");
  const descripcionCampo = formulario?.get("descripcion");
  if (!formulario || !(foto instanceof File)) {
    return NextResponse.json({ error: "Falta la foto (campo «foto»)" }, { status: 400, headers: SIN_CACHE });
  }
  if (foto.size > BYTES_MAXIMOS_FOTO) {
    return NextResponse.json({ error: "La foto supera 1,5 MB" }, { status: 413, headers: SIN_CACHE });
  }
  if (typeof comprobante !== "string" || !comprobante) {
    return NextResponse.json({ error: "Falta el comprobante del conteo (campo «registro»)" }, { status: 400, headers: SIN_CACHE });
  }
  if (tipo !== "real" && tipo !== "prueba") {
    return NextResponse.json({ error: "Indique si el lote es un dato real o de prueba" }, { status: 400, headers: SIN_CACHE });
  }
  const descripcion = typeof descripcionCampo === "string" ? descripcionCampo.trim() : "";
  if (descripcion.length > LONGITUD_MAXIMA_DESCRIPCION) {
    return NextResponse.json({ error: `La descripción admite ${LONGITUD_MAXIMA_DESCRIPCION} caracteres como máximo` }, { status: 400, headers: SIN_CACHE });
  }

  const verificacion = verificarRegistro(comprobante);
  if (!verificacion.valido) {
    const status = verificacion.motivo === "sin_clave" ? 503 : 400;
    return NextResponse.json({ error: MOTIVO_COMPROBANTE[verificacion.motivo] }, { status, headers: SIN_CACHE });
  }
  const datos = verificacion.datos;
  if (datos.usuarioId !== usuario.id) {
    return NextResponse.json({ error: "El conteo lo hizo otro usuario: vuelva a contar la foto." }, { status: 403, headers: SIN_CACHE });
  }
  if (datos.total <= 0) {
    return NextResponse.json({ error: "Una foto sin sacos detectados no se registra como lote" }, { status: 400, headers: SIN_CACHE });
  }

  const recibida = Buffer.from(await foto.arrayBuffer());
  if (huellaFoto(recibida) !== datos.sha256) {
    return NextResponse.json({ error: "La foto no es la misma que se contó. Vuelva a contarla." }, { status: 400, headers: SIN_CACHE });
  }
  let procesada;
  try {
    procesada = await procesarFoto(recibida);
  } catch (err) {
    if (err instanceof FotoInvalida) return NextResponse.json({ error: err.message }, { status: 400, headers: SIN_CACHE });
    throw err;
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "No hay base de datos configurada: no se puede registrar el lote" }, { status: 503, headers: SIN_CACHE });
  }

  const origen = tipo === "prueba" ? ORIGEN_FOTO_PRUEBA : ORIGEN_FOTO;
  const idExterno = idExternoFoto(datos.sha256);
  try {
    const resultado = await db.transaction(async (tx): Promise<{ status: number; cuerpo: LoteRegistradoFoto | { error: string; loteId: number } }> => {
      const [creado] = await tx.insert(conteos).values({
        cantidadSacos: datos.total,
        origen,
        fuenteCamara: FUENTE_FOTO,
        confianzaPromedio: datos.confianzaPromedio === null ? null : datos.confianzaPromedio.toFixed(2),
        idExterno,
        contadoEn: new Date(datos.emitidoEn),
      }).onConflictDoNothing({ target: conteos.idExterno }).returning();

      if (!creado) {
        // La misma foto ya creó un lote (doble clic, reintento o recarga): no se duplica.
        const [existente] = await tx.select().from(conteos).where(eq(conteos.idExterno, idExterno)).limit(1);
        if (existente.origen !== origen) {
          return { status: 409, cuerpo: { error: `Esta foto ya se registró como lote #${existente.id} con otro tipo de dato`, loteId: existente.id } };
        }
        const [evidencia] = await tx.select({ id: evidencias.id }).from(evidencias)
          .where(eq(evidencias.conteoId, existente.id)).limit(1);
        return {
          status: 200,
          cuerpo: {
            lote: { id: existente.id, cantidadSacos: existente.cantidadSacos, origen: existente.origen, estadoValidacion: existente.estadoValidacion },
            evidenciaId: evidencia?.id ?? null,
            yaRegistrado: true,
          },
        };
      }

      const [evidencia] = await tx.insert(evidencias).values({
        conteoId: creado.id,
        descripcion: descripcion || `Foto analizada con «Contar por foto»: ${datos.total} saco${datos.total === 1 ? "" : "s"} detectado${datos.total === 1 ? "" : "s"}.`,
        sha256: procesada.sha256,
        bytes: procesada.imagen.length,
        ancho: procesada.ancho,
        alto: procesada.alto,
        bytesMiniatura: procesada.miniatura.length,
        tomadaEn: null,
        subidoPor: usuario.id,
      }).returning({ id: evidencias.id });
      await tx.insert(evidenciasContenido).values({ evidenciaId: evidencia.id, imagen: procesada.imagen, miniatura: procesada.miniatura });

      return {
        status: 201,
        cuerpo: {
          lote: { id: creado.id, cantidadSacos: creado.cantidadSacos, origen: creado.origen, estadoValidacion: creado.estadoValidacion },
          evidenciaId: evidencia.id,
          yaRegistrado: false,
        },
      };
    });
    return NextResponse.json(resultado.cuerpo, { status: resultado.status, headers: SIN_CACHE });
  } catch (err) {
    console.error("[contar-foto] Error al registrar el lote:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo registrar el lote. Intente nuevamente." }, { status: 503, headers: SIN_CACHE });
  }
}
