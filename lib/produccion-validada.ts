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
