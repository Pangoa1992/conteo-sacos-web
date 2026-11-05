import { createHash, createHmac, timingSafeEqual } from "crypto";
import {
  VIDEO_FOTOGRAMAS_MAXIMOS,
  VIDEO_SEGUNDOS_MAXIMOS,
  type CajaVideo,
  type FotogramaDetectado,
} from "./conteo-video";

/**
 * Firma del resultado de cada fotograma de «Contar por video». Solo servidor.
 *
 * POST /api/contar-video/fotograma devuelve, con las detecciones de RF-DETR, una firma
 * (HMAC) que ata esas cajas a la sesión de análisis, al número de fotograma, a la huella
 * de la imagen y al usuario. Para registrar el lote, el navegador reenvía las firmas y el
 * servidor vuelve a contar con las cajas firmadas: el total no lo decide el navegador y
 * no hace falta volver a consultar el modelo.
 */

/** Tiempo para terminar el análisis y decidir si se registra (desde el primer fotograma). */
export const VIGENCIA_VIDEO_MS = 60 * 60 * 1000;
const TOLERANCIA_RELOJ_MS = 60 * 1000;
const LONGITUD_MAXIMA_FIRMA = 4000;
const PATRON_SESION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DatosFotograma = {
  s: string; // sesión de análisis (UUID generado por el navegador)
  i: number; // índice del fotograma en la sesión
  t: number; // segundo del video
  w: number; // ancho analizado
  h: number; // alto analizado
  d: [number, number, number, number, number][]; // x1, y1, x2, y2, confianza
  u: number; // usuario
  e: number; // emitido en (ms)
  f: string; // SHA-256 del fotograma recibido (hex)
};

export type VerificacionVideo =
  | { valido: true; fotogramas: FotogramaDetectado[]; datos: DatosFotograma[] }
  | { valido: false; motivo: "formato" | "firma" | "vencido" | "sin_clave" | "secuencia" | "usuario" };

export function esSesionVideo(s: unknown): s is string {
  return typeof s === "string" && PATRON_SESION.test(s);
}

function clave(): Buffer | null {
  const secreto = process.env.JWT_SECRET;
  if (!secreto || secreto.length < 32) return null;
  return createHmac("sha256", secreto).update("macromec:contar-video:fotograma:v1").digest();
}

export function huellaFotograma(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Identificador del lote: el mismo para la misma sesión de análisis (no se duplica). */
export function idExternoVideo(sesion: string, usuarioId: number): string {
  return `video_${createHash("sha256").update(`${sesion}:${usuarioId}`).digest("hex").slice(0, 40)}`;
}

export function firmarFotograma(datos: DatosFotograma): string | null {
  const k = clave();
  if (!k) return null;
  const carga = Buffer.from(JSON.stringify(datos)).toString("base64url");
  return `${carga}.${createHmac("sha256", k).update(carga).digest("base64url")}`;
}

const entero = (n: unknown, min: number, max: number) => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const numero = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

function esDatos(x: unknown): x is DatosFotograma {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!esSesionVideo(o.s) || !entero(o.i, 0, VIDEO_FOTOGRAMAS_MAXIMOS - 1)) return false;
  if (!numero(o.t, 0, VIDEO_SEGUNDOS_MAXIMOS + 1) || !entero(o.w, 1, 1600) || !entero(o.h, 1, 1600)) return false;
  if (!entero(o.u, 1, Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(o.e)) return false;
  if (typeof o.f !== "string" || !/^[0-9a-f]{64}$/.test(o.f)) return false;
  if (!Array.isArray(o.d) || o.d.length > 300) return false;
  return o.d.every((c) => Array.isArray(c) && c.length === 5 && c.every((v) => typeof v === "number" && Number.isFinite(v)));
}

function decodificar(firma: string, k: Buffer): DatosFotograma | "formato" | "firma" {
  if (typeof firma !== "string" || firma.length > LONGITUD_MAXIMA_FIRMA) return "formato";
  const partes = firma.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return "formato";
  const esperada = createHmac("sha256", k).update(partes[0]).digest();
  const recibida = Buffer.from(partes[1], "base64url");
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return "firma";
  let datos: unknown;
  try {
    datos = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8"));
  } catch {
    return "formato";
  }
  return esDatos(datos) ? datos : "formato";
}

export const cajaDeDatos = ([x1, y1, x2, y2, confianza]: DatosFotograma["d"][number]): CajaVideo => ({ x1, y1, x2, y2, confianza });

/**
 * Verifica las firmas de una sesión completa: todas válidas, del mismo usuario y sesión,
 * con el mismo tamaño de imagen, sin fotogramas faltantes ni repetidos (0, 1, 2…), con el
 * tiempo creciente y dentro de la vigencia.
 */
export function verificarFotogramas(firmas: unknown, usuarioId: number, ahora = Date.now()): VerificacionVideo {
  const k = clave();
  if (!k) return { valido: false, motivo: "sin_clave" };
  if (!Array.isArray(firmas) || firmas.length === 0 || firmas.length > VIDEO_FOTOGRAMAS_MAXIMOS) {
    return { valido: false, motivo: "formato" };
  }
  const datos: DatosFotograma[] = [];
  for (const f of firmas) {
    const d = decodificar(f as string, k);
    if (d === "formato" || d === "firma") return { valido: false, motivo: d };
    datos.push(d);
  }
  const primero = datos[0];
  for (let n = 0; n < datos.length; n++) {
    const d = datos[n];
    if (d.u !== usuarioId) return { valido: false, motivo: "usuario" };
    if (d.s !== primero.s || d.i !== n || d.w !== primero.w || d.h !== primero.h) return { valido: false, motivo: "secuencia" };
    if (n > 0 && !(d.t > datos[n - 1].t)) return { valido: false, motivo: "secuencia" };
    if (d.e > ahora + TOLERANCIA_RELOJ_MS || ahora - d.e > VIGENCIA_VIDEO_MS) return { valido: false, motivo: "vencido" };
  }
  return {
    valido: true,
    datos,
    fotogramas: datos.map((d) => ({ indice: d.i, tiempo: d.t, ancho: d.w, alto: d.h, detecciones: d.d.map(cajaDeDatos) })),
  };
}
