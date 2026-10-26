/**
 * Reglas de las ventas parciales (etapa 3B, ampliación del prototipo),
 * compartidas por servidor y cliente. Las mismas reglas están en PostgreSQL
 * (CHECK y triggers de la migración 0005).
 *
 * Solo se venden sacos CONFORMES de lotes APROBADOS. El stock no se guarda:
 * disponible = conformes − ventas activas del lote. Anular una venta la deja
 * fuera de esa suma, así los sacos vuelven al stock sin duplicarse.
 */

export const LONGITUD_MAXIMA_COMPRADOR = 150;
export const LONGITUD_MAXIMA_MOTIVO_ANULACION = 300;
// Máximos representables: precio_unitario numeric(10,2) e importe numeric(12,2).
export const PRECIO_MAXIMO = 99_999_999.99;
export const IMPORTE_MAXIMO_CENTIMOS = 999_999_999_999;

/** Precio con 2 decimales como máximo, convertido a céntimos enteros; null si no es válido. */
export function precioEnCentimos(precio: number): number | null {
  if (!Number.isFinite(precio) || precio <= 0 || precio > PRECIO_MAXIMO) return null;
  const centimos = Math.round(precio * 100);
  return Math.abs(precio * 100 - centimos) < 1e-6 ? centimos : null;
}

/** "1234.50" a partir de céntimos enteros (sin errores de coma flotante). */
export function centimosATexto(centimos: number): string {
  return `${Math.floor(centimos / 100)}.${String(centimos % 100).padStart(2, "0")}`;
}

/**
 * Importe = cantidad × precio, calculado en céntimos enteros. Devuelve el
 * texto para numeric(12,2) o null si excede el máximo.
 */
export function calcularImporte(cantidadSacos: number, precioCentimos: number): string | null {
  const importe = cantidadSacos * precioCentimos;
  return Number.isSafeInteger(importe) && importe <= IMPORTE_MAXIMO_CENTIMOS ? centimosATexto(importe) : null;
}

/**
 * Error si una nueva validación dejaría ventas activas sin respaldo: el lote
 * debe seguir aprobado y con al menos tantos conformes como sacos vendidos.
 */
export function errorValidacionConVentas(vendidos: number, estado: string, conformes: number | null): string | null {
  if (vendidos <= 0) return null;
  if (estado !== "aprobado" || conformes === null) {
    return `El lote tiene ${vendidos} saco${vendidos === 1 ? "" : "s"} vendido${vendidos === 1 ? "" : "s"} en ventas activas: solo puede seguir aprobado. Anule esas ventas antes de observarlo o rechazarlo.`;
  }
  if (conformes < vendidos) {
    return `El lote tiene ${vendidos} sacos vendidos en ventas activas: los conformes no pueden ser menos de ${vendidos}. Anule ventas antes de reducirlos.`;
  }
  return null;
}

/**
 * Clave de idempotencia (UUID v4) para una operación de venta. Se reutiliza en
 * los reintentos de la misma operación. crypto.randomUUID solo existe en
 * contextos seguros (https o localhost); al abrir la web por la IP de la red
 * local desde un celular se usa crypto.getRandomValues, disponible siempre.
 */
export function nuevaClaveIdempotencia(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Los mensajes de los triggers de ventas empiezan por "venta:" (migración 0005). */
export function esRechazoDeVentaEnBD(err: unknown): string | null {
  const mensaje = err instanceof Error ? err.message : "";
  const m = mensaje.match(/venta: (.*)$/);
  return m ? m[1] : null;
}
