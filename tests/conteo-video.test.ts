import fs from "fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ORIGEN_VIDEO,
  ORIGEN_VIDEO_PRUEBA,
  SeguidorSacos,
  VIDEO_FOTOGRAMAS_MAXIMOS,
  VIDEO_PASO_SEGUNDOS,
  contarVideo,
  parametrosValidos,
  type CajaVideo,
  type FotogramaDetectado,
  type ParametrosConteoVideo,
} from "@/lib/conteo-video";
import { esOrigenPrueba } from "@/lib/conteos";
import { firmarFotograma, huellaFotograma, idExternoVideo, verificarFotogramas, VIGENCIA_VIDEO_MS, type DatosFotograma } from "@/lib/registro-video";

const DER_IZQ: ParametrosConteoVideo = { lineaX: 0.5, direccion: "derecha_a_izquierda" };
const IZQ_DER: ParametrosConteoVideo = { lineaX: 0.5, direccion: "izquierda_a_derecha" };
const W = 480;
const H = 864;

/** Saco de 80 × 240 px (más alto que el 14 % del video) centrado en x. */
const saco = (x: number, y = 430, conf = 0.9): CajaVideo => ({ x1: x - 40, y1: y - 120, x2: x + 40, y2: y + 120, confianza: conf });
const fotogramas = (posiciones: (number | null)[][]): FotogramaDetectado[] =>
  posiciones.map((xs, i) => ({
    indice: i, tiempo: i * VIDEO_PASO_SEGUNDOS, ancho: W, alto: H,
    detecciones: xs.filter((x): x is number => x !== null).map((x) => saco(x)),
  }));

describe("Seguimiento y conteo por cruce de línea (video real grabado)", () => {
  // 73 respuestas reales de RF-DETR sobre los primeros 13 s de video_real_sacos.mp4.
  const fx = JSON.parse(fs.readFileSync("tests/fixtures/video_real_13s.json", "utf8"));
  const reales: FotogramaDetectado[] = fx.fotogramas.map((f: { frame: number; p: number[][] }, i: number) => ({
    indice: i, tiempo: f.frame / 30, ancho: fx.ancho, alto: fx.alto,
    detecciones: f.p.map(([x, y, w, h, c]) => ({ x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2, confianza: c })),
  }));

  it("cuenta 9 sacos, como la inspección visual (el detector con DeepSORT contó 8)", () => {
    const r = contarVideo(reales, DER_IZQ);
    expect(r.total).toBe(9);
    expect(r.fotogramas).toBe(73);
    expect(r.confianzaPromedio).toBeGreaterThan(85);
    // Los 8 cruces de DeepSORT están entre los del panel, en el mismo fotograma.
    const frames = r.contados.map((s) => fx.fotogramas[s.indice].frame);
    for (const f of fx.referencia_deepsort.fotogramas_contados) expect(frames).toContain(f);
    // Después del fotograma 110 la cámara gira hacia atrás: ya no hay cruces válidos.
    expect(Math.max(...frames)).toBeLessThanOrEqual(110);
  });

  it("el mismo video espejado y con la dirección contraria da el mismo total", () => {
    const espejo = reales.map((f) => ({ ...f, detecciones: f.detecciones.map((d) => ({ ...d, x1: f.ancho - d.x2, x2: f.ancho - d.x1 })) }));
    expect(contarVideo(espejo, IZQ_DER).total).toBe(9);
  });

  it("es determinista: el servidor obtiene el mismo resultado que el navegador", () => {
    const seguidor = new SeguidorSacos(DER_IZQ);
    for (const f of reales) seguidor.paso(f);
    expect(seguidor.contados).toEqual(contarVideo(reales, DER_IZQ).contados);
  });
});

