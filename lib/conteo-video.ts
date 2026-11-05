// Contar sacos en un video desde el panel. Código compartido por el navegador
// (muestra el avance) y el servidor (vuelve a calcular el total al registrar).
//
// Replica la lógica de conteo del detector Python (contador_sacos_video.py con la
// configuración de config.py): una inferencia RF-DETR cada 5 fotogramas, se ignoran
// las detecciones más bajas que el 14 % del alto del video, cada saco se sigue con un
// identificador y se cuenta una sola vez cuando su centro cruza la línea vertical en la
// dirección configurada. El cruce se mide solo con cajas detectadas (nunca con la
// predicción) y un saco que cruza siendo tentativo se cuenta cuando se confirma. Además,
// un saco que vuelve a cruzar después de cruzar en sentido contrario no se cuenta de nuevo.
//
// Diferencia con el detector: DeepSORT usa además un descriptor de apariencia. Aquí, como
// los sacos de una toma se desplazan juntos (movimiento de la cámara o de la faja), en cada
// inferencia se estima primero el desplazamiento común que mejor alinea las cajas anteriores
// con las nuevas; luego cada saco se empareja por superposición (IoU) con su caja desplazada
// y, si no alcanza, por la distancia entre centros. No necesita bibliotecas.

/** Origen de los lotes registrados desde un video del panel (real o de prueba). */
export const ORIGEN_VIDEO = "video";
export const ORIGEN_VIDEO_PRUEBA = "prueba_video";
/** Fuente que se muestra en Cámaras e Historial para estos lotes. */
export const FUENTE_VIDEO = "video_panel";

/** Una inferencia cada 5 fotogramas a 30 fps (VIDEO_INFERENCE_INTERVAL = 5). */
export const VIDEO_PASO_SEGUNDOS = 5 / 30;
/** Tramo máximo que se analiza por video: 120 s = 721 inferencias como máximo (cada una es una consulta al modelo). */
export const VIDEO_SEGUNDOS_MAXIMOS = 120;
export const VIDEO_FOTOGRAMAS_MAXIMOS = Math.floor(VIDEO_SEGUNDOS_MAXIMOS / VIDEO_PASO_SEGUNDOS) + 1;
/** Mismos valores que config.py del detector. */
export const VIDEO_ALTO_MIN_FRACCION = 0.14;
export const VIDEO_N_INIT = 3;
export const VIDEO_MAX_AGE = 30;
export const VIDEO_LINEA_X_POR_DEFECTO = 0.5;
export const VIDEO_LINEA_X_MIN = 0.1;
export const VIDEO_LINEA_X_MAX = 0.9;

const IOU_MINIMO = 0.3;
/** Distancia máxima entre centros, en altos de la caja, para emparejar o para alinear. */
const DISTANCIA_MAXIMA_ALTOS = 0.35;
/** Penalidad por cambiar el desplazamiento común, por cada alto de caja de diferencia. */
const PENALIDAD_CAMBIO = 2;

export type DireccionConteo = "derecha_a_izquierda" | "izquierda_a_derecha";
export const DIRECCIONES: readonly DireccionConteo[] = ["derecha_a_izquierda", "izquierda_a_derecha"];

export type ParametrosConteoVideo = {
  lineaX: number; // posición de la línea: 0 = borde izquierdo, 1 = borde derecho
  direccion: DireccionConteo;
};

/** Caja de un saco detectado, en píxeles del fotograma analizado. */
export type CajaVideo = { x1: number; y1: number; x2: number; y2: number; confianza: number };

/** Resultado de una inferencia sobre un fotograma. */
export type FotogramaDetectado = {
  indice: number; // 0, 1, 2… en el orden en que se analizaron
  tiempo: number; // segundo del video
  ancho: number;
  alto: number;
  detecciones: CajaVideo[];
};

export type PistaVisible = {
  id: number;
  caja: CajaVideo;
  confirmada: boolean;
  contada: boolean;
  detectadaAhora: boolean;
};

export type SacoContado = { id: number; indice: number; tiempo: number; confianza: number | null };

