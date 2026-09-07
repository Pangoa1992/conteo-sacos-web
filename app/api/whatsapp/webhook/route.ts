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
 * Seguridad: se valida la firma de Twilio (X-Twilio-Signature) usando
 * el TWILIO_AUTH_TOKEN, para asegurarse de que el mensaje viene de
 * verdad de Twilio y no de cualquiera que descubra esta URL.
 */
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const bodyForm = await req.formData();
  const params: Record<string, string> = {};
  bodyForm.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Validar que el mensaje viene realmente de Twilio (si hay token configurado).
  if (authToken) {
    const firma = req.headers.get("x-twilio-signature") || "";
    const url = req.nextUrl.toString();
    const esValido = twilio.validateRequest(authToken, firma, url, params);
    if (!esValido) {
      return new NextResponse("Firma inválida", { status: 403 });
    }
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