describe("Reglas de conteo (mismas que el detector Python)", () => {
  it("un saco que cruza de derecha a izquierda se cuenta una vez", () => {
    expect(contarVideo(fotogramas([[400], [340], [280], [220], [160], [100]]), DER_IZQ).total).toBe(1);
  });

  it("en la dirección contraria no se cuenta", () => {
    expect(contarVideo(fotogramas([[100], [160], [220], [280], [340]]), DER_IZQ).total).toBe(0);
    expect(contarVideo(fotogramas([[100], [160], [220], [280], [340]]), IZQ_DER).total).toBe(1);
  });

  it("si vuelve a cruzar tras retroceder (cámara que gira), no se cuenta de nuevo", () => {
    // Cruza, frena, retrocede (vuelve a la derecha de la línea) y cruza otra vez.
    const ida = [[400], [340], [280], [220], [195], [200], [225], [255], [275], [255], [215], [170]];
    expect(contarVideo(fotogramas(ida), DER_IZQ).total).toBe(1);
  });

  it("un saco que primero cruza en sentido contrario y luego regresa no es un saco nuevo", () => {
    expect(contarVideo(fotogramas([[160], [190], [220], [250], [275], [285], [270], [240], [210], [180]]), DER_IZQ).total).toBe(0);
  });

  it("si cruza siendo tentativo se cuenta cuando se confirma (n_init = 3)", () => {
    const r = contarVideo(fotogramas([[260], [220], [180], [140]]), DER_IZQ);
    expect(r.total).toBe(1);
    expect(r.contados[0].indice).toBe(2); // se confirma en la 3.ª detección
  });

  it("una detección aislada que nunca se confirma no se cuenta", () => {
    expect(contarVideo(fotogramas([[260], [220], [], [], []]), DER_IZQ).total).toBe(0);
  });

  it("sin detección no se evalúa el cruce: un saco perdido y recuperado se cuenta una vez", () => {
    expect(contarVideo(fotogramas([[400], [340], [300], [null], [null], [180], [120]]), DER_IZQ).total).toBe(1);
  });

  it("ignora los sacos pequeños del fondo (menos del 14 % del alto)", () => {
    const f = fotogramas([[400], [340], [280], [220], [160]]).map((x) => ({
      ...x, detecciones: x.detecciones.map((d) => ({ ...d, y1: 400, y2: 500 })),
    }));
    expect(contarVideo(f, DER_IZQ).total).toBe(0);
  });

  it("cuenta varios sacos que avanzan juntos sin confundirlos", () => {
    // Faja con 6 sacos separados 110 px que avanzan 45 px por inferencia; entran por la derecha.
    const filas = Array.from({ length: 20 }, (_, k) =>
      [0, 1, 2, 3, 4, 5].map((j) => 480 + 110 * j - 45 * k).filter((x) => x > 0 && x <= 480));
    expect(contarVideo(fotogramas(filas), DER_IZQ).total).toBe(6);
  });

  it("no confunde sacos iguales y equidistantes (el video sintético de 12 sacos da 12)", () => {
    // Mismo dibujo que generar_video_sintetico.py: 12 sacos separados 110 px que avanzan 45 px por inferencia.
    const f: FotogramaDetectado[] = Array.from({ length: 49 }, (_, k) => ({
      indice: k, tiempo: k * VIDEO_PASO_SEGUNDOS, ancho: W, alto: H,
      detecciones: Array.from({ length: 12 }, (_, j) => 520 + 110 * j - 45 * k)
        .map((cx) => ({ x1: Math.max(0, cx - 40), y1: 310, x2: Math.min(W - 1, cx + 40), y2: 551, confianza: 0.91 }))
        .filter((d) => d.x2 - d.x1 >= 4),
    }));
    expect(contarVideo(f, DER_IZQ).total).toBe(12);
  });

  it("valida la línea y la dirección elegidas", () => {
    expect(parametrosValidos({ lineaX: 0.5, direccion: "derecha_a_izquierda" })).toEqual(DER_IZQ);
    expect(parametrosValidos({ lineaX: 0.95, direccion: "derecha_a_izquierda" })).toBeNull();
    expect(parametrosValidos({ lineaX: 0.5, direccion: "arriba" })).toBeNull();
    expect(parametrosValidos({ lineaX: "0.5", direccion: "derecha_a_izquierda" })).toBeNull();
  });

  it("los lotes de video de prueba no se suman a los indicadores reales", () => {
    expect(esOrigenPrueba(ORIGEN_VIDEO_PRUEBA)).toBe(true);
    expect(esOrigenPrueba(ORIGEN_VIDEO)).toBe(false);
  });
});

