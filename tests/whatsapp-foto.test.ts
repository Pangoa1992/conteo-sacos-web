import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEXTO_FOTO_ERROR, TEXTO_FOTO_INVALIDA, TEXTO_FOTO_NO_CONFIGURADO, esUrlMedioTwilio, leerAdjuntos, textoResultadoFoto, tipoBase,
} from "@/lib/whatsapp-foto";
import { contarFotoWhatsapp, normalizarImagenWhatsapp } from "@/lib/whatsapp-foto-servidor";
import { TEXTO_AYUDA, TEXTO_AYUDA_DEMO } from "@/lib/whatsapp";

const CUENTA = "AC" + "0".repeat(32);
const URL_MEDIO = `https://api.twilio.com/2010-04-01/Accounts/${CUENTA}/Messages/MM123abc/Media/ME456def`;

async function fotoDePrueba(ancho = 800, alto = 600, formato: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const base = sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  return formato === "png" ? base.png().toBuffer() : base.jpeg().toBuffer();
}

describe("Adjuntos de WhatsApp", () => {
  it("reconoce una foto de Twilio y su tipo", () => {
    const r = leerAdjuntos({ NumMedia: "1", MediaUrl0: URL_MEDIO, MediaContentType0: "image/jpeg" });
    expect(r).toEqual({ tipo: "imagen", adjunto: { url: URL_MEDIO, tipo: "image/jpeg" }, adjuntos: 1 });
  });

  it("sin adjuntos, con audio o con URL ajena no hay foto que contar", () => {
    expect(leerAdjuntos({ NumMedia: "0", Body: "hoy" })).toEqual({ tipo: "sin_adjuntos" });
    expect(leerAdjuntos({ Body: "hoy" })).toEqual({ tipo: "sin_adjuntos" });
    expect(leerAdjuntos({ NumMedia: "1", MediaUrl0: URL_MEDIO, MediaContentType0: "audio/ogg" })).toEqual({ tipo: "no_imagen", adjuntos: 1 });
    expect(leerAdjuntos({ NumMedia: "1", MediaUrl0: "https://ejemplo.com/foto.jpg", MediaContentType0: "image/jpeg" }))
      .toEqual({ tipo: "no_imagen", adjuntos: 1 });
  });

  it("con varios adjuntos toma la primera imagen", () => {
    const r = leerAdjuntos({
      NumMedia: "2", MediaUrl0: URL_MEDIO, MediaContentType0: "video/mp4",
      MediaUrl1: URL_MEDIO.replace("ME456def", "ME789"), MediaContentType1: "image/png",
    });
    expect(r).toMatchObject({ tipo: "imagen", adjunto: { tipo: "image/png" }, adjuntos: 2 });
  });

  it("solo acepta URLs https de api.twilio.com con la ruta de la cuenta", () => {
    expect(esUrlMedioTwilio(URL_MEDIO)).toBe(true);
    expect(esUrlMedioTwilio(URL_MEDIO.replace("https:", "http:"))).toBe(false);
    expect(esUrlMedioTwilio(URL_MEDIO.replace("api.twilio.com", "api.twilio.com.evil.pe"))).toBe(false);
    expect(esUrlMedioTwilio(URL_MEDIO.replace("https://", "https://user:pass@"))).toBe(false);
    expect(esUrlMedioTwilio("https://api.twilio.com/otra/ruta")).toBe(false);
    expect(esUrlMedioTwilio(undefined)).toBe(false);
    expect(tipoBase("Image/JPEG; charset=x")).toBe("image/jpeg");
  });
});

describe("Texto de respuesta del conteo por foto", () => {
  it("informa el total y la confianza", () => {
    const t = textoResultadoFoto({ total: 14, confianzaPromedio: 87.25 });
    expect(t).toContain("Sacos contados: *14*");
    expect(t).toContain("87.3 %");
    expect(t).toContain("no se registra como lote");
  });

  it("sin sacos da un consejo y con varias fotos lo aclara", () => {
    expect(textoResultadoFoto({ total: 0, confianzaPromedio: null })).toContain("No se detectaron sacos");
    expect(textoResultadoFoto({ total: 3, confianzaPromedio: 90 }, 2)).toContain("se contó solo la primera");
  });

  it("la ayuda (normal y DEMO) menciona la foto", () => {
    expect(TEXTO_AYUDA).toContain("*foto*");
    expect(TEXTO_AYUDA_DEMO).toContain("*foto*");
  });
});

