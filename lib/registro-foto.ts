import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Comprobante del conteo por foto (fase 2). Solo servidor: usa crypto de Node.
 *
 * POST /api/contar-foto devuelve, junto al resultado, un comprobante firmado con
 * el total, la confianza, la huella SHA-256 de la foto recibida y el usuario.
 * Para registrar el lote, el navegador reenvía la MISMA foto con ese comprobante:
 * así el número de sacos lo decide el servidor (el navegador no puede cambiarlo)
 * y no hace falta volver a consultar el modelo.
 */

/** Tiempo para decidir si se registra el lote después de contar la foto. */
export const VIGENCIA_REGISTRO_MS = 30 * 60 * 1000;
const TOLERANCIA_RELOJ_MS = 60 * 1000;

export type DatosRegistroFoto = {
  sha256: string; // huella de la foto tal como se recibió (hex)
  total: number;
  confianzaPromedio: number | null; // %, 2 decimales
  usuarioId: number;
  emitidoEn: number; // ms desde 1970 (fecha del conteo)
};

export type VerificacionRegistro =
  | { valido: true; datos: DatosRegistroFoto }
  | { valido: false; motivo: "formato" | "firma" | "vencido" | "sin_clave" };

/** Clave propia para estos comprobantes, derivada de JWT_SECRET (no se reutiliza la del JWT tal cual). */
function clave(): Buffer | null {
  const secreto = process.env.JWT_SECRET;
  if (!secreto || secreto.length < 32) return null;
  return createHmac("sha256", secreto).update("macromec:contar-foto:registro:v1").digest();
}

export function huellaFoto(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Identificador del lote: el mismo para la misma foto, así no se registra dos veces. */
export function idExternoFoto(sha256: string): string {
  return `foto_${sha256.slice(0, 40)}`;
}

export function firmarRegistro(datos: DatosRegistroFoto): string | null {
  const k = clave();
  if (!k) return null;
  const carga = Buffer.from(JSON.stringify(datos)).toString("base64url");
  return `${carga}.${createHmac("sha256", k).update(carga).digest("base64url")}`;
}

function esDatos(d: unknown): d is DatosRegistroFoto {
  if (!d || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  return typeof x.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256)
    && Number.isSafeInteger(x.total) && (x.total as number) >= 0
    && (x.confianzaPromedio === null || (typeof x.confianzaPromedio === "number" && x.confianzaPromedio >= 0 && x.confianzaPromedio <= 100))
    && Number.isSafeInteger(x.usuarioId) && Number.isSafeInteger(x.emitidoEn);
}

export function verificarRegistro(comprobante: string, ahora = Date.now()): VerificacionRegistro {
  const k = clave();
  if (!k) return { valido: false, motivo: "sin_clave" };
  const partes = comprobante.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1] || comprobante.length > 2000) return { valido: false, motivo: "formato" };
  const [carga, firma] = partes;
  const esperada = createHmac("sha256", k).update(carga).digest();
  const recibida = Buffer.from(firma, "base64url");
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return { valido: false, motivo: "firma" };
  let datos: unknown;
  try {
    datos = JSON.parse(Buffer.from(carga, "base64url").toString("utf8"));
  } catch {
    return { valido: false, motivo: "formato" };
  }
  if (!esDatos(datos)) return { valido: false, motivo: "formato" };
  if (datos.emitidoEn > ahora + TOLERANCIA_RELOJ_MS || ahora - datos.emitidoEn > VIGENCIA_REGISTRO_MS) {
    return { valido: false, motivo: "vencido" };
  }
  return { valido: true, datos };
}