describe("Firmas de los fotogramas para registrar el lote", () => {
  const original = process.env.JWT_SECRET;
  beforeEach(() => { process.env.JWT_SECRET = "v".repeat(48); });
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  const AHORA = Date.UTC(2026, 10, 5, 17, 0, 0);
  const SESION = "0f8e2c4a-1b2c-4d5e-8f90-123456789abc";
  const base = (i: number, x: number): DatosFotograma => ({
    s: SESION, i, t: Number((i * VIDEO_PASO_SEGUNDOS).toFixed(3)), w: W, h: H,
    d: [[x - 40, 310, x + 40, 550, 0.9]], u: 1, e: AHORA, f: huellaFotograma(Buffer.from(`fotograma ${i}`)),
  });
  const serie = () => [400, 340, 280, 220, 160].map((x, i) => firmarFotograma(base(i, x))!);

  it("una serie completa se verifica y el servidor vuelve a contar 1 saco", () => {
    const v = verificarFotogramas(serie(), 1, AHORA + 60_000);
    expect(v.valido).toBe(true);
    if (v.valido) expect(contarVideo(v.fotogramas, DER_IZQ).total).toBe(1);
  });

  it("no se pueden cambiar las cajas sin invalidar la firma", () => {
    const s = serie();
    const [, firma] = s[2].split(".");
    const alterada = Buffer.from(JSON.stringify({ ...base(2, 280), d: [] })).toString("base64url");
    s[2] = `${alterada}.${firma}`;
    expect(verificarFotogramas(s, 1, AHORA)).toEqual({ valido: false, motivo: "firma" });
  });

  it("rechaza fotogramas faltantes, repetidos o desordenados", () => {
    const s = serie();
    expect(verificarFotogramas([s[0], s[1], s[3]], 1, AHORA)).toEqual({ valido: false, motivo: "secuencia" });
    expect(verificarFotogramas([s[0], s[1], s[1]], 1, AHORA)).toEqual({ valido: false, motivo: "secuencia" });
    expect(verificarFotogramas([s[1], s[0]], 1, AHORA)).toEqual({ valido: false, motivo: "secuencia" });
  });

  it("rechaza mezclar fotogramas de otra sesión", () => {
    const s = serie();
    s[4] = firmarFotograma({ ...base(4, 160), s: "11111111-2222-4333-8444-555555555555" })!;
    expect(verificarFotogramas(s, 1, AHORA)).toEqual({ valido: false, motivo: "secuencia" });
  });

  it("solo lo registra el mismo usuario que analizó el video", () => {
    expect(verificarFotogramas(serie(), 2, AHORA)).toEqual({ valido: false, motivo: "usuario" });
  });

  it("vence a los 60 minutos", () => {
    expect(verificarFotogramas(serie(), 1, AHORA + VIGENCIA_VIDEO_MS + 1)).toEqual({ valido: false, motivo: "vencido" });
  });

  it("sin JWT_SECRET no firma ni verifica", () => {
    const s = serie();
    delete process.env.JWT_SECRET;
    expect(firmarFotograma(base(0, 400))).toBeNull();
    expect(verificarFotogramas(s, 1, AHORA)).toEqual({ valido: false, motivo: "sin_clave" });
  });

  it("rechaza listas vacías o más largas que el máximo", () => {
    expect(verificarFotogramas([], 1, AHORA)).toEqual({ valido: false, motivo: "formato" });
    expect(verificarFotogramas(Array(VIDEO_FOTOGRAMAS_MAXIMOS + 1).fill("x.y"), 1, AHORA)).toEqual({ valido: false, motivo: "formato" });
  });

  it("la misma sesión da el mismo identificador de lote (no se duplica)", () => {
    expect(idExternoVideo(SESION, 1)).toBe(idExternoVideo(SESION, 1));
    expect(idExternoVideo(SESION, 1)).not.toBe(idExternoVideo(SESION, 2));
    expect(idExternoVideo(SESION, 1)).toMatch(/^video_[0-9a-f]{40}$/);
  });
});
