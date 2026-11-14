import { describe, expect, it } from "vitest";
import { AVISO_COMPROBANTE, nombreArchivoPdf, numeroComprobante, solesPdf, textoPdf, type DatosComprobante } from "@/lib/pdf";
import { generarComprobanteVenta, generarReportePdf } from "@/lib/pdf-generar";

const venta: DatosComprobante = {
  id: 42,
  conteoId: 11,
  cantidadSacos: 30,
  precioUnitario: "25.50",
  importe: "765.00",
  comprador: "Comercial Huancayo",
  registradaEn: "2026-11-14T15:00:00.000Z",
  registradaPorNombre: "Willy",
  anuladaEn: null,
  motivoAnulacion: null,
  fechaConteo: "2026-11-13T13:00:00.000Z",
  esPrueba: true,
};

/** Texto del PDF sin comprimir (jsPDF escribe el texto entre paréntesis). */
const contenido = (doc: { output: (t: "arraybuffer") => ArrayBuffer }) => Buffer.from(doc.output("arraybuffer")).toString("latin1");

describe("Textos y nombres de los PDF", () => {
  it("quita emojis y espacios especiales que las fuentes del PDF no tienen", () => {
    expect(textoPdf("⚠ Lote #11 ✅ — «ok»")).toBe("Lote #11 — «ok»");
    expect(textoPdf(null)).toBe("");
    expect(textoPdf("reportado − IA")).toBe("reportado - IA");
  });

  it("arma nombres de archivo seguros con la fecha", () => {
    expect(nombreArchivoPdf("Producción validada", new Date(2026, 10, 14))).toBe("produccion-validada-2026-11-14.pdf");
    expect(nombreArchivoPdf("***", new Date(2026, 0, 2))).toBe("reporte-2026-01-02.pdf");
  });

  it("numera el comprobante y da formato a los soles", () => {
    expect(numeroComprobante(42)).toBe("NV-000042");
    expect(solesPdf("765")).toMatch(/^S\/ 765[.,]00$/);
    expect(AVISO_COMPROBANTE).toContain("sin valor tributario");
  });
});

describe("Comprobante de venta (nota de venta interna)", () => {
  it("genera un PDF A5 con el número, el importe y el aviso tributario", () => {
    const doc = generarComprobanteVenta(venta, new Date(2026, 10, 14, 10, 0));
    const pdf = contenido(doc);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("NV-000042");
    expect(pdf).toContain("Comercial Huancayo");
    expect(pdf).toContain("765");
    expect(pdf).toContain("sin valor tributario");
    expect(pdf).toContain("DATOS DE PRUEBA");
    expect(pdf).not.toContain("VENTA ANULADA");
    const [ancho, alto] = [doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()];
    expect(Math.round(ancho)).toBe(148);
    expect(Math.round(alto)).toBe(210);
  });

  it("una venta anulada lo indica con el motivo", () => {
    const pdf = contenido(generarComprobanteVenta({ ...venta, esPrueba: false, anuladaEn: "2026-11-14T16:00:00.000Z", motivoAnulacion: "Error de precio" }));
    expect(pdf).toContain("VENTA ANULADA");
    expect(pdf).toContain("Motivo: Error de");
    expect(pdf).not.toContain("DATOS DE PRUEBA");
  });

  it("sin comprador figura «Cliente varios»", () => {
    expect(contenido(generarComprobanteVenta({ ...venta, comprador: null }))).toContain("Cliente varios");
  });
});

describe("Reporte PDF de un módulo", () => {
  it("incluye título, tablas y numeración de páginas", () => {
    const filas = Array.from({ length: 80 }, (_, i) => [`#${i + 1}`, "13/11/2026", String(10 + i)]);
    const doc = generarReportePdf("Inventario de sacos", "solo datos reales", [
      { titulo: "Lotes", columnas: ["Lote", "Fecha", "Disponibles"], filas, alinearDerecha: [2] },
    ]);
    const pdf = contenido(doc);
    expect(pdf).toContain("Inventario de sacos");
    expect(pdf).toContain("#80");
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(pdf).toContain(`Página 1 de ${doc.getNumberOfPages()}`);
  });

  it("con muchas columnas usa hoja horizontal y sin tablas lo avisa", () => {
    const columnas = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const horizontal = generarReportePdf("Ventas", "", [{ columnas, filas: [] }]);
    expect(horizontal.internal.pageSize.getWidth()).toBeGreaterThan(horizontal.internal.pageSize.getHeight());
    expect(contenido(horizontal)).toContain("Sin registros.");
    expect(contenido(generarReportePdf("Vacío", "", []))).toContain("No hay datos para mostrar");
  });
});
