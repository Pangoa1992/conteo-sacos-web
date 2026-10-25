import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { db } from "@/db";
import { conteos } from "@/db/schema";
import { desc } from "drizzle-orm";

/**
 * POST /api/whatsapp/webhook
 *
 * Twilio llama a esta URL cada vez que alguien le manda un mensaje de
 * WhatsApp al número del sandbox. Se responde en formato TwiML (XML),
 * que es lo que Twilio espera para saber qué contestar.
 *
 * Seguridad: se exige SIEMPRE una firma válida de Twilio
 * (X-Twilio-Signature) calculada con TWILIO_AUTH_TOKEN, para asegurarse
 * de que el mensaje viene de verdad de Twilio y no de cualquiera que
 * descubra esta URL. Si TWILIO_AUTH_TOKEN no está configurado, el
 * webhook queda deshabilitado (no responde datos de conteo).
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

  const mensajeRecibido = (params["Body"] || "").trim().toLowerCase();
  const respuesta = await construirRespuesta(mensajeRecibido);

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(respuesta);

  return new NextResponse(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

async function construirRespuesta(mensaje: string): Promise<string> {
  const preguntaPorConteo =
    mensaje.includes("saco") || mensaje.includes("conteo") || mensaje.includes("cuant");

  if (preguntaPorConteo) {
    if (!process.env.DATABASE_URL) {
      return "El sistema aún no está conectado a la base de datos real. (Modo de prueba)";
    }

    const [ultimo] = await db
      .select()
      .from(conteos)
      .orderBy(desc(conteos.creadoEn))
      .limit(1);

    if (!ultimo) {
      return "Todavía no hay ningún conteo registrado.";
    }

    const fecha = new Date(ultimo.creadoEn).toLocaleString("es-PE", {
      dateStyle: "short",
      timeStyle: "short",
    });

    return (
      `📦 Último conteo: *${ultimo.cantidadSacos} sacos*\n` +
      `🕐 Registrado: ${fecha}\n` +
      `✅ Confianza: ${ultimo.confianzaPromedio ?? "—"}%`
    );
  }

  return (
    "Hola 👋 Soy el asistente de Conteo de Sacos — MACROMEC.\n\n" +
    "Escribe *\"¿cuántos sacos van hoy?\"* para saber el último conteo registrado."
  );
}