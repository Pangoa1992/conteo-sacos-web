/**
 * Diseño de los reportes PDF del panel (se generan en el navegador con jsPDF; el
 * servidor no interviene). Mismos colores que el panel (app/globals.css): azul
 * marino, azul de marca y naranja. Primera página con franja de marca, título e
 * indicadores en tarjetas; las siguientes con una franja delgada; todas con pie
 * de emisión y numeración. Ver components/BotonPdf.tsx y lib/pdf-generar.ts.
 */
import type { jsPDF } from "jspdf";

export const NOMBRE_SISTEMA = "Sistema de Conteo de Sacos de Zanahoria mediante Visión Computacional";
export const EMPRESA = "MACROMEC";

type Color = [number, number, number];
// Paleta del panel (app/globals.css).
export const COLOR = {
  marino: [11, 31, 58] as Color, // --navy-900
  marino2: [27, 58, 99] as Color, // --navy-700
  azul: [20, 80, 180] as Color, // --azul-marca
  naranja: [232, 99, 42] as Color, // --naranja
  texto: [15, 27, 45] as Color, // --texto
  texto2: [74, 86, 104] as Color, // --texto-2
  tenue: [107, 118, 134] as Color, // --texto-tenue
  linea: [227, 232, 239] as Color, // --linea
  superficie2: [245, 247, 250] as Color, // --superficie-2
  ok: [31, 122, 77] as Color, // --ok
  okFondo: [231, 245, 238] as Color,
  critico: [180, 35, 24] as Color, // --critico
  criticoFondo: [253, 236, 234] as Color,
  prueba: [91, 63, 160] as Color, // --prueba
  pruebaFondo: [241, 236, 250] as Color,
};
export const MARGEN = 14;

/** Tarjeta de indicador (como las .kpi del panel). */
export type IndicadorPdf = { etiqueta: string; valor: string; detalle?: string; destacado?: boolean };

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

/** Marca: un saco estilizado (naranja) dentro de un círculo blanco. */
function dibujarMarca(doc: jsPDF, x: number, y: number, r: number) {
  doc.setFillColor(255, 255, 255);
  doc.circle(x, y, r, "F");
  doc.setFillColor(...COLOR.naranja);
  doc.roundedRect(x - r * 0.48, y - r * 0.3, r * 0.96, r * 0.85, r * 0.2, r * 0.2, "F");
  doc.triangle(x - r * 0.3, y - r * 0.3, x + r * 0.3, y - r * 0.3, x, y - r * 0.62, "F");
  doc.setFillColor(...COLOR.marino);
  doc.rect(x - r * 0.36, y - r * 0.36, r * 0.72, r * 0.1, "F");
}

/** Etiqueta con fondo redondeado (como los .badge del panel). Devuelve su ancho. */
export function dibujarEtiqueta(doc: jsPDF, texto: string, xDerecha: number, y: number, color: Color, fondo: Color): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const ancho = doc.getTextWidth(texto) + 6;
  doc.setFillColor(...fondo);
  doc.setDrawColor(...color);
  doc.setLineWidth(0.3);
  doc.roundedRect(xDerecha - ancho, y - 4, ancho, 5.6, 2.8, 2.8, "FD");
  doc.setTextColor(...color);
  doc.text(texto, xDerecha - ancho / 2, y, { align: "center" });
  return ancho;
}

/**
 * Encabezado de la primera página: franja de marca con el tipo de documento y la
 * fecha, título, etiqueta de datos de prueba y descripción. Devuelve la y siguiente.
 */
export function dibujarEncabezado(
  doc: jsPDF,
  titulo: string,
  subtitulo?: string,
  esPrueba = false,
  opciones: { tipo?: string; emitido?: Date } = {}
): number {
  const ancho = doc.internal.pageSize.getWidth();
  const angosta = ancho < 180;
  const alto = 26;
  doc.setFillColor(...COLOR.marino);
  doc.rect(0, 0, ancho, alto, "F");
  doc.setFillColor(...COLOR.naranja);
  doc.rect(0, alto, ancho, 1.6, "F");
  dibujarMarca(doc, MARGEN + 5, alto / 2, 5.5);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(EMPRESA, MARGEN + 13.5, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(angosta ? 6.5 : 7.5);
  doc.setTextColor(200, 212, 230);
  const nombre = doc.splitTextToSize(textoPdf(NOMBRE_SISTEMA), angosta ? ancho - MARGEN * 2 - 50 : 110) as string[];
  doc.text(nombre, MARGEN + 13.5, 17);

  // Tipo de documento y fecha de emisión, a la derecha.
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text((opciones.tipo ?? "REPORTE").toUpperCase(), ancho - MARGEN, 11, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 212, 230);
  doc.setFontSize(7.5);
  doc.text(fechaHoraPdf(opciones.emitido ?? new Date()), ancho - MARGEN, 16, { align: "right" });

  let y = alto + 13;
  doc.setTextColor(...COLOR.marino);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(angosta ? 15 : 18);
  doc.text(textoPdf(titulo), MARGEN, y);
  if (esPrueba) dibujarEtiqueta(doc, "DATOS DE PRUEBA", ancho - MARGEN, y - 1, COLOR.prueba, COLOR.pruebaFondo);
  // Línea de acento bajo el título.
  doc.setFillColor(...COLOR.naranja);
  doc.rect(MARGEN, y + 2.5, 18, 0.9, "F");
  y += 8;
  if (subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR.texto2);
    const lineas = doc.splitTextToSize(textoPdf(subtitulo), ancho - 2 * MARGEN) as string[];
    doc.text(lineas, MARGEN, y);
    y += lineas.length * 3.8;
  }
  doc.setTextColor(...COLOR.texto);
  return y + 3;
}

