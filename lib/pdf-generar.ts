/**
 * Generación de los PDF en el navegador. Este módulo se carga solo al pulsar
 * «Exportar PDF» o «Comprobante» (import dinámico), así jsPDF no pesa en la
 * carga inicial del panel.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AVISO_COMPROBANTE,
  ESTILO_TABLA,
  MARGEN,
  dibujarEncabezado,
  dibujarPies,
  fechaHoraPdf,
  nombreArchivoPdf,
  numeroComprobante,
  solesPdf,
  textoPdf,
  type DatosComprobante,
} from "./pdf";

/** Celda: texto, o una nota que ocupa todo el ancho de la fila (detalle de una venta anulada). */
export type CeldaPdf = string | { content: string; colSpan: number };
export type TablaPdf = { titulo?: string; columnas: string[]; filas: CeldaPdf[][]; alinearDerecha?: number[]; sinEncabezado?: boolean };

const ultimaY = (doc: jsPDF, porDefecto: number) =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? porDefecto;

/** Lee una tabla HTML del panel: encabezados, filas visibles y columnas numéricas. */
export function leerTablaHtml(tabla: HTMLTableElement): TablaPdf {
  const limpiar = (celda: Element) => {
    const copia = celda.cloneNode(true) as HTMLElement;
    // Botones, formularios y campos no forman parte del dato.
    // La etiqueta "Prueba" de cada fila se omite: el encabezado del PDF ya dice DATOS DE PRUEBA.
    copia.querySelectorAll("button, form, input, select, textarea, .badge-prueba, [data-pdf-omitir]").forEach((n) => n.remove());
    // Un espacio tras cada elemento: "Aprobado" + "128 conf." no deben quedar pegados.
    copia.querySelectorAll("*").forEach((n) => { n.before(" "); n.after(" "); });
    return textoPdf(copia.textContent);
  };
  const encabezados = Array.from(tabla.querySelectorAll("thead th"));
  const sinEncabezado = encabezados.length === 0;
  // Tabla sin <thead> (leyenda de una barra de composición): las columnas salen de la primera fila.
  const primera = Array.from(tabla.querySelector("tbody tr")?.children ?? []);
  const columnas = sinEncabezado ? primera.map(() => "") : encabezados.map(limpiar);
  const alinearDerecha = (sinEncabezado ? primera : encabezados).flatMap((c, i) => (c.classList.contains("num") ? [i] : []));
  const filas: CeldaPdf[][] = [];
  tabla.querySelectorAll("tbody tr").forEach((tr) => {
    if (tr.classList.contains("fila-vacia") || tr.querySelector("form")) return;
    const celdas = Array.from(tr.children).map(limpiar);
    // Una fila de detalle (una sola celda que ocupa todo el ancho) se agrega como nota.
    if (celdas.length === 1 && columnas.length > 1) {
      filas.push([{ content: celdas[0], colSpan: columnas.length }]);
      return;
    }
    if (celdas.some((c) => c !== "")) filas.push(celdas);
  });
  return { columnas, filas, alinearDerecha, sinEncabezado };
}

/** Indicadores (tarjetas .kpi) de la sección como tabla: indicador, valor y detalle. */
function leerIndicadores(seccion: HTMLElement): TablaPdf | null {
  const texto = (n: Element | null) => {
    if (!n) return "";
    const copia = n.cloneNode(true) as HTMLElement;
    copia.querySelectorAll("*").forEach((h) => { h.before(" "); h.after(" "); });
    return textoPdf(copia.textContent);
  };
  const filas = Array.from(seccion.querySelectorAll(".kpi")).map((k) => [
    texto(k.querySelector(".kpi-label")), texto(k.querySelector(".kpi-valor")), texto(k.querySelector(".kpi-sub")),
  ]);
  return filas.length ? { titulo: "Indicadores", columnas: ["Indicador", "Valor", "Detalle"], filas, alinearDerecha: [1] } : null;
}

/**
 * Reporte PDF de un módulo: el título y la descripción de la tarjeta, y cada tabla
 * con su subtítulo (h3 anterior). Si hay filtros, la descripción los menciona.
 */
