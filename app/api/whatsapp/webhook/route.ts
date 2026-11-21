import { NextRequest, NextResponse } from "next/server";
import { mensajeErrorBD } from "@/lib/errores-bd";
import twilio from "twilio";
import { responderComando } from "@/lib/consultas-whatsapp";
import { modoDemoWhatsappActivo } from "@/lib/modo-demo-whatsapp-servidor";
import { analizarFotoWhatsapp, type FotoContadaWhatsapp } from "@/lib/whatsapp-foto-servidor";
import { TEXTO_FOTO_NO_IMAGEN, leerAdjuntos, textoResultadoFoto } from "@/lib/whatsapp-foto";
import { anotarMensaje } from "@/lib/bitacora-whatsapp-servidor";
import type { ResultadoMensaje } from "@/lib/bitacora-whatsapp";
import {
  TEXTO_AYUDA,
  TEXTO_ERROR,
  TEXTO_NO_AUTORIZADO,
  TEXTO_SIN_LISTA,
  enmascararNumero,
  interpretarComando,
  leerContactosAutorizados,
  limitarRespuesta,
  marcarDemo,
  normalizarNumero,
} from "@/lib/whatsapp";

/**
 * POST /api/whatsapp/webhook
 *
 * Twilio llama a esta URL cada vez que alguien le manda un mensaje de
 * WhatsApp al número del sandbox. Se responde en formato TwiML (XML),
 * que es lo que Twilio espera para saber qué contestar.
 *
 * Seguridad:
 *  - Se exige SIEMPRE una firma válida de Twilio (X-Twilio-Signature)
 *    calculada con TWILIO_AUTH_TOKEN, para asegurarse de que el mensaje viene
 *    de verdad de Twilio. Sin TWILIO_AUTH_TOKEN el webhook queda deshabilitado (503).
 *  - Solo reciben datos de producción los números de WHATSAPP_NUMEROS_AUTORIZADOS
 *    (formato +51XXXXXXXXX, separados por comas). Si la lista está vacía o sin
 *    configurar, nadie los recibe. Los números se registran enmascarados.
 *  - Solo datos reales (nunca de prueba), sin ventas ni inventario. Excepción:
 *    el modo DEMO (lib/modo-demo-whatsapp.ts), que solo se activa con la BD
 *    local de demostración y marca cada respuesta «DEMO · datos de prueba».
 *    No cambia la firma ni la lista de números autorizados.
 *
 * Comandos (sin importar mayúsculas ni tildes): ayuda, último, hoy, semana,
 * discrepancias, lote 123. Ver lib/whatsapp.ts y lib/consultas-whatsapp.ts.
 *
 * Foto: si el mensaje trae una imagen, se cuentan los sacos con el mismo modelo de
 * «Contar por foto» y se responde el total (lib/whatsapp-foto-servidor.ts). Mismas
 * reglas de firma y números autorizados. Si tiene sacos, la foto queda en la bandeja
 * del panel (WhatsApp → Fotos recibidas) y el personal decide si la registra como lote.
 *
 * Bitácora: cada mensaje con firma válida se anota en mensajes_whatsapp (número
 * enmascarado, contacto, comando y resultado; nunca el número completo ni el texto
 * libre). Si no se puede anotar, igual se responde.
 *
 * TWILIO_WEBHOOK_URL (opcional): URL pública exacta configurada en la
 * consola de Twilio. Usarla cuando la app corre detrás de un proxy
 * (Vercel, ngrok) y la URL que ve el servidor no coincide con la pública,
 * porque Twilio firma usando la URL pública.
 */
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[whatsapp] TWILIO_AUTH_TOKEN no configurado: webhook deshabilitado.");
    return new NextResponse("Servicio no disponible", { status: 503 });
  }

  const firma = req.headers.get("x-twilio-signature");
  if (!firma) {
    return new NextResponse("Firma inválida", { status: 403 });
  }

  const bodyForm = await req.formData().catch(() => null);
  if (!bodyForm) {
    return new NextResponse("Solicitud inválida", { status: 400 });
  }
  const params: Record<string, string> = {};
  bodyForm.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Twilio firma con la URL pública configurada en su consola. Se acepta la de TWILIO_WEBHOOK_URL y la que
  // llegó en la petición (Vercel la entrega con el host público): un espacio o una barra de más en la variable
  // ya no rompe la firma. Ambas son direcciones del propio servidor, así que no se debilita la verificación.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const candidatas = [process.env.TWILIO_WEBHOOK_URL?.trim(), host ? `${proto}://${host}${req.nextUrl.pathname}` : null, req.nextUrl.toString()]
    .filter((u): u is string => !!u);
  if (!candidatas.some((u) => twilio.validateRequest(authToken, firma, u, params))) {
    // Sin secretos ni números en el registro: solo la causa probable.
    console.warn(`[whatsapp] Firma de Twilio inválida para ${[...new Set(candidatas)].join(" | ")}: ` +
      "TWILIO_AUTH_TOKEN no corresponde a la cuenta de Twilio que envía el mensaje (Sandbox), o la URL configurada en Twilio es otra.");
    return new NextResponse("Firma inválida", { status: 403 });
  }

  const r = await construirRespuesta(params, authToken);
  let texto = r.texto;
  const bandeja = await anotarMensaje({
    remitente: enmascararNumero(params["From"]),
    contacto: r.contacto,
    tipo: r.tipo,
    resultado: r.resultado,
    demo: r.demo,
    foto: r.foto,
  });
  // Foto con sacos guardada: la respuesta avisa que quedó en el panel.
  if (r.foto && r.foto.total > 0 && bandeja !== null) {
    const t = textoResultadoFoto(r.foto, r.adjuntos, bandeja);
    texto = r.demo ? marcarDemo(t) : t;
  }
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(limitarRespuesta(texto));

  return new NextResponse(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

/** Respuesta y lo que se anota en la bitácora. */
type Respuesta = {
  texto: string;
  tipo: string;
  resultado: ResultadoMensaje;
  contacto: string | null;
  demo: boolean;
  foto: FotoContadaWhatsapp | null;
  adjuntos: number;
};

async function construirRespuesta(params: Record<string, string>, authToken: string): Promise<Respuesta> {
  const remitente = params["From"];
  const mensaje = params["Body"] || "";
  const contactos = leerContactosAutorizados(process.env.WHATSAPP_NUMEROS_AUTORIZADOS);
  const numero = normalizarNumero(remitente);
  const base = { contacto: null, demo: false, foto: null, adjuntos: 0 };
  if (contactos.size === 0) {
    console.warn(`[whatsapp] WHATSAPP_NUMEROS_AUTORIZADOS vacío o sin números válidos: consulta rechazada de ${enmascararNumero(remitente)}.`);
    return { ...base, texto: TEXTO_SIN_LISTA, tipo: "sin_lista", resultado: "rechazado" };
  }
  if (!numero || !contactos.has(numero)) {
    console.warn(`[whatsapp] Número no autorizado: ${enmascararNumero(remitente)}.`);
    return { ...base, texto: TEXTO_NO_AUTORIZADO, tipo: "no_autorizado", resultado: "rechazado" };
  }
  const contacto = contactos.get(numero) ?? null;
  const demo = await modoDemoWhatsappActivo();

  // Foto de sacos: se cuenta y se responde el total; el webhook la guarda en la bandeja.
  const adjuntos = leerAdjuntos(params);
  if (adjuntos.tipo === "imagen") {
    const a = await analizarFotoWhatsapp(adjuntos.adjunto, adjuntos.adjuntos, params["AccountSid"], authToken);
    return { texto: demo ? marcarDemo(a.texto) : a.texto, tipo: "foto", resultado: a.ok ? "respondido" : "error", contacto, demo, foto: a.foto, adjuntos: adjuntos.adjuntos };
  }
  if (adjuntos.tipo === "no_imagen") {
    return { ...base, contacto, demo, texto: TEXTO_FOTO_NO_IMAGEN, tipo: "no_imagen", resultado: "rechazado" };
  }

  const comando = interpretarComando(mensaje);
  const respuesta = (texto: string, resultado: ResultadoMensaje = "respondido"): Respuesta =>
    ({ ...base, contacto, demo, texto, tipo: comando.tipo, resultado });
  // Modo DEMO (solo con la BD local de demostración): lotes de prueba, siempre marcados.
  if (demo) {
    try {
      return respuesta(marcarDemo(await responderComando(comando, "demo")));
    } catch (err) {
      console.error(`[whatsapp] Error al responder «${comando.tipo}» (DEMO) a ${enmascararNumero(numero)}:`, mensajeErrorBD(err));
      return respuesta(marcarDemo(TEXTO_ERROR), "error");
    }
  }
  if (comando.tipo === "ayuda" || comando.tipo === "saludo") return respuesta(TEXTO_AYUDA);
  if (!process.env.DATABASE_URL) {
    return respuesta("El sistema aún no está conectado a la base de datos real. (Modo de prueba)", "error");
  }
  try {
    return respuesta(await responderComando(comando));
  } catch (err) {
    // Sin el número completo ni el texto recibido en el registro.
    console.error(`[whatsapp] Error al responder «${comando.tipo}» a ${enmascararNumero(numero)}:`, mensajeErrorBD(err));
    return respuesta(TEXTO_ERROR, "error");
  }
}
