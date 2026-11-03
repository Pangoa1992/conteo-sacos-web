import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firmarRegistro, huellaFoto, idExternoFoto, verificarRegistro, VIGENCIA_REGISTRO_MS, type DatosRegistroFoto } from "@/lib/registro-foto";
import { esOrigenPrueba } from "@/lib/conteos";
import { ORIGEN_FOTO, ORIGEN_FOTO_PRUEBA } from "@/lib/conteo-foto";

const original = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = "c".repeat(48); });
afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

const AHORA = Date.UTC(2026, 10, 3, 20, 0, 0);
const foto = Buffer.from("bytes de una foto jpeg de prueba");
const datos: DatosRegistroFoto = { sha256: huellaFoto(foto), total: 14, confianzaPromedio: 78.85, usuarioId: 1, emitidoEn: AHORA };

describe("Comprobante para registrar un conteo por foto como lote", () => {
  it("se verifica con los mismos datos que se firmaron", () => {
    const c = firmarRegistro(datos)!;
    expect(verificarRegistro(c, AHORA + 60_000)).toEqual({ valido: true, datos });
  });

  it("no se puede cambiar el total ni el usuario sin invalidar la firma", () => {
    const [carga, firma] = firmarRegistro(datos)!.split(".");
    const alterada = Buffer.from(JSON.stringify({ ...datos, total: 140 })).toString("base64url");
    expect(verificarRegistro(`${alterada}.${firma}`, AHORA)).toEqual({ valido: false, motivo: "firma" });
    expect(verificarRegistro(`${carga}.${firma.slice(0, -2)}xx`, AHORA)).toEqual({ valido: false, motivo: "firma" });
  });

  it("un comprobante firmado con otra clave no sirve", () => {
    const c = firmarRegistro(datos)!;
    process.env.JWT_SECRET = "d".repeat(48);
    expect(verificarRegistro(c, AHORA)).toEqual({ valido: false, motivo: "firma" });
  });

  it("vence a los 30 minutos y no acepta fechas futuras", () => {
    const c = firmarRegistro(datos)!;
    expect(verificarRegistro(c, AHORA + VIGENCIA_REGISTRO_MS).valido).toBe(true);
    expect(verificarRegistro(c, AHORA + VIGENCIA_REGISTRO_MS + 1)).toEqual({ valido: false, motivo: "vencido" });
    const futuro = firmarRegistro({ ...datos, emitidoEn: AHORA + 10 * 60_000 })!;
    expect(verificarRegistro(futuro, AHORA)).toEqual({ valido: false, motivo: "vencido" });
  });

  it("rechaza textos que no son comprobantes", () => {
    expect(verificarRegistro("", AHORA)).toEqual({ valido: false, motivo: "formato" });
    expect(verificarRegistro("abc", AHORA)).toEqual({ valido: false, motivo: "formato" });
    expect(verificarRegistro("a.b.c", AHORA)).toEqual({ valido: false, motivo: "formato" });
  });

  it("sin JWT_SECRET no se firman ni se aceptan comprobantes", () => {
    const c = firmarRegistro(datos)!;
    delete process.env.JWT_SECRET;
    expect(firmarRegistro(datos)).toBeNull();
    expect(verificarRegistro(c, AHORA)).toEqual({ valido: false, motivo: "sin_clave" });
  });
});

describe("Identidad de la foto", () => {
  it("la misma foto da siempre el mismo id de lote (no se registra dos veces)", () => {
    expect(idExternoFoto(huellaFoto(foto))).toBe(idExternoFoto(huellaFoto(Buffer.from(foto))));
    expect(idExternoFoto(huellaFoto(foto))).not.toBe(idExternoFoto(huellaFoto(Buffer.from("otra foto"))));
    expect(idExternoFoto(datos.sha256)).toMatch(/^foto_[0-9a-f]{40}$/); // cabe en id_externo varchar(64)
  });

  it("los lotes de foto de prueba no se mezclan con los reales", () => {
    expect(esOrigenPrueba(ORIGEN_FOTO_PRUEBA)).toBe(true);
    expect(esOrigenPrueba(ORIGEN_FOTO)).toBe(false);
  });
});
