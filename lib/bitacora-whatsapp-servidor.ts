import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conteos, evidencias, evidenciasContenido, mensajesWhatsapp, mensajesWhatsappFoto, usuarios } from "@/db/schema";
import { mensajeErrorBD } from "./errores-bd";
import { FotoInvalida, procesarFoto } from "./evidencias-servidor";
import { huellaFoto } from "./registro-foto";
import { ORIGEN_WHATSAPP, ORIGEN_WHATSAPP_PRUEBA, FUENTE_WHATSAPP, type MensajeWhatsapp, type ResultadoMensaje } from "./bitacora-whatsapp";
import type { FotoContadaWhatsapp } from "./whatsapp-foto-servidor";

/**
 * Bitácora de WhatsApp (solo servidor). Responde a la pregunta «¿quién lo usa, qué pide
 * y adónde van los datos?»: cada mensaje del webhook se anota aquí (número enmascarado,
 * contacto, comando y resultado) y las fotos con sacos quedan en la bandeja del panel.
 * Anotar nunca debe impedir que se responda el WhatsApp: los errores solo se registran.
 */

export type NuevoMensaje = {
  remitente: string; // ya enmascarado
  contacto: string | null;
  tipo: string;
  resultado: ResultadoMensaje;
  demo: boolean;
  foto?: FotoContadaWhatsapp | null;
};

/** Anota el mensaje; devuelve su número o null si no se pudo (sin BD, tabla pendiente o error). */
export async function anotarMensaje(m: NuevoMensaje): Promise<number | null> {
  if (!process.env.DATABASE_URL) return null;
  // Solo se guardan fotos con sacos: una foto sin sacos no sirve como lote.
  const foto = m.foto && m.foto.total > 0 ? m.foto : null;
  try {
    return await db.transaction(async (tx) => {
      const [fila] = await tx.insert(mensajesWhatsapp).values({
        remitente: m.remitente.slice(0, 40),
        contacto: m.contacto?.slice(0, 60) ?? null,
        tipo: m.tipo.slice(0, 20),
        resultado: m.resultado,
        demo: m.demo,
        sacos: m.foto ? m.foto.total : null,
        confianzaPromedio: m.foto?.confianzaPromedio == null ? null : m.foto.confianzaPromedio.toFixed(2),
        fotoSha256: foto ? huellaFoto(foto.imagen) : null,
        fotoAncho: foto?.ancho ?? null,
        fotoAlto: foto?.alto ?? null,
      }).returning({ id: mensajesWhatsapp.id });
      if (foto) await tx.insert(mensajesWhatsappFoto).values({ mensajeId: fila.id, imagen: foto.imagen });
      return fila.id;
    });
  } catch (err) {
    console.error("[whatsapp] No se pudo anotar el mensaje en la bitácora:", mensajeErrorBD(err));
    return null;
  }
}

/** Últimos mensajes (sin imágenes). null si la tabla aún no existe (migración 0010 pendiente). */
export async function listarMensajes(limite = 100): Promise<MensajeWhatsapp[] | null> {
  try {
    const filas = await db
      .select({
        m: mensajesWhatsapp,
        revisadoPorNombre: usuarios.nombre,
        tieneFoto: sql<boolean>`exists (select 1 from mensajes_whatsapp_foto f where f.mensaje_id = ${mensajesWhatsapp.id})`,
      })
      .from(mensajesWhatsapp)
      .leftJoin(usuarios, eq(usuarios.id, mensajesWhatsapp.revisadoPor))
      .orderBy(desc(mensajesWhatsapp.id))
      .limit(limite);
    return filas.map(({ m, revisadoPorNombre, tieneFoto }) => ({
      id: m.id,
      recibidoEn: m.recibidoEn.toISOString(),
      remitente: m.remitente,
      contacto: m.contacto,
      tipo: m.tipo,
      resultado: m.resultado as ResultadoMensaje,
      demo: m.demo,
      sacos: m.sacos,
      confianzaPromedio: m.confianzaPromedio === null ? null : Number(m.confianzaPromedio),
      tieneFoto,
      conteoId: m.conteoId,
      descartada: m.descartada,
      revisadoPorNombre,
      revisadoEn: m.revisadoEn?.toISOString() ?? null,
    }));
  } catch (err) {
    console.error("[whatsapp] No se pudo leer la bitácora:", mensajeErrorBD(err));
    return null;
  }
}