describe("Normalización de la foto", () => {
  it("reduce a 1600 px como el panel web y entrega JPEG", async () => {
    const r = await normalizarImagenWhatsapp(await fotoDePrueba(3200, 2400, "png"));
    expect(r.ancho).toBe(1600);
    expect(r.alto).toBe(1200);
    expect(r.imagen.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("no agranda una foto pequeña", async () => {
    const r = await normalizarImagenWhatsapp(await fotoDePrueba(640, 480));
    expect([r.ancho, r.alto]).toEqual([640, 480]);
  });
});

describe("Conteo de la foto recibida (Twilio y Roboflow simulados)", () => {
  const llamadas: { url: string; auth: string | null }[] = [];
  let respuestaRoboflow: () => Response;
  let respuestaTwilio: () => Promise<Response>;

  beforeEach(() => {
    llamadas.length = 0;
    vi.stubEnv("ROBOFLOW_API_KEY", "clave-de-prueba");
    vi.stubEnv("ROBOFLOW_API_URL", "");
    respuestaTwilio = async () => new Response(new Uint8Array(await fotoDePrueba()), { headers: { "Content-Type": "image/jpeg" } });
    respuestaRoboflow = () => Response.json({
      predictions: [
        { class: "Saco", x: 100, y: 100, width: 50, height: 60, confidence: 0.9 },
        { class: "Saco", x: 300, y: 200, width: 50, height: 60, confidence: 0.8 },
        { class: "Otro", x: 10, y: 10, width: 5, height: 5, confidence: 0.99 },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async (entrada: string | URL, init?: RequestInit) => {
      const url = String(entrada);
      const headers = new Headers(init?.headers);
      llamadas.push({ url, auth: headers.get("authorization") });
      if (url.startsWith("https://api.twilio.com/")) return respuestaTwilio();
      if (url.startsWith("https://serverless.roboflow.com/")) return respuestaRoboflow();
      throw new Error("URL inesperada " + url);
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const adjunto = { url: URL_MEDIO, tipo: "image/jpeg" };

  it("descarga con la cuenta de Twilio, cuenta solo «Saco» y responde el total", async () => {
    const t = await contarFotoWhatsapp(adjunto, 1, CUENTA, "token");
    expect(t).toContain("Sacos contados: *2*");
    expect(t).toContain("85.0 %");
    expect(llamadas[0].auth).toBe("Basic " + Buffer.from(`${CUENTA}:token`).toString("base64"));
    expect(llamadas[1].auth).toBe("Bearer clave-de-prueba");
  });

  it("sin clave de Roboflow avisa que no está disponible y no descarga nada", async () => {
    vi.stubEnv("ROBOFLOW_API_KEY", "");
    expect(await contarFotoWhatsapp(adjunto, 1, CUENTA, "token")).toBe(TEXTO_FOTO_NO_CONFIGURADO);
    expect(llamadas).toHaveLength(0);
  });

  it("si Twilio falla o el archivo no es imagen, responde un mensaje claro", async () => {
    respuestaTwilio = async () => new Response("no", { status: 404 });
    expect(await contarFotoWhatsapp(adjunto, 1, CUENTA, "token")).toBe(TEXTO_FOTO_ERROR);
    respuestaTwilio = async () => new Response("<html>", { headers: { "Content-Type": "text/html" } });
    expect(await contarFotoWhatsapp(adjunto, 1, CUENTA, "token")).toBe(TEXTO_FOTO_INVALIDA);
    respuestaTwilio = async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "Content-Type": "image/jpeg" } });
    expect(await contarFotoWhatsapp(adjunto, 1, CUENTA, "token")).toBe(TEXTO_FOTO_INVALIDA);
  });

  it("si Roboflow rechaza o se satura, no cae el webhook", async () => {
    respuestaRoboflow = () => new Response("", { status: 429 });
    expect(await contarFotoWhatsapp(adjunto, 1, CUENTA, "token")).toBe(TEXTO_FOTO_ERROR);
  });

  it("una URL que no es de Twilio nunca se descarga", async () => {
    expect(await contarFotoWhatsapp({ url: "https://ejemplo.com/x.jpg", tipo: "image/jpeg" }, 1, CUENTA, "token")).toBe(TEXTO_FOTO_INVALIDA);
    expect(llamadas).toHaveLength(0);
  });
});
