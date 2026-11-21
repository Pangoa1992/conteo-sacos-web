import { describe, expect, it } from "vitest";
import { COLUMNAS_PROHIBIDAS, TABLAS_RESPALDO, csvRespaldo, nombreArchivoRespaldo, sha256, textoLeeme } from "@/lib/respaldo";

describe("Módulo Respaldo", () => {
  it("nunca exporta contraseñas ni datos de sesión", () => {
    const todas = TABLAS_RESPALDO.flatMap((t) => [...t.columnas]);
    for (const c of COLUMNAS_PROHIBIDAS) expect(todas).not.toContain(c);
    expect(TABLAS_RESPALDO.find((t) => t.nombre === "usuarios")?.columnas).toEqual(["id", "nombre", "correo", "rol", "activo", "creado_en"]);
  });

  it("incluye todas las tablas de datos del negocio, cada una con id", () => {
    expect(TABLAS_RESPALDO.map((t) => t.nombre)).toEqual(
      ["conteos", "validaciones_conteo", "reportes_contratista", "ventas_lote", "ventas", "evidencias", "usuarios", "mensajes_whatsapp"]);
    for (const t of TABLAS_RESPALDO) expect(t.columnas[0]).toBe("id");
  });

  it("CSV fiel para restaurar: comillas escapadas, NULL vacío, BOM y CRLF", () => {
    const csv = csvRespaldo(["id", "comprador", "anulada_en"], [["1", 'Mercado "Modelo"', null], ["2", "=SUMA(1)", "2026-11-14 10:00:00"]]);
    expect(csv.startsWith("﻿id,comprador,anulada_en\r\n")).toBe(true);
    expect(csv).toContain('"1","Mercado ""Modelo""",\r\n');
    // Sin alterar el dato (el respaldo debe poder restaurarse tal cual).
    expect(csv).toContain('"2","=SUMA(1)","2026-11-14 10:00:00"\r\n');
  });

  it("nombra el archivo con la fecha y hora de Lima", () => {
    expect(nombreArchivoRespaldo(new Date("2026-11-14T20:30:00Z"))).toBe("respaldo-macromec-2026-11-14_1530.zip");
    expect(nombreArchivoRespaldo(new Date("2026-11-15T03:05:00Z"))).toBe("respaldo-macromec-2026-11-14_2205.zip");
  });

  it("el LEEME explica el contenido y cómo restaurar", () => {
    const t = textoLeeme({
      sistema: "MACROMEC", generado: "2026-11-14T20:30:00Z", generadoPor: "Admin", totalRegistros: 3,
      archivos: [{ archivo: "conteos.csv", tabla: "conteos", descripcion: "Lotes", registros: 3, sha256: sha256("x") }],
    });
    expect(t).toContain("conteos.csv");
    expect(t).toContain("RESTAURAR");
    expect(t).toContain("NO incluye");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
