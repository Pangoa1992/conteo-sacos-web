/**
 * Estado de la integración de WhatsApp para el panel del administrador
 * (etapa 5). Solo indicadores no sensibles: nunca el token, los números
 * (ni enmascarados), el dominio de la URL pública ni datos de la conexión.
 * Usa las mismas reglas que el webhook (lib/whatsapp.ts).
 */
import { contarEntradasNoValidas, leerNumerosAutorizados } from "./whatsapp";

export type EstadoUrlPublica = "https" | "no_https" | "no_configurada";

export type EstadoWhatsapp = {
  /** Hay TWILIO_AUTH_TOKEN: sin él el webhook responde 503. */
  webhookHabilitado: boolean;
  /** Tipo de TWILIO_WEBHOOK_URL (no su valor). */
  urlPublica: EstadoUrlPublica;
  numerosAutorizados: number;
  entradasNoValidas: number;
  /** null si no se pudo consultar la base de datos. */
  hayConteosReales: boolean | null;
  modoDemo: boolean;
};

/** Las únicas claves que devuelve GET /api/whatsapp/estado. */
export const CLAVES_ESTADO_WHATSAPP = [
  "webhookHabilitado", "urlPublica", "numerosAutorizados", "entradasNoValidas", "hayConteosReales", "modoDemo",
] as const satisfies readonly (keyof EstadoWhatsapp)[];

/** Parte del estado que sale de las variables de entorno. */
export function estadoConfiguracionWhatsapp(env: Record<string, string | undefined>): Pick<EstadoWhatsapp, "webhookHabilitado" | "urlPublica" | "numerosAutorizados" | "entradasNoValidas"> {
  return {
    webhookHabilitado: !!env.TWILIO_AUTH_TOKEN,
    urlPublica: tipoUrlPublica(env.TWILIO_WEBHOOK_URL),
    numerosAutorizados: leerNumerosAutorizados(env.WHATSAPP_NUMEROS_AUTORIZADOS).size,
    entradasNoValidas: contarEntradasNoValidas(env.WHATSAPP_NUMEROS_AUTORIZADOS),
  };
}

function tipoUrlPublica(valor: string | undefined): EstadoUrlPublica {
  if (!valor?.trim()) return "no_configurada";
  try {
    return new URL(valor.trim()).protocol === "https:" ? "https" : "no_https";
  } catch {
    return "no_https";
  }
}