export function exportarSeccionPdf(seccion: HTMLElement, opciones: { titulo: string; archivo: string; esPrueba?: boolean; nota?: string }) {
  const indicadores = leerIndicadores(seccion);
  const tablas: TablaPdf[] = indicadores ? [indicadores] : [];
  seccion.querySelectorAll<HTMLTableElement>("table").forEach((tabla) => {
    if (tabla.closest("[data-pdf-omitir]")) return;
    const leida = leerTablaHtml(tabla);
    if (leida.columnas.length === 0) return;
    // Subtítulo: el h3 (o summary) más cercano antes de la tabla dentro de la sección.
    let titulo: string | undefined;
    const contenedor = tabla.closest("details");
    if (contenedor) titulo = textoPdf(contenedor.querySelector("summary")?.textContent);
    else {
      const previos = Array.from(seccion.querySelectorAll("h3")).filter(
        (h) => h.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      titulo = previos.length ? textoPdf(previos[previos.length - 1].textContent) : undefined;
    }
    tablas.push({ ...leida, titulo });
  });
  const subtitulo = textoPdf(seccion.querySelector(".tarjeta-sub")?.textContent);
  const doc = generarReportePdf(opciones.titulo, subtitulo, tablas, opciones);
  doc.save(nombreArchivoPdf(opciones.archivo));
}

/** Documento con encabezado, tablas y pies (separado para poder probarlo sin DOM). */
export function generarReportePdf(
  titulo: string,
  subtitulo: string,
  tablas: TablaPdf[],
  opciones: { esPrueba?: boolean; nota?: string; emitido?: Date } = {}
): jsPDF {
  const horizontal = tablas.some((t) => t.columnas.length > 6);
  const doc = new jsPDF({ orientation: horizontal ? "landscape" : "portrait", unit: "mm", format: "a4" });
  let y = dibujarEncabezado(doc, titulo, subtitulo, opciones.esPrueba);
  if (tablas.length === 0) {
    doc.setFontSize(10);
    doc.text("No hay datos para mostrar con los filtros actuales.", MARGEN, y + 4);
  }
  for (const t of tablas) {
    if (t.titulo) {
      if (y > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(textoPdf(t.titulo), MARGEN, y + 2);
      y += 5;
    }
    const derecha = Object.fromEntries((t.alinearDerecha ?? []).map((i) => [i, { halign: "right" as const }]));
    autoTable(doc, {
      ...ESTILO_TABLA,
      startY: y,
      head: t.sinEncabezado ? undefined : [t.columnas],
      body: t.filas.length ? t.filas : [[{ content: "Sin registros.", colSpan: t.columnas.length }]],
      columnStyles: derecha,
    });
    y = ultimaY(doc, y) + 9;
  }
  dibujarPies(doc, opciones.emitido, opciones.nota);
  return doc;
}

/** Nota de venta interna (A5) de una venta registrada. */
export function generarComprobanteVenta(venta: DatosComprobante, emitido = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
  const ancho = doc.internal.pageSize.getWidth();
  let y = dibujarEncabezado(doc, `Nota de venta ${numeroComprobante(venta.id)}`, AVISO_COMPROBANTE, venta.esPrueba);

  const filas: [string, string][] = [
    ["Fecha de la venta", fechaHoraPdf(new Date(venta.registradaEn))],
    ["Comprador", venta.comprador?.trim() || "Cliente varios"],
    ["Lote de origen", `#${venta.conteoId} (conteo del ${fechaHoraPdf(new Date(venta.fechaConteo))})`],
    ["Registrado por", venta.registradaPorNombre ?? "—"],
  ];
  autoTable(doc, {
    ...ESTILO_TABLA,
    theme: "plain",
    startY: y,
    body: filas.map(([k, v]) => [textoPdf(k), textoPdf(v)]),
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 38 } },
    styles: { ...ESTILO_TABLA.styles, fontSize: 9 },
  });
  y = ultimaY(doc, y) + 5;

  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    head: [["Descripción", "Cantidad", "P. unitario", "Importe"]],
    body: [[
      `Sacos de zanahoria conformes (lote #${venta.conteoId})`,
      String(venta.cantidadSacos),
      solesPdf(venta.precioUnitario),
      solesPdf(venta.importe),
    ].map(textoPdf)],
    foot: [["", "", "TOTAL", textoPdf(solesPdf(venta.importe))]],
    footStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "right" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    styles: { ...ESTILO_TABLA.styles, fontSize: 9 },
  });
  y = ultimaY(doc, y) + 8;

  if (venta.anuladaEn) {
    doc.setTextColor(200, 40, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("VENTA ANULADA", MARGEN, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const motivo = doc.splitTextToSize(
      textoPdf(`Anulada el ${fechaHoraPdf(new Date(venta.anuladaEn))} · Motivo: ${venta.motivoAnulacion ?? "—"}`),
      ancho - 2 * MARGEN
    ) as string[];
    doc.text(motivo, MARGEN, y + 5);
    y += 5 + motivo.length * 4 + 4;
    doc.setTextColor(0, 0, 0);
  }

  // Firmas.
  const alto = doc.internal.pageSize.getHeight();
  const yFirma = Math.max(y + 18, alto - 34);
  doc.setDrawColor(120, 120, 120);
  doc.line(MARGEN + 4, yFirma, ancho / 2 - 6, yFirma);
  doc.line(ancho / 2 + 6, yFirma, ancho - MARGEN - 4, yFirma);
  doc.setFontSize(8);
  doc.text("Entregué conforme (MACROMEC)", (MARGEN + 4 + ancho / 2 - 6) / 2, yFirma + 4, { align: "center" });
  doc.text("Recibí conforme (comprador)", (ancho / 2 + 6 + ancho - MARGEN - 4) / 2, yFirma + 4, { align: "center" });

  dibujarPies(doc, emitido, numeroComprobante(venta.id));
  return doc;
}

export function descargarComprobanteVenta(venta: DatosComprobante) {
  generarComprobanteVenta(venta).save(`${numeroComprobante(venta.id)}.pdf`);
}
