/**
 * Producción validada (ampliación del prototipo, etapa 3A).
 *
 * El total detectado por la IA (conteos.cantidad_sacos) nunca se modifica:
 * se reparte según el estado de validación del lote. Solo los lotes
 * APROBADOS cuentan como producción validada, y solo de ellos se suma la
 * clasificación manual (conformes / observados / defectuosos), que por la
 * restricción CHECK de la migración 0003 suma exactamente su total.
 * Lo mismo en servidor y cliente; nada se estima.
 */
import { ESTADOS_VALIDACION, type EstadoValidacion } from "./conteos";

/** Fila agregada por PostgreSQL: un grupo (prueba/real, estado). */
export type FilaValidacion = {
  esPrueba: boolean;
  estado: EstadoValidacion;
  registros: number;
  totalSacos: number;
  // Solo de lotes aprobados (0 en los demás estados).
  sacosConformes: number;
  sacosObservados: number;
  sacosDefectuosos: number;
};

export type ResumenValidacion = {
  detectado: { registros: number; sacos: number };
  porEstado: Record<EstadoValidacion, { registros: number; sacos: number }>;
  clasificacionAprobados: { conformes: number; observados: number; defectuosos: number };
};

export function resumirValidacion(filas: FilaValidacion[], incluir: (esPrueba: boolean) => boolean): ResumenValidacion {
  const porEstado = Object.fromEntries(ESTADOS_VALIDACION.map((e) => [e, { registros: 0, sacos: 0 }])) as ResumenValidacion["porEstado"];
  const clasificacionAprobados = { conformes: 0, observados: 0, defectuosos: 0 };
  const detectado = { registros: 0, sacos: 0 };

  for (const f of filas) {
    if (!incluir(f.esPrueba) || !porEstado[f.estado]) continue;
    porEstado[f.estado].registros += f.registros;
    porEstado[f.estado].sacos += f.totalSacos;
    detectado.registros += f.registros;
    detectado.sacos += f.totalSacos;
    if (f.estado === "aprobado") {
      clasificacionAprobados.conformes += f.sacosConformes;
      clasificacionAprobados.observados += f.sacosObservados;
      clasificacionAprobados.defectuosos += f.sacosDefectuosos;
    }
  }
  return { detectado, porEstado, clasificacionAprobados };
}

/** Porcentaje de parte sobre total; null si no hay total (no se muestra "0 %" engañoso). */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? (parte / total) * 100 : null;
}

// ---- Consulta por mes (observación de la entrega del 20/11/2026) ----

/** Fila agregada por PostgreSQL por mes (AAAA-MM, hora de la planta). */
export type FilaValidacionMensual = FilaValidacion & { mes: string };

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** true si el texto es un mes AAAA-MM válido. */
export function esMesValido(mes: string | null | undefined): mes is string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes ?? "");
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2000;
}

/** «2026-10» → «octubre 2026». */
export function etiquetaMes(mes: string): string {
  if (!esMesValido(mes)) return mes;
  const [a, m] = mes.split("-");
  return `${NOMBRES_MES[Number(m) - 1]} ${a}`;
}

/** Primer y último día (AAAA-MM-DD) de un mes AAAA-MM, para los filtros Desde / Hasta. */
export function rangoMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/**
 * Meses que se pueden elegir: el mes actual y todos los que tienen lotes en la vista,
 * del más reciente al más antiguo y sin repetir.
 */
export function mesesDisponibles(filas: FilaValidacionMensual[], hoy: string | null, incluir: (esPrueba: boolean) => boolean): string[] {
  const meses = new Set<string>();
  if (hoy) meses.add(hoy.slice(0, 7));
  for (const f of filas) if (incluir(f.esPrueba) && esMesValido(f.mes)) meses.add(f.mes);
  return [...meses].sort().reverse();
}

export type ResumenMes = ResumenValidacion & { mes: string };

/** Resumen de producción validada de cada mes con lotes (del más reciente al más antiguo). */
export function resumirPorMes(filas: FilaValidacionMensual[], incluir: (esPrueba: boolean) => boolean): ResumenMes[] {
  const porMes = new Map<string, FilaValidacion[]>();
  for (const f of filas) {
    if (!incluir(f.esPrueba)) continue;
    porMes.set(f.mes, [...(porMes.get(f.mes) ?? []), f]);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([mes, fs]) => ({ mes, ...resumirValidacion(fs, incluir) }));
}