export async function fotoDeMensaje(id: number): Promise<Buffer | null> {
  const [fila] = await db.select({ imagen: mensajesWhatsappFoto.imagen }).from(mensajesWhatsappFoto)
    .where(eq(mensajesWhatsappFoto.mensajeId, id)).limit(1);
  return fila?.imagen ?? null;
}

export type ResultadoRevision =
  | { status: 200 | 201; loteId: number | null; yaRevisado: boolean }
  | { status: 400 | 404 | 409; error: string };

/**
 * Registra la foto del mensaje como lote PENDIENTE de validación, con la foto como evidencia,
 * en una transacción con la fila del mensaje bloqueada (dos clics no crean dos lotes).
 * El total es el que contó la IA al recibir la foto; el navegador no lo envía.
 * Un mensaje del modo DEMO siempre se registra como dato de prueba.
 */
export async function registrarComoLote(id: number, tipo: "real" | "prueba", usuarioId: number): Promise<ResultadoRevision> {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(mensajesWhatsapp).where(eq(mensajesWhatsapp.id, id)).for("update").limit(1);
    if (!m) return { status: 404, error: "Mensaje no encontrado" };
    if (m.conteoId !== null) return { status: 200, loteId: m.conteoId, yaRevisado: true };
    if (m.descartada) return { status: 409, error: "Esta foto ya fue descartada" };
    if (!m.sacos || m.sacos <= 0) return { status: 400, error: "El mensaje no tiene una foto con sacos" };
    const [contenido] = await tx.select().from(mensajesWhatsappFoto).where(eq(mensajesWhatsappFoto.mensajeId, id)).limit(1);
    if (!contenido) return { status: 400, error: "El mensaje no tiene una foto guardada" };

    let procesada;
    try {
      procesada = await procesarFoto(contenido.imagen);
    } catch (err) {
      if (err instanceof FotoInvalida) return { status: 400, error: err.message };
      throw err;
    }
    const origen = m.demo || tipo === "prueba" ? ORIGEN_WHATSAPP_PRUEBA : ORIGEN_WHATSAPP;
    const [lote] = await tx.insert(conteos).values({
      cantidadSacos: m.sacos,
      origen,
      fuenteCamara: FUENTE_WHATSAPP,
      confianzaPromedio: m.confianzaPromedio,
      idExterno: `whatsapp_${m.id}`,
      contadoEn: m.recibidoEn,
    }).returning({ id: conteos.id });
    const [evidencia] = await tx.insert(evidencias).values({
      conteoId: lote.id,
      descripcion: `Foto recibida por WhatsApp (${m.contacto ?? m.remitente}, mensaje n.º ${m.id}): ${m.sacos} saco${m.sacos === 1 ? "" : "s"} detectado${m.sacos === 1 ? "" : "s"}.`.slice(0, 200),
      sha256: procesada.sha256,
      bytes: procesada.imagen.length,
      ancho: procesada.ancho,
      alto: procesada.alto,
      bytesMiniatura: procesada.miniatura.length,
      tomadaEn: null,
      subidoPor: usuarioId,
    }).returning({ id: evidencias.id });
    await tx.insert(evidenciasContenido).values({ evidenciaId: evidencia.id, imagen: procesada.imagen, miniatura: procesada.miniatura });
    await tx.update(mensajesWhatsapp)
      .set({ conteoId: lote.id, revisadoPor: usuarioId, revisadoEn: new Date() })
      .where(eq(mensajesWhatsapp.id, id));
    return { status: 201, loteId: lote.id, yaRevisado: false };
  });
}

/** Descarta la foto: queda en la bitácora (no se borra) pero sale de la bandeja. */
export async function descartarFoto(id: number, usuarioId: number): Promise<ResultadoRevision> {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(mensajesWhatsapp).where(eq(mensajesWhatsapp.id, id)).for("update").limit(1);
    if (!m) return { status: 404, error: "Mensaje no encontrado" };
    if (m.descartada) return { status: 200, loteId: null, yaRevisado: true };
    if (m.conteoId !== null) return { status: 409, error: `La foto ya se registró como lote #${m.conteoId}` };
    if (!m.fotoSha256) return { status: 400, error: "El mensaje no tiene una foto guardada" };
    await tx.update(mensajesWhatsapp)
      .set({ descartada: true, revisadoPor: usuarioId, revisadoEn: new Date() })
      .where(eq(mensajesWhatsapp.id, id));
    return { status: 200, loteId: null, yaRevisado: false };
  });
}
