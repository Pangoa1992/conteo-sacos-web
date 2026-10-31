import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { responderComando } from "@/lib/consultas-whatsapp";
import { modoDemoWhatsappActivo } from "@/lib/modo-demo-whatsapp-servidor";
import {
  TEXTO_AYUDA,
  TEXTO_ERROR,
  TEXTO_NO_AUTORIZADO,
  TEXTO_SIN_LISTA,
  enmascararNumero,
  interpretarComando,
  leerNumerosAutorizados,
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

  const url = process.env.TWILIO_WEBHOOK_URL || req.nextUrl.toString();
  if (!twilio.validateRequest(authToken, firma, url, params)) {
    return new NextResponse("Firma inválida", { status: 403 });
  }

  const respuesta = await construirRespuesta(params["From"], params["Body"] || "");
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(limitarRespuesta(respuesta));

  return new NextResponse(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

async function construirRespuesta(remitente: string | undefined, mensaje: string): Promise<string> {
  const autorizados = leerNumerosAutorizados(process.env.WHATSAPP_NUMEROS_AUTORIZADOS);
  const numero = normalizarNumero(remitente);
  if (autorizados.size === 0) {
    console.warn(`[whatsapp] WHATSAPP_NUMEROS_AUTORIZADOS vacío o sin números válidos: consulta rechazada de ${enmascararNumero(remitente)}.`);
    return TEXTO_SIN_LISTA;
  }
  if (!numero || !autorizados.has(numero)) {
    console.warn(`[whatsapp] Número no autorizado: ${enmascararNumero(remitente)}.`);
    return TEXTO_NO_AUTORIZADO;
  }

  const comando = interpretarComando(mensaje);
  // Modo DEMO (solo con la BD local de demostración): lotes de prueba, siempre marcados.
  if (await modoDemoWhatsappActivo()) {
    try {
      return marcarDemo(await responderComando(comando, "demo"));
    } catch (err) {
      console.error(`[whatsapp] Error al responder «${comando.tipo}» (DEMO) a ${enmascararNumero(numero)}:`, err instanceof Error ? err.message : "error desconocido");
      return marcarDemo(TEXTO_ERROR);
    }
  }
  if (comando.tipo === "ayuda" || comando.tipo === "saludo") return TEXTO_AYUDA;
  if (!process.env.DATABASE_URL) {
    return "El sistema aún no está conectado a la base de datos real. (Modo de prueba)";
  }
  try {
    return await responderComando(comando);
  } catch (err) {
    // Sin el número completo ni el texto recibido en el registro.
    console.error(`[whatsapp] Error al responder «${comando.tipo}» a ${enmascararNumero(numero)}:`, err instanceof Error ? err.message : "error desconocido");
    return TEXTO_ERROR;
  }
}
