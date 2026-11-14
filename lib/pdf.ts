/**
 * Reportes PDF del panel (se generan en el navegador con jsPDF; el servidor no
 * interviene). Todas las páginas llevan el mismo encabezado MACROMEC y un pie
 * con la fecha de emisión y la numeración. Ver components/BotonPdf.tsx.
 */
import type { jsPDF } from "jspdf";

export const NOMBRE_SISTEMA = "Sistema de Conteo de Sacos de Zanahoria mediante Visión Computacional";
export const EMPRESA = "MACROMEC";

// Colores del panel (verde hoja y naranja zanahoria).
const VERDE: [number, number, number] = [46, 125, 50];
const NARANJA: [number, number, number] = [230, 126, 34];
const GRIS: [number, number, number] = [90, 90, 90];
export const MARGEN = 14;

/**
 * Texto apto para las fuentes estándar del PDF (WinAnsi): quita emojis y símbolos
 * que no existen en ellas y unifica los espacios especiales de toLocaleString.
 */
export function textoPdf(texto: string | null | undefined): string {
  return (texto ?? "")
    .replace(/[    ]/g, " ")
    .replace(/−/g, "-") // signo menos tipográfico
    .replace(/[^\n\t\x20-\x7E¡-ÿ–—‘’“”•…€]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Nombre de archivo seguro: «inventario-2026-11-14.pdf». */
export function nombreArchivoPdf(base: string, fecha = new Date()): string {
  const limpio = base.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const dia = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
  return `${limpio || "reporte"}-${dia}.pdf`;
}

export const fechaHoraPdf = (fecha: Date) =>
  fecha.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Encabezado de la primera página; devuelve la altura (y) donde sigue el contenido. */
export function dibujarEncabezado(doc: jsPDF, titulo: string, subtitulo?: string, esPrueba = false): number {
  const ancho = doc.internal.pageSize.getWidth();
  // En hojas angostas (A5, A4 vertical estrecha) el nombre del sistema va debajo de MACROMEC.
  const angosta = ancho < 180;
  const altoFranja = angosta ? 21 : 18;
  doc.setFillColor(...VERDE);
  doc.rect(0, 0, ancho, altoFranja, "F");
  doc.setFillColor(...NARANJA);
  doc.rect(0, altoFranja, ancho, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(EMPRESA, MARGEN, angosta ? 10 : 11.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(angosta ? 7 : 8);
  if (angosta) doc.text(textoPdf(NOMBRE_SISTEMA), MARGEN, 16);
  else doc.text(textoPdf(NOMBRE_SISTEMA), ancho - MARGEN, 11.5, { align: "right" });

  let y = altoFranja + 12;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(textoPdf(titulo), MARGEN, y);
  if (esPrueba) {
    doc.setFontSize(9);
    doc.setTextColor(...NARANJA);
    doc.text("DATOS DE PRUEBA", ancho - MARGEN, y, { align: "right" });
  }
  if (subtitulo) {
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    const lineas = doc.splitTextToSize(textoPdf(subtitulo), ancho - 2 * MARGEN) as string[];
    doc.text(lineas, MARGEN, y);
    y += (lineas.length - 1) * 4;
  }
  doc.setTextColor(0, 0, 0);
  return y + 6;
}

/** Pie en todas las páginas: emisión y «Página x de y». Se llama al final. */
export function dibujarPies(doc: jsPDF, emitido = new Date(), nota?: string) {
  const total = doc.getNumberOfPages();
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(200, 200, 200);
    doc.line(MARGEN, alto - 12, ancho - MARGEN, alto - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(textoPdf(`Generado por el sistema ${EMPRESA} el ${fechaHoraPdf(emitido)}${nota ? ` · ${nota}` : ""}`), MARGEN, alto - 7);
    doc.text(`Página ${i} de ${total}`, ancho - MARGEN, alto - 7, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);
}

export const ESTILO_TABLA = {
  theme: "grid" as const,
  styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak" as const, textColor: 20 },
  headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold" as const },
  alternateRowStyles: { fillColor: [245, 248, 245] as [number, number, number] },
  margin: { left: MARGEN, right: MARGEN, bottom: 16 },
};

// ---------------- Comprobante de venta ----------------

export type DatosComprobante = {
  id: number;
  conteoId: number;
  cantidadSacos: number;
  precioUnitario: string;
  importe: string;
  comprador: string | null;
  registradaEn: string;
  registradaPorNombre: string | null;
  anuladaEn: string | null;
  motivoAnulacion: string | null;
  fechaConteo: string;
  esPrueba: boolean;
};

/** «NV-000123»: número del comprobante a partir del id de la venta. */
export const numeroComprobante = (id: number) => `NV-${String(id).padStart(6, "0")}`;

export const solesPdf = (v: string | number) =>
  `S/ ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const AVISO_COMPROBANTE =
  "Nota de venta interna, sin valor tributario. No reemplaza a la boleta ni a la factura electrónica (SUNAT).";

