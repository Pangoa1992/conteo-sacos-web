import type { DeteccionFoto, ResultadoConteoFoto } from "./conteo-foto";

// Solo servidor: la clave de Roboflow (ROBOFLOW_API_KEY) nunca sale de este módulo.
// Mismo modelo y parámetros que el detector Python (contador-sacos/config.py y
// contador_sacos_yolo.py): RF-DETR, confianza mínima 0.50 y solo la clase «Saco».
// Sin el filtro de altura mínima del video (VIDEO_ALTO_MIN_FRACCION), que tampoco
// aplica el conteo de fotos del detector.
export const ROBOFLOW_MODEL_ID = "willy-urzch/carrot-sack-counter-1-rfdetr-small-t1";
export const ROBOFLOW_CONFIANZA = 0.5;
export const ROBOFLOW_CLASE_OBJETIVO = "Saco";
const ROBOFLOW_API_URL_POR_DEFECTO = "https://serverless.roboflow.com";
const TIEMPO_MAXIMO_MS = 30_000;
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** El servicio de detección no está configurado o no respondió bien; status = el de nuestra API. */
export class DeteccionNoDisponible extends Error {
  constructor(mensaje: string, public status: number) {
    super(mensaje);
  }
}

function claveRoboflow(): string | null {
  return process.env.ROBOFLOW_API_KEY?.trim() || null;
}

/**
 * URL base del servicio. ROBOFLOW_API_URL solo existe para las pruebas con un
 * servidor simulado: exige https, salvo en este mismo equipo (como api_cliente.py).
 */
function urlRoboflow(): string | null {
  const texto = process.env.ROBOFLOW_API_URL?.trim() || ROBOFLOW_API_URL_POR_DEFECTO;
  try {
    const url = new URL(texto);
    if (url.protocol === "https:" || (url.protocol === "http:" && HOSTS_LOCALES.has(url.hostname))) {
      return texto.replace(/\/+$/, "");
    }
  } catch {
    // URL mal escrita: se trata como no configurada.
  }
  return null;
}

/** Indica si el conteo por foto puede usarse en este servidor (sin revelar la clave). */
export function conteoFotoConfigurado(): boolean {
  return claveRoboflow() !== null && urlRoboflow() !== null;
}

const redondear = (n: number, decimales: number) => Number(n.toFixed(decimales));
const limitar = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/**
 * Envía la foto (JPEG ya validado) a RF-DETR igual que inference_sdk con
 * api_key_transport="header": cuerpo en base64, clave en «Authorization: Bearer»
 * (nunca en la URL) y sin reducir la imagen, así las cajas vuelven en sus píxeles.
 */
export async function detectarSacos(imagen: Buffer, ancho: number, alto: number): Promise<ResultadoConteoFoto> {
  const clave = claveRoboflow();
  const base = urlRoboflow();
  if (!clave || !base) {
    throw new DeteccionNoDisponible("El conteo por foto no está configurado en el servidor (falta la clave del servicio de detección).", 503);
  }

  let res: Response;
  try {
    res = await fetch(`${base}/${ROBOFLOW_MODEL_ID}?confidence=${ROBOFLOW_CONFIANZA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: imagen.toString("base64"),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch {
    throw new DeteccionNoDisponible("No se pudo conectar con el servicio de detección (sin internet o sin respuesta). Intente nuevamente.", 503);
  }

  if (!res.ok) {
    // El cuerpo de la respuesta no se reenvía ni se registra: podría incluir datos de la cuenta.
    console.error(`[contar-foto] El servicio de detección respondió HTTP ${res.status}`);
    const mensaje =
      res.status === 401 || res.status === 403 ? "El servicio de detección rechazó la clave configurada en el servidor."
      : res.status === 429 ? "Se alcanzó el límite de consultas del servicio de detección. Intente en unos minutos."
      : "El servicio de detección no está disponible en este momento. Intente nuevamente.";
    throw new DeteccionNoDisponible(mensaje, 502);
  }

  const datos = await res.json().catch(() => null);
  if (!datos || !Array.isArray(datos.predictions)) {
    throw new DeteccionNoDisponible("El servicio de detección devolvió una respuesta inesperada.", 502);
  }

  const detecciones: DeteccionFoto[] = [];
  for (const p of datos.predictions as Record<string, unknown>[]) {
    const { x, y, width, height, confidence } = p;
    if (p.class !== ROBOFLOW_CLASE_OBJETIVO) continue;
    if (![x, y, width, height, confidence].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    const [cx, cy, w, h, conf] = [x, y, width, height, confidence] as number[];
    if (conf < ROBOFLOW_CONFIANZA) continue; // el servicio ya filtra; se asegura igual
    detecciones.push({
      x1: redondear(limitar(cx - w / 2, ancho), 1),
      y1: redondear(limitar(cy - h / 2, alto), 1),
      x2: redondear(limitar(cx + w / 2, ancho), 1),
      y2: redondear(limitar(cy + h / 2, alto), 1),
      confianza: redondear(conf, 4),
    });
  }

  const confianzas = detecciones.map((d) => d.confianza);
  return {
    total: detecciones.length,
    // Igual que api_cliente.confianza_promedio_contados: % con 2 decimales.
    confianzaPromedio: confianzas.length
      ? redondear((confianzas.reduce((a, b) => a + b, 0) / confianzas.length) * 100, 2)
      : null,
    confianzaMinima: confianzas.length ? Math.min(...confianzas) : null,
    confianzaMaxima: confianzas.length ? Math.max(...confianzas) : null,
    detecciones,
    ancho,
    alto,
    modelo: ROBOFLOW_MODEL_ID,
    umbralConfianza: ROBOFLOW_CONFIANZA,
  };
}
