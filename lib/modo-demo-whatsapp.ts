/**
 * Modo DEMO de las consultas por WhatsApp (etapa 5): reglas sin acceso a la
 * base de datos, para poder probarlas por separado. La confirmación en la BD
 * está en lib/modo-demo-whatsapp-servidor.ts.
 *
 * En modo DEMO las respuestas informan los lotes de PRUEBA de la BD de
 * demostración, siempre marcados «DEMO · datos de prueba». Solo se activa si
 * se cumplen A LA VEZ todas las condiciones; si falta cualquiera, WhatsApp
 * responde como siempre (solo datos reales):
 *   1. MACROMEC_DEMO_WHATSAPP con el valor exacto (no "1" ni "true"). Solo lo
 *      pone iniciar_servidor_demo.sh --whatsapp-demo; nunca va en .env.local,
 *      .env.example ni Vercel.
 *   2. Fuera de Vercel.
 *   3. DATABASE_URL apunta a conteo_sacos_demo en este equipo, sin parámetros.
 *   4. La propia BD es conteo_sacos_demo y está marcada como demostración.
 *   5. La BD no tiene ningún lote real.
 */
export const VARIABLE_DEMO_WHATSAPP = "MACROMEC_DEMO_WHATSAPP";
export const VALOR_DEMO_WHATSAPP = "solo_demo_local_conteo_sacos_demo";
export const BD_DEMO = "conteo_sacos_demo";
export const COMENTARIO_BD_DEMO = "SOLO DATOS DE DEMOSTRACION";

export type MotivoRechazoDemo = "sin_variable" | "variable" | "vercel" | "url";

/**
 * Condiciones 1-3 (solo variables de entorno). null si se cumplen todas;
 * si no, el motivo del rechazo ("sin_variable" = el modo no se pidió).
 */
export function motivoRechazoEntornoDemo(env: Record<string, string | undefined>): MotivoRechazoDemo | null {
  const valor = env[VARIABLE_DEMO_WHATSAPP];
  if (valor === undefined) return "sin_variable";
  if (valor !== VALOR_DEMO_WHATSAPP) return "variable";
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return "vercel";
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    // Sin parámetros: en la cadena de conexión podrían cambiar el host o la BD reales.
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash) return "url";
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/" + BD_DEMO) return "url";
  } catch {
    return "url";
  }
  return null;
}

/** Condiciones 4-5, con lo que responde la propia BD. */
export function bdConfirmaDemo(f: { bd: string | null; comentario: string | null; reales: number | null } | undefined): boolean {
  return !!f && f.bd === BD_DEMO && (f.comentario ?? "").startsWith(COMENTARIO_BD_DEMO) && f.reales === 0;
}