export type PasoConteo = { pistas: PistaVisible[]; nuevos: SacoContado[]; total: number };

export type ResultadoConteoVideo = {
  total: number;
  contados: SacoContado[];
  confianzaPromedio: number | null; // %, 2 decimales, de los sacos contados
  fotogramas: number;
  duracionAnalizada: number; // segundos
};

type Pista = {
  id: number;
  caja: CajaVideo; // última caja detectada
  prevista: Omit<CajaVideo, "confianza">; // la caja movida con el desplazamiento común
  hits: number;
  sinDeteccion: number; // inferencias seguidas sin detección
  confirmada: boolean;
  contada: boolean;
  centroXAnterior: number | null;
  crucePendiente: number | null | false; // confianza del cruce mientras era tentativa
  retrocesos: number; // cruces en sentido contrario aún no compensados
  detectadaAhora: boolean;
};

const centroX = (c: { x1: number; x2: number }) => (c.x1 + c.x2) / 2;
const centroY = (c: { y1: number; y2: number }) => (c.y1 + c.y2) / 2;

function iou(a: Omit<CajaVideo, "confianza">, b: Omit<CajaVideo, "confianza">): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/** Valida y normaliza los parámetros elegidos en el panel (también en el servidor). */
export function parametrosValidos(p: unknown): ParametrosConteoVideo | null {
  if (!p || typeof p !== "object") return null;
  const { lineaX, direccion } = p as Record<string, unknown>;
  if (typeof lineaX !== "number" || !Number.isFinite(lineaX) || lineaX < VIDEO_LINEA_X_MIN || lineaX > VIDEO_LINEA_X_MAX) return null;
  if (!DIRECCIONES.includes(direccion as DireccionConteo)) return null;
  return { lineaX: Number(lineaX.toFixed(3)), direccion: direccion as DireccionConteo };
}

/** Filtro del detector: solo detecciones de al menos el 14 % del alto (sacos del fondo fuera). */
export function deteccionesUtiles(f: FotogramaDetectado): CajaVideo[] {
  const altoMin = VIDEO_ALTO_MIN_FRACCION * f.alto;
  return f.detecciones.filter((d) => d.y2 - d.y1 >= altoMin);
}

/**
 * Sigue los sacos inferencia por inferencia y cuenta los cruces de la línea.
 * Hay que llamar a «paso» con los fotogramas en orden.
 */
export class SeguidorSacos {
  private pistas: Pista[] = [];
  private siguienteId = 1;
  private dx = 0; // último desplazamiento común (píxeles por inferencia)
  private dy = 0;
  readonly contados: SacoContado[] = [];

  constructor(private readonly params: ParametrosConteoVideo) {}

  get total() {
    return this.contados.length;
  }

  /**
   * Prueba como desplazamiento cada diferencia entre una caja reciente y una detección
   * (y el anterior y el nulo) y se queda con el que alinea más cajas; a igualdad, el más
   * parecido al anterior.
   */
  private desplazamientoComun(dets: CajaVideo[]): [number, number] {
    // Solo las pistas detectadas en la inferencia anterior (su caja es una detección real).
    const recientes = this.pistas.filter((p) => p.detectadaAhora);
    // Sin con qué comparar, se mantiene el último movimiento (como la predicción de DeepSORT).
    if (!recientes.length || !dets.length) return [this.dx, this.dy];
    const opciones: [number, number][] = [[this.dx, this.dy], [0, 0]];
    for (const p of recientes) for (const d of dets) opciones.push([centroX(d) - centroX(p.caja), centroY(d) - centroY(p.caja)]);
    const altoMedio = recientes.reduce((a, p) => a + (p.caja.y2 - p.caja.y1), 0) / recientes.length;
    let mejor: [number, number] = [0, 0];
    let mejorPuntaje = -Infinity;
    let mejorCambio = Infinity;
    for (const [dx, dy] of opciones) {
      let puntaje = 0;
      for (const p of recientes) {
        const altoRef = p.caja.y2 - p.caja.y1;
        let mas = 0;
        for (const d of dets) {
          const dist = Math.hypot(centroX(p.caja) + dx - centroX(d), centroY(p.caja) + dy - centroY(d));
          if (dist <= DISTANCIA_MAXIMA_ALTOS * altoRef) mas = Math.max(mas, 1 - dist / (DISTANCIA_MAXIMA_ALTOS * altoRef));
        }
        puntaje += mas;
      }
      // Los sacos de una fila son casi iguales: desplazarse hasta el saco vecino alinea casi tan
      // bien como el movimiento real. Como la cámara o la faja no cambian de golpe, cada cambio
      // respecto del desplazamiento anterior se penaliza (un salto de medio saco ≈ una caja menos).
      const cambio = Math.hypot(dx - this.dx, dy - this.dy);
      puntaje -= PENALIDAD_CAMBIO * (cambio / altoMedio);
      if (puntaje > mejorPuntaje + 1e-9 || (Math.abs(puntaje - mejorPuntaje) <= 1e-9 && cambio < mejorCambio)) {
        mejor = [dx, dy];
        mejorPuntaje = puntaje;
        mejorCambio = cambio;
      }
    }
    return mejor;
  }

