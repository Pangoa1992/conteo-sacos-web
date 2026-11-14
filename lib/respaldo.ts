/**
 * Módulo «Respaldo» (solo administrador): reglas sin base de datos, para poder
 * probarlas por separado. El respaldo es un ZIP con un CSV por tabla (se abre en
 * Excel), un manifiesto con la cantidad de registros y la huella SHA-256 de cada
 * archivo, y un LEEME con cómo restaurarlo. Ver lib/respaldo-servidor.ts.
 *
 * No incluye contraseñas (ni su hash) ni las fotos de evidencia: de las fotos se
 * guardan los metadatos y su huella. La copia completa de la base (con fotos) es
 * la automática del proveedor (Neon) o un volcado pg_dump que hace el técnico.
 */
import { createHash } from "crypto";

/** Tablas del respaldo, en orden, con las columnas que se exportan. */
export const TABLAS_RESPALDO = [
  {
    nombre: "conteos",
    descripcion: "Lotes contados (IA) y su validación por el personal",
    columnas: ["id", "cantidad_sacos", "origen", "fuente_camara", "confianza_promedio", "id_externo", "contado_en", "creado_en",
      "estado_validacion", "sacos_conformes", "sacos_observados", "sacos_defectuosos", "validado_por", "validado_en", "observacion_validacion"],
  },
  {
    nombre: "validaciones_conteo",
    descripcion: "Historial de revisiones de cada lote",
    columnas: ["id", "conteo_id", "estado_anterior", "estado", "sacos_conformes", "sacos_observados", "sacos_defectuosos", "observacion", "usuario_id", "creado_en"],
  },
  {
    nombre: "reportes_contratista",
    descripcion: "Cantidades reportadas por los contratistas",
    columnas: ["id", "conteo_id", "cantidad_reportada", "nombre_contratista", "creado_en"],
  },
  {
    nombre: "ventas_lote",
    descripcion: "Ventas de sacos conformes (incluye las anuladas)",
    columnas: ["id", "conteo_id", "cantidad_sacos", "precio_unitario", "importe", "comprador", "registrada_por", "registrada_en",
      "anulada_en", "anulada_por", "motivo_anulacion", "clave_idempotencia"],
  },
  {
    nombre: "ventas",
    descripcion: "Ventas históricas (anteriores al control de validación)",
    columnas: ["id", "conteo_id", "precio_por_saco", "total_venta", "confirmada", "creado_en"],
  },
  {
    nombre: "evidencias",
    descripcion: "Fotos de evidencia: solo metadatos y huella (las imágenes no se incluyen)",
    columnas: ["id", "conteo_id", "descripcion", "sha256", "bytes", "ancho", "alto", "tomada_en", "subido_por", "subido_en",
      "anulada_en", "anulada_por", "motivo_anulacion"],
  },
  {
    nombre: "usuarios",
    descripcion: "Cuentas del sistema (sin contraseñas)",
    columnas: ["id", "nombre", "correo", "rol", "activo", "creado_en"],
  },
] as const;

export type TablaRespaldo = (typeof TABLAS_RESPALDO)[number]["nombre"];

/** Columnas que NUNCA deben salir en un respaldo descargable. */
export const COLUMNAS_PROHIBIDAS = ["password_hash", "sesion_version", "intentos_fallidos", "bloqueado_hasta"];

/** «respaldo-macromec-2026-11-14_1530.zip» (hora de Lima). */
export function nombreArchivoRespaldo(fecha = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `respaldo-macromec-${v("year")}-${v("month")}-${v("day")}_${v("hour")}${v("minute")}.zip`;
}

/**
 * CSV fiel a la base (para poder restaurarlo con \copy): cada valor tal como lo
 * entrega PostgreSQL en texto, entre comillas; NULL = celda vacía sin comillas.
 * Con BOM UTF-8 y CRLF para que Excel lo abra con tildes.
 */
export function csvRespaldo(columnas: readonly string[], filas: (string | null)[][]): string {
  const celda = (v: string | null) => (v === null ? "" : `"${v.replace(/"/g, '""')}"`);
  return "﻿" + [columnas.join(","), ...filas.map((f) => f.map(celda).join(","))].join("\r\n") + "\r\n";
}

export const sha256 = (datos: Uint8Array | string) => createHash("sha256").update(datos).digest("hex");

export type Manifiesto = {
  sistema: string;
  generado: string; // ISO UTC
  generadoPor: string;
  archivos: { archivo: string; tabla: string; descripcion: string; registros: number; sha256: string }[];
  totalRegistros: number;
};

/** LEEME del ZIP: qué contiene y cómo restaurarlo. */
export function textoLeeme(m: Manifiesto): string {
  const filas = m.archivos.map((a) => `  ${a.archivo.padEnd(26)} ${String(a.registros).padStart(6)} registros  ${a.descripcion}`).join("\r\n");
  return [
    "RESPALDO DEL SISTEMA DE CONTEO DE SACOS - MACROMEC",
    "",
    `Generado: ${new Date(m.generado).toLocaleString("es-PE", { timeZone: "America/Lima" })} (hora de Lima)`,
    `Por: ${m.generadoPor}`,
    `Registros en total: ${m.totalRegistros}`,
    "",
    "Archivos (CSV en UTF-8, se abren con Excel):",
    filas,
    "",
    "manifiesto.json: cantidad de registros y huella SHA-256 de cada archivo, para",
    "comprobar que no se modificaron (por ejemplo con: certutil -hashfile archivo SHA256).",
    "",
    "NO incluye: contraseñas de los usuarios ni las imágenes de las evidencias (sí su",
    "huella SHA-256). La copia completa de la base de datos la hace el proveedor de la",
    "nube (Neon) automáticamente, o el técnico con pg_dump.",
    "",
    "RESTAURAR: lo hace el técnico, no el panel. Cada CSV corresponde a una tabla de",
    "PostgreSQL con las mismas columnas; se cargan en orden (usuarios, conteos,",
    "validaciones_conteo, reportes_contratista, ventas_lote, ventas, evidencias) con",
    "\\copy tabla (columnas) from 'archivo.csv' with (format csv, header true).",
    "Ver el manual del sistema.",
    "",
  ].join("\r\n");
}
