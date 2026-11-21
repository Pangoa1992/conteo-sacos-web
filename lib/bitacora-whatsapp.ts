/**
 * Bitácora de WhatsApp: tipos y textos compartidos por el panel y el servidor
 * (ver lib/bitacora-whatsapp-servidor.ts).
 */

/** Lotes creados desde una foto de WhatsApp: real o de prueba (empieza por «prueba»). */
export const ORIGEN_WHATSAPP = "whatsapp";
export const ORIGEN_WHATSAPP_PRUEBA = "prueba_whatsapp";
/** Fuente que se muestra en Cámaras e Historial para estos lotes. */
export const FUENTE_WHATSAPP = "whatsapp_foto";

export type ResultadoMensaje = "respondido" | "rechazado" | "error";

export type MensajeWhatsapp = {
  id: number;
  recibidoEn: string;
  remitente: string; // enmascarado
  contacto: string | null;
  tipo: string;
  resultado: ResultadoMensaje;
  demo: boolean;
  sacos: number | null;
  confianzaPromedio: number | null;
  tieneFoto: boolean;
  conteoId: number | null;
  descartada: boolean;
  revisadoPorNombre: string | null;
  revisadoEn: string | null;
};

/** Qué pidió la persona, en palabras. */
export const ETIQUETA_TIPO_MENSAJE: Record<string, string> = {
  ultimo: "Último lote",
  hoy: "Producción de hoy",
  semana: "Últimos 7 días",
  mes: "Producción del mes",
  mes_invalido: "Mes mal escrito",
  discrepancias: "Discrepancias",
  lote: "Detalle de un lote",
  lote_invalido: "Lote mal escrito",
  ayuda: "Ayuda",
  saludo: "Saludo / texto libre",
  foto: "Foto de sacos",
  no_imagen: "Archivo que no es foto",
  no_autorizado: "Número no autorizado",
  sin_lista: "Servicio sin habilitar",
};

export const ETIQUETA_RESULTADO_MENSAJE: Record<ResultadoMensaje, string> = {
  respondido: "Respondido",
  rechazado: "Rechazado",
  error: "Error",
};

/** Estado de la foto en la bandeja del panel. */
export function estadoFoto(m: Pick<MensajeWhatsapp, "tieneFoto" | "conteoId" | "descartada">): "sin_foto" | "pendiente" | "registrada" | "descartada" {
  if (m.conteoId !== null) return "registrada";
  if (m.descartada) return "descartada";
  return m.tieneFoto ? "pendiente" : "sin_foto";
}