  paso(f: FotogramaDetectado): PasoConteo {
    const dets = deteccionesUtiles(f);
    const xLinea = this.params.lineaX * f.ancho;
    const nuevos: SacoContado[] = [];

    // 1. Desplazamiento común: el que deja más cajas anteriores sobre una caja nueva.
    for (const p of this.pistas) p.prevista = { x1: p.caja.x1, y1: p.caja.y1, x2: p.caja.x2, y2: p.caja.y2 };
    const [dx, dy] = this.desplazamientoComun(dets);
    this.dx = dx;
    this.dy = dy;
    for (const p of this.pistas) {
      const b = p.prevista;
      p.prevista = { x1: b.x1 + dx, x2: b.x2 + dx, y1: b.y1 + dy, y2: b.y2 + dy };
    }

    // 2. Emparejar cada detección con una pista (superposición y, si no, cercanía).
    const candidatos: { p: number; d: number; puntaje: number }[] = [];
    this.pistas.forEach((p, ip) => {
      dets.forEach((d, id) => {
        const v = iou(p.prevista, d);
        if (v >= IOU_MINIMO) {
          candidatos.push({ p: ip, d: id, puntaje: 1 + v });
          return;
        }
        const altoRef = Math.max(d.y2 - d.y1, p.caja.y2 - p.caja.y1);
        const dist = Math.hypot(centroX(p.prevista) - centroX(d), centroY(p.prevista) - centroY(d));
        if (dist <= DISTANCIA_MAXIMA_ALTOS * altoRef) candidatos.push({ p: ip, d: id, puntaje: 1 - dist / (DISTANCIA_MAXIMA_ALTOS * altoRef) });
      });
    });
    candidatos.sort((a, b) => b.puntaje - a.puntaje || a.p - b.p || a.d - b.d);
    const pistaDe = new Map<number, number>();
    const usadas = new Set<number>();
    for (const c of candidatos) {
      if (usadas.has(c.p) || pistaDe.has(c.d)) continue;
      usadas.add(c.p);
      pistaDe.set(c.d, c.p);
    }

    // Actualizar pistas emparejadas, envejecer las demás y crear las nuevas.
    for (const p of this.pistas) p.detectadaAhora = false;
    dets.forEach((d, id) => {
      const ip = pistaDe.get(id);
      if (ip === undefined) return;
      const p = this.pistas[ip];
      p.caja = d;
      p.hits += 1;
      p.sinDeteccion = 0;
      p.detectadaAhora = true;
      if (p.hits >= VIDEO_N_INIT) p.confirmada = true;
    });
    this.pistas = this.pistas.filter((p) => {
      if (p.detectadaAhora) return true;
      p.sinDeteccion += 1;
      // Sin detección, la caja sigue el desplazamiento común.
      p.caja = { ...p.caja, ...p.prevista };
      // Como DeepSORT: una pista tentativa que se pierde se borra; una confirmada, tras MAX_AGE.
      return p.confirmada && p.sinDeteccion <= VIDEO_MAX_AGE;
    });
    dets.forEach((d, id) => {
      if (pistaDe.has(id)) return;
      this.pistas.push({
        id: this.siguienteId++, caja: d, prevista: d, hits: 1, sinDeteccion: 0,
        confirmada: VIDEO_N_INIT <= 1, contada: false, centroXAnterior: null, crucePendiente: false, retrocesos: 0, detectadaAhora: true,
      });
    });

    // 3. Cruce de la línea, como verificar_cruce_linea con VIDEO_CRUCE_SOBRE_DETECCIONES:
    //    +1 en la dirección de conteo, -1 en la contraria, 0 sin cruce.
    const cruce = (p: Pista): -1 | 0 | 1 => {
      const actual = centroX(p.caja);
      const anterior = p.centroXAnterior;
      p.centroXAnterior = actual;
      if (anterior === null) return 0;
      const haciaDerecha = anterior < xLinea && xLinea <= actual;
      const haciaIzquierda = anterior > xLinea && xLinea >= actual;
      if (!haciaDerecha && !haciaIzquierda) return 0;
      return (this.params.direccion === "izquierda_a_derecha") === haciaDerecha ? 1 : -1;
    };
    const contar = (p: Pista, confianza: number | null) => {
      p.contada = true;
      const s = { id: p.id, indice: f.indice, tiempo: f.tiempo, confianza };
      this.contados.push(s);
      nuevos.push(s);
    };
    for (const p of this.pistas) {
      if (p.contada || !p.detectadaAhora) continue; // sin detección no se evalúa el cruce
      let c = cruce(p);
      // Regla adicional al detector: si el saco cruzó antes en sentido contrario (la
      // cámara giró hacia atrás o el saco retrocedió), su regreso no es un saco nuevo.
      if (c === -1) {
        if (p.crucePendiente !== false) p.crucePendiente = false;
        else p.retrocesos += 1;
        continue;
      }
      if (c === 1 && p.retrocesos > 0) {
        p.retrocesos -= 1;
        c = 0;
      }
      if (!p.confirmada) {
        if (c === 1) p.crucePendiente = p.caja.confianza;
        continue;
      }
      if (p.crucePendiente !== false && c === 0) contar(p, p.crucePendiente);
      else if (c === 1) contar(p, p.caja.confianza);
    }

    return {
      pistas: this.pistas.map((p) => ({ id: p.id, caja: p.caja, confirmada: p.confirmada, contada: p.contada, detectadaAhora: p.detectadaAhora })),
      nuevos,
      total: this.contados.length,
    };
  }
}

