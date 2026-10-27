/**
 * Regla ÚNICA del reporte vigente de un lote (solo servidor). La usan el
 * historial del panel (GET /api/conteo), la validación de un lote
 * (PATCH /api/conteo/:id/validacion), el módulo de contratistas, sus
 * resúmenes y su CSV (GET /api/reportes-contratista).
 *
 * Vigente = el de fecha de registro (creado_en) más reciente; si dos reportes
 * tienen la misma fecha, el de id mayor. Es determinista: un reporte con una
 * fecha anterior a otro nunca pasa a ser vigente aunque se haya insertado
 * después (id mayor).
 */
import { desc, sql, type SQL } from "drizzle-orm";
import { reportesContratista } from "@/db/schema";

/** Orden de vigencia para consultas de drizzle: el primero es el vigente. */
export const ORDEN_VIGENCIA_REPORTE = [desc(reportesContratista.creadoEn), desc(reportesContratista.id)] as const;

/** Mismo orden para SQL escrito a mano, sobre el alias de reportes_contratista indicado. */
export function ordenVigenciaReporteSql(alias: string): SQL {
  const a = sql.raw(`"${alias}"`);
  return sql`${a}.creado_en desc, ${a}.id desc`;
}
