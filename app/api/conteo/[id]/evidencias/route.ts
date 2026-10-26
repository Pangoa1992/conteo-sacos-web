import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conteos, evidencias, evidenciasContenido, usuarios } from "@/db/schema";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { usuarioDeSesion } from "@/lib/auth";
import {
  BYTES_MAXIMOS_FOTO,
  LONGITUD_MAXIMA_DESCRIPCION,
  MAXIMO_EVIDENCIAS_ACTIVAS,
} from "@/lib/evidencias";
import { FotoInvalida, procesarFoto } from "@/lib/evidencias-servidor";

// Margen para los demás campos del formulario multipart.
const BYTES_MAXIMOS_PETICION = BYTES_MAXIMOS_FOTO + 64 * 1024;
// La fecha que declara el celular se acepta si no es futura ni muy antigua.
const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const ANTIGUEDAD_MAXIMA_MS = 365 * 24 * 3600_000;

class Rechazo extends Error {
  constructor(public status: number, public cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error));
  }
}

function leerId(param: string): number | null {
  const id = Number(param);
  return /^\d{1,9}$/.test(param) && id > 0 ? id : null;
}

/**
 * GET /api/conteo/:id/evidencias
 * Metadatos de las evidencias del conteo (nunca los bytes de la imagen).
 * Personal de MACROMEC: todas, con los datos de anulación.
 * Cliente: solo las activas; las anuladas no se le muestran.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const id = leerId(params.id);
  if (!id) {
    return NextResponse.json({ error: "Identificador de conteo inválido" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, maximo: MAXIMO_EVIDENCIAS_ACTIVAS, evidencias: [] });
  }

  const [conteo] = await db.select({ id: conteos.id }).from(conteos).where(eq(conteos.id, id)).limit(1);
  if (!conteo) {
    return NextResponse.json({ error: "El conteo indicado no existe" }, { status: 404 });
  }

  const esAdmin = usuario.rol === "admin_macromec";
  const subidor = alias(usuarios, "subidor");
  const anulador = alias(usuarios, "anulador");
  const filas = await db
    .select({
      id: evidencias.id,
      conteoId: evidencias.conteoId,
      descripcion: evidencias.descripcion,
      sha256: evidencias.sha256,
      bytes: evidencias.bytes,
      ancho: evidencias.ancho,
      alto: evidencias.alto,
      tomadaEn: evidencias.tomadaEn,
      subidoPorNombre: subidor.nombre,
      subidoEn: evidencias.subidoEn,
      anuladaEn: evidencias.anuladaEn,
      anuladaPorNombre: anulador.nombre,
      motivoAnulacion: evidencias.motivoAnulacion,
    })
    .from(evidencias)
    .leftJoin(subidor, eq(evidencias.subidoPor, subidor.id))
    .leftJoin(anulador, eq(evidencias.anuladaPor, anulador.id))
    .where(esAdmin ? eq(evidencias.conteoId, id) : and(eq(evidencias.conteoId, id), isNull(evidencias.anuladaEn)))
    .orderBy(asc(evidencias.id));

  const lista = esAdmin
    ? filas
    : filas.map(({ anuladaEn, anuladaPorNombre, motivoAnulacion, ...visible }) => visible);

  return NextResponse.json({
    modoSimulado: false,
    maximo: MAXIMO_EVIDENCIAS_ACTIVAS,
    activas: filas.filter((f) => f.anuladaEn === null).length,
    evidencias: lista,
  });
}

/**
 * POST /api/conteo/:id/evidencias  (multipart/form-data)
 *   foto (JPEG, ≤ 1,5 MB y ≤ 1600 px), descripcion (opcional, ≤ 200),
 *   tomadaEn (opcional, ISO 8601: fecha que declara el celular).
 * Solo personal de MACROMEC. Valida y recodifica la foto sin metadatos,
 * guarda metadatos y contenido en la misma transacción y NO modifica el conteo.
 *
 *   201 creada · 400 datos o imagen inválidos · 401/403 sesión o rol · 404 conteo
 *   409 límite de 10 activas o foto repetida · 413 demasiado grande
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (usuario.rol !== "admin_macromec") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const id = leerId(params.id);
  if (!id) {
    return NextResponse.json({ error: "Identificador de conteo inválido" }, { status: 400 });
  }

  // Se rechaza antes de leer el cuerpo si ya se sabe que es demasiado grande.
  const longitud = Number(req.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > BYTES_MAXIMOS_PETICION) {
    return NextResponse.json({ error: "La foto supera 1,5 MB" }, { status: 413 });
  }

  const formulario = await req.formData().catch(() => null);
  const foto = formulario?.get("foto");
  if (!formulario || !(foto instanceof File)) {
    return NextResponse.json({ error: "Falta la foto (campo «foto»)" }, { status: 400 });
  }
  if (foto.size > BYTES_MAXIMOS_FOTO) {
    return NextResponse.json({ error: "La foto supera 1,5 MB" }, { status: 413 });
  }

  const descripcionCampo = formulario.get("descripcion");
  const descripcion = typeof descripcionCampo === "string" ? descripcionCampo.trim() : "";
  if (descripcion.length > LONGITUD_MAXIMA_DESCRIPCION) {
    return NextResponse.json({ error: `La descripción admite ${LONGITUD_MAXIMA_DESCRIPCION} caracteres como máximo` }, { status: 400 });
  }

  const tomadaCampo = formulario.get("tomadaEn");
  let tomadaEn: Date | null = null;
  if (typeof tomadaCampo === "string" && tomadaCampo !== "") {
    tomadaEn = new Date(tomadaCampo);
    const t = tomadaEn.getTime();
    if (!/^\d{4}-\d{2}-\d{2}T/.test(tomadaCampo) || Number.isNaN(t) || t > Date.now() + TOLERANCIA_FUTURO_MS || t < Date.now() - ANTIGUEDAD_MAXIMA_MS) {
      return NextResponse.json({ error: "Fecha de la foto inválida" }, { status: 400 });
    }
  }

  let procesada;
  try {
    procesada = await procesarFoto(Buffer.from(await foto.arrayBuffer()));
  } catch (err) {
    if (err instanceof FotoInvalida) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, bytes: procesada.imagen.length }, { status: 201 });
  }

  try {
    const creada = await db.transaction(async (tx) => {
      // Bloquea el conteo (solo lectura de la fila) para contar las activas sin carreras.
      const [conteo] = await tx.select({ id: conteos.id }).from(conteos).where(eq(conteos.id, id)).for("update");
      if (!conteo) {
        throw new Rechazo(404, { error: "El conteo indicado no existe" });
      }
      const activas = and(eq(evidencias.conteoId, id), isNull(evidencias.anuladaEn));
      const [{ total }] = await tx.select({ total: count() }).from(evidencias).where(activas);
      if (total >= MAXIMO_EVIDENCIAS_ACTIVAS) {
        throw new Rechazo(409, { error: `El conteo ya tiene ${MAXIMO_EVIDENCIAS_ACTIVAS} evidencias activas. Anule una para agregar otra.` });
      }
      const [repetida] = await tx.select({ id: evidencias.id }).from(evidencias)
        .where(and(activas, eq(evidencias.sha256, procesada.sha256))).limit(1);
      if (repetida) {
        throw new Rechazo(409, { error: "Esta foto ya está registrada como evidencia del conteo", evidenciaId: repetida.id });
      }

      const [nueva] = await tx.insert(evidencias).values({
        conteoId: id,
        descripcion: descripcion || null,
        sha256: procesada.sha256,
        bytes: procesada.imagen.length,
        ancho: procesada.ancho,
        alto: procesada.alto,
        bytesMiniatura: procesada.miniatura.length,
        tomadaEn,
        subidoPor: usuario.id,
      }).returning();
      await tx.insert(evidenciasContenido).values({
        evidenciaId: nueva.id,
        imagen: procesada.imagen,
        miniatura: procesada.miniatura,
      });
      return nueva;
    });

    return NextResponse.json(creada, { status: 201 });
  } catch (err) {
    if (err instanceof Rechazo) {
      return NextResponse.json(err.cuerpo, { status: err.status });
    }
    console.error("[evidencias] Error al guardar la evidencia:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar la evidencia" }, { status: 503 });
  }
}