/** Promedio en % con 2 decimales, como api_cliente.confianza_promedio_contados. */
export function confianzaPromedio(contados: SacoContado[]): number | null {
  const c = contados.map((s) => s.confianza).filter((x): x is number => typeof x === "number");
  return c.length ? Number(((c.reduce((a, b) => a + b, 0) / c.length) * 100).toFixed(2)) : null;
}

/** Cuenta un video completo a partir de sus fotogramas detectados (lo usa el servidor). */
export function contarVideo(fotogramas: FotogramaDetectado[], params: ParametrosConteoVideo): ResultadoConteoVideo {
  const seguidor = new SeguidorSacos(params);
  for (const f of fotogramas) seguidor.paso(f);
  const ultimo = fotogramas[fotogramas.length - 1];
  return {
    total: seguidor.total,
    contados: [...seguidor.contados],
    confianzaPromedio: confianzaPromedio(seguidor.contados),
    fotogramas: fotogramas.length,
    duracionAnalizada: ultimo ? Number(ultimo.tiempo.toFixed(2)) : 0,
  };
}

// ---------- Tipos de la API ----------

/** Respuesta de POST /api/contar-video/fotograma. */
export type RespuestaFotogramaVideo = FotogramaDetectado & { firma: string };

/** Respuesta de POST /api/contar-video/registrar. */
export type LoteRegistradoVideo = {
  lote: { id: number; cantidadSacos: number; origen: string; estadoValidacion: string };
  evidenciaId: number | null;
  yaRegistrado: boolean;
  resultado: ResultadoConteoVideo;
};
