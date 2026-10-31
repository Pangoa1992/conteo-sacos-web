/**
 * Confirmación del modo DEMO de WhatsApp en la base de datos (ver
 * lib/modo-demo-whatsapp.ts). Se consulta en cada mensaje, sin caché: si
 * aparece un lote real, el modo DEMO deja de activarse en el siguiente.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bdConfirmaDemo, motivoRechazoEntornoDemo } from "./modo-demo-whatsapp";

// Cada motivo de rechazo se avisa una sola vez por proceso (sin URL ni secretos).
const avisados = new Set<string>();
function avisar(motivo: string) {
  if (avisados.has(motivo)) return;
  avisados.add(motivo);
  console.warn(`[whatsapp] Modo DEMO solicitado pero rechazado (${motivo}): se responden solo datos reales.`);
}

/** true solo si se cumplen las 5 condiciones del modo DEMO. */
export async function modoDemoWhatsappActivo(): Promise<boolean> {
  const motivo = motivoRechazoEntornoDemo(process.env);
  if (motivo === "sin_variable") return false;
  if (motivo) {
    avisar(motivo);
    return false;
  }
  try {
    const [fila] = await db.execute<{ bd: string; comentario: string | null; reales: number }>(sql`
      select current_database() as bd,
        shobj_description((select oid from pg_database where datname = current_database()), 'pg_database') as comentario,
        (select count(*)::int from conteos where lower(origen) not like 'prueba%') as reales`);
    if (bdConfirmaDemo(fila)) return true;
    avisar("la base de datos no es la de demostración o tiene lotes reales");
    return false;
  } catch {
    avisar("no se pudo confirmar la base de datos");
    return false;
  }
}