/** Franja delgada de las páginas 2 en adelante. */
export function dibujarEncabezadoContinuacion(doc: jsPDF, titulo: string) {
  const ancho = doc.internal.pageSize.getWidth();
  doc.setFillColor(...COLOR.marino);
  doc.rect(0, 0, ancho, 10, "F");
  doc.setFillColor(...COLOR.naranja);
  doc.rect(0, 10, ancho, 0.8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(EMPRESA, MARGEN, 6.6);
  doc.setFont("helvetica", "normal");
  doc.text(textoPdf(titulo), ancho - MARGEN, 6.6, { align: "right" });
  doc.setTextColor(...COLOR.texto);
}

/** Fila de tarjetas de indicadores; devuelve la y siguiente. Hasta 5 por fila. */
export function dibujarIndicadores(doc: jsPDF, indicadores: IndicadorPdf[], y: number): number {
  if (indicadores.length === 0) return y;
  const ancho = doc.internal.pageSize.getWidth() - 2 * MARGEN;
  const porFila = Math.min(indicadores.length, 5);
  const sep = 3;
  const w = (ancho - sep * (porFila - 1)) / porFila;
  const h = 21;
  indicadores.forEach((k, i) => {
    const fila = Math.floor(i / porFila);
    const x = MARGEN + (i % porFila) * (w + sep);
    const yy = y + fila * (h + sep);
    const acento = k.destacado ? COLOR.naranja : COLOR.azul;
    doc.setFillColor(...COLOR.superficie2);
    doc.setDrawColor(...COLOR.linea);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, yy, w, h, 1.8, 1.8, "FD");
    doc.setFillColor(...acento);
    doc.rect(x, yy + 1.8, 1.2, h - 3.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(...COLOR.tenue);
    doc.text((doc.splitTextToSize(textoPdf(k.etiqueta).toUpperCase(), w - 6) as string[])[0], x + 4, yy + 5.5);
    doc.setFontSize(w > 40 ? 14 : 12);
    doc.setTextColor(...(k.destacado ? COLOR.naranja : COLOR.marino));
    doc.text((doc.splitTextToSize(textoPdf(k.valor), w - 6) as string[])[0], x + 4, yy + 12.5);
    if (k.detalle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...COLOR.texto2);
      doc.text((doc.splitTextToSize(textoPdf(k.detalle), w - 6) as string[]).slice(0, 2), x + 4, yy + 16.5);
    }
  });
  doc.setTextColor(...COLOR.texto);
  const filas = Math.ceil(indicadores.length / porFila);
  return y + filas * h + (filas - 1) * sep + 7;
}

/** Título de sección con barra de acento; devuelve la y siguiente. */
export function dibujarTituloSeccion(doc: jsPDF, titulo: string, y: number): number {
  doc.setFillColor(...COLOR.naranja);
  doc.rect(MARGEN, y - 3.4, 1.2, 4.4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...COLOR.marino);
  doc.text(textoPdf(titulo), MARGEN + 3.5, y);
  doc.setTextColor(...COLOR.texto);
  return y + 3.5;
}

/** Pie en todas las páginas: sistema, emisión y «Página x de y». Se llama al final. */
export function dibujarPies(doc: jsPDF, emitido = new Date(), nota?: string) {
  const total = doc.getNumberOfPages();
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COLOR.linea);
    doc.setLineWidth(0.3);
    doc.line(MARGEN, alto - 12, ancho - MARGEN, alto - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.tenue);
    doc.text(textoPdf(`${EMPRESA} · Generado el ${fechaHoraPdf(emitido)}${nota ? ` · ${nota}` : ""}`), MARGEN, alto - 7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLOR.marino);
    doc.text(`Página ${i} de ${total}`, ancho - MARGEN, alto - 7, { align: "right" });
  }
  doc.setTextColor(...COLOR.texto);
}

export const ESTILO_TABLA = {
  theme: "grid" as const,
  styles: {
    font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
    overflow: "linebreak" as const, textColor: COLOR.texto, lineColor: COLOR.linea, lineWidth: 0.2, valign: "middle" as const,
  },
  headStyles: { fillColor: COLOR.marino2, textColor: 255, fontStyle: "bold" as const, fontSize: 7.8, lineColor: COLOR.marino2 },
  alternateRowStyles: { fillColor: COLOR.superficie2 },
  margin: { left: MARGEN, right: MARGEN, bottom: 16, top: 16 },
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
