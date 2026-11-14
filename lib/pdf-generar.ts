/**
 * Generación de los PDF en el navegador. Este módulo se carga solo al pulsar
 * «Exportar PDF» o «Comprobante» (import dinámico), así jsPDF no pesa en la
 * carga inicial del panel. El diseño (colores, franjas, tarjetas) está en lib/pdf.ts.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AVISO_COMPROBANTE,
  COLOR,
  ESTILO_TABLA,
  MARGEN,
  dibujarEncabezado,
  dibujarEncabezadoContinuacion,
  dibujarIndicadores,
  dibujarPies,
  dibujarTituloSeccion,
  fechaHoraPdf,
  nombreArchivoPdf,
  numeroComprobante,
  solesPdf,
  textoPdf,
  type DatosComprobante,
  type IndicadorPdf,
} from "./pdf";

/** Celda: texto, o una nota que ocupa todo el ancho de la fila (detalle de una venta anulada). */
export type CeldaPdf = string | { content: string; colSpan: number };
export type TablaPdf = { titulo?: string; columnas: string[]; filas: CeldaPdf[][]; alinearDerecha?: number[]; sinEncabezado?: boolean };
export type OpcionesReporte = { esPrueba?: boolean; nota?: string; emitido?: Date; indicadores?: IndicadorPdf[] };

const ultimaY = (doc: jsPDF, porDefecto: number) =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? porDefecto;

/** Texto de un elemento del panel, con un espacio entre sus partes ("Aprobado" + "128 conf."). */
function textoElemento(n: Element | null, quitar = ""): string {
  if (!n) return "";
  const copia = n.cloneNode(true) as HTMLElement;
  if (quitar) copia.querySelectorAll(quitar).forEach((h) => h.remove());
  copia.querySelectorAll("*").forEach((h) => { h.before(" "); h.after(" "); });
  return textoPdf(copia.textContent);
}

/** Lee una tabla HTML del panel: encabezados, filas visibles y columnas numéricas. */
export function leerTablaHtml(tabla: HTMLTableElement): TablaPdf {
  // Botones, formularios y campos no forman parte del dato. La etiqueta "Prueba" de cada
  // fila se omite: el encabezado del PDF ya dice DATOS DE PRUEBA.
  const limpiar = (celda: Element) => textoElemento(celda, "button, form, input, select, textarea, .badge-prueba, [data-pdf-omitir]");
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

/** Indicadores (tarjetas .kpi) de la sección: etiqueta, valor y detalle. */
export function leerIndicadores(seccion: HTMLElement): IndicadorPdf[] {
  return Array.from(seccion.querySelectorAll(".kpi")).map((k) => ({
    etiqueta: textoElemento(k.querySelector(".kpi-label")),
    valor: textoElemento(k.querySelector(".kpi-valor")),
    detalle: textoElemento(k.querySelector(".kpi-sub")),
    destacado: k.classList.contains("kpi-validada"),
  }));
}

/**
 * Reporte PDF de un módulo: el título y la descripción de la tarjeta, sus indicadores
 * y cada tabla con su subtítulo (h3 anterior), tal como se ven con los filtros activos.
 */
export function exportarSeccionPdf(
  seccion: HTMLElement,
  opciones: { titulo: string; archivo: string; esPrueba?: boolean; nota?: string; indicadores?: IndicadorPdf[] }
) {
  const tablas: TablaPdf[] = [];
  seccion.querySelectorAll<HTMLTableElement>("table").forEach((tabla) => {
    if (tabla.closest("[data-pdf-omitir]")) return;
    const leida = leerTablaHtml(tabla);
    if (leida.columnas.length === 0) return;
    let titulo: string | undefined;
    const contenedor = tabla.closest("details");
    if (contenedor) titulo = textoPdf(contenedor.querySelector("summary")?.textContent);
    else {
      const previos = Array.from(seccion.querySelectorAll("h3")).filter(
        (h) => h.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      // Sin el texto tenue de alcance («· mismo alcance que…»).
      titulo = previos.length ? textoElemento(previos[previos.length - 1], ".tenue") : undefined;
    }
    tablas.push({ ...leida, titulo });
  });
  const subtitulo = textoPdf(seccion.querySelector(".tarjeta-sub")?.textContent);
  const indicadores = [...(opciones.indicadores ?? []), ...leerIndicadores(seccion)];
  const doc = generarReportePdf(opciones.titulo, subtitulo, tablas, { ...opciones, indicadores });
  doc.save(nombreArchivoPdf(opciones.archivo));
}

/** Documento con encabezado, indicadores, tablas y pies (separado para poder probarlo sin DOM). */
export function generarReportePdf(titulo: string, subtitulo: string, tablas: TablaPdf[], opciones: OpcionesReporte = {}): jsPDF {
  const horizontal = tablas.some((t) => t.columnas.length > 6);
  const doc = new jsPDF({ orientation: horizontal ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const emitido = opciones.emitido ?? new Date();
  const altoPagina = doc.internal.pageSize.getHeight();
  let y = dibujarEncabezado(doc, titulo, subtitulo, opciones.esPrueba, { tipo: "Reporte", emitido });
  y = dibujarIndicadores(doc, opciones.indicadores ?? [], y + 1);

  if (tablas.length === 0 && !(opciones.indicadores ?? []).length) {
    doc.setFontSize(10);
    doc.setTextColor(...COLOR.texto2);
    doc.text("No hay datos para mostrar con los filtros actuales.", MARGEN, y + 4);
  }
  for (const t of tablas) {
    if (y > altoPagina - 45) {
      doc.addPage();
      y = 20;
    }
    if (t.titulo) y = dibujarTituloSeccion(doc, t.titulo, y + 2);
    const derecha = Object.fromEntries((t.alinearDerecha ?? []).map((i) => [i, { halign: "right" as const }]));
    autoTable(doc, {
      ...ESTILO_TABLA,
      startY: y,
      head: t.sinEncabezado ? undefined : [t.columnas],
      body: t.filas.length ? t.filas : [[{ content: "Sin registros.", colSpan: t.columnas.length }]],
      columnStyles: { ...(t.sinEncabezado ? { 0: { fontStyle: "bold" as const } } : {}), ...derecha },
      // Filas de detalle (nota de ancho completo): en cursiva y gris.
      didParseCell: (d) => {
        if (d.section === "body" && (d.cell.colSpan ?? 1) > 1) {
          d.cell.styles.fontStyle = "italic";
          d.cell.styles.textColor = COLOR.texto2;
        }
      },
      // Franja delgada en las páginas que agrega la tabla.
      didDrawPage: (d) => {
        if (d.pageNumber > 1) dibujarEncabezadoContinuacion(doc, titulo);
      },
    });
    y = ultimaY(doc, y) + 8;
  }
  dibujarPies(doc, emitido, opciones.nota);
  return doc;
}

/** Nota de venta interna (A5) de una venta registrada. */
export function generarComprobanteVenta(venta: DatosComprobante, emitido = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  let y = dibujarEncabezado(doc, "Nota de venta", undefined, venta.esPrueba, { tipo: "Documento interno", emitido });

  // Recuadro con el número y la fecha, como un talonario.
  const anchoCaja = 52;
  doc.setDrawColor(...COLOR.naranja);
  doc.setLineWidth(0.6);
  doc.roundedRect(ancho - MARGEN - anchoCaja, y - 1, anchoCaja, 15, 1.5, 1.5, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.tenue);
  doc.text("N.° DE NOTA", ancho - MARGEN - anchoCaja / 2, y + 3.5, { align: "center" });
  doc.setFontSize(13);
  doc.setTextColor(...COLOR.naranja);
  doc.text(numeroComprobante(venta.id), ancho - MARGEN - anchoCaja / 2, y + 10.5, { align: "center" });

  // Datos de la venta a la izquierda del recuadro.
  const datos: [string, string][] = [
    ["Fecha", fechaHoraPdf(new Date(venta.registradaEn))],
    ["Comprador", venta.comprador?.trim() || "Cliente varios"],
    ["Lote", `#${venta.conteoId} · conteo del ${fechaHoraPdf(new Date(venta.fechaConteo))}`],
    ["Atendió", venta.registradaPorNombre ?? "—"],
  ];
  autoTable(doc, {
    ...ESTILO_TABLA,
    theme: "plain",
    startY: y + 18,
    body: datos.map(([k, v]) => [textoPdf(k).toUpperCase(), textoPdf(v)]),
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 24, textColor: COLOR.tenue, fontSize: 7 } },
    styles: { ...ESTILO_TABLA.styles, fontSize: 9, cellPadding: { top: 1.4, bottom: 1.4, left: 0, right: 2 } },
  });
  y = ultimaY(doc, y) + 6;

  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    head: [["Descripción", "Cant.", "P. unitario", "Importe"]],
    body: [[
      `Sacos de zanahoria conformes (lote #${venta.conteoId})`,
      String(venta.cantidadSacos),
      solesPdf(venta.precioUnitario),
      solesPdf(venta.importe),
    ].map(textoPdf)],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    styles: { ...ESTILO_TABLA.styles, fontSize: 8.5 },
  });
  y = ultimaY(doc, y) + 4;

  // Total destacado.
  const anchoTotal = 60;
  doc.setFillColor(...COLOR.marino);
  doc.roundedRect(ancho - MARGEN - anchoTotal, y, anchoTotal, 11, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("TOTAL", ancho - MARGEN - anchoTotal + 4, y + 7);
  doc.setFontSize(12);
  doc.text(textoPdf(solesPdf(venta.importe)), ancho - MARGEN - 4, y + 7.4, { align: "right" });
  y += 18;

  if (venta.anuladaEn) {
    // Sello diagonal y explicación.
    doc.saveGraphicsState();
    doc.setGState(new (doc as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 0.18 }) as never);
    doc.setTextColor(...COLOR.critico);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(46);
    doc.text("ANULADA", ancho / 2, alto / 2 + 10, { align: "center", angle: 30 });
    doc.restoreGraphicsState();
    doc.setFillColor(...COLOR.criticoFondo);
    doc.setDrawColor(...COLOR.critico);
    doc.setLineWidth(0.3);
    const motivo = doc.splitTextToSize(
      textoPdf(`Anulada el ${fechaHoraPdf(new Date(venta.anuladaEn))} · Motivo: ${venta.motivoAnulacion ?? "—"}`),
      ancho - 2 * MARGEN - 8
    ) as string[];
    const h = 9 + motivo.length * 3.8;
    doc.roundedRect(MARGEN, y, ancho - 2 * MARGEN, h, 1.5, 1.5, "FD");
    doc.setTextColor(...COLOR.critico);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("VENTA ANULADA", MARGEN + 4, y + 5.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(motivo, MARGEN + 4, y + 10);
    y += h + 6;
  }

  // Firmas.
  const yFirma = Math.max(y + 16, alto - 42);
  doc.setDrawColor(...COLOR.tenue);
  doc.setLineWidth(0.3);
  doc.line(MARGEN + 4, yFirma, ancho / 2 - 6, yFirma);
  doc.line(ancho / 2 + 6, yFirma, ancho - MARGEN - 4, yFirma);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR.texto2);
  doc.text("Entregué conforme (MACROMEC)", (MARGEN + 4 + ancho / 2 - 6) / 2, yFirma + 4, { align: "center" });
  doc.text("Recibí conforme (comprador)", (ancho / 2 + 6 + ancho - MARGEN - 4) / 2, yFirma + 4, { align: "center" });

  // Aviso tributario al pie, en una banda gris.
  doc.setFillColor(...COLOR.superficie2);
  doc.rect(MARGEN, alto - 27, ancho - 2 * MARGEN, 10, "F");
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.texto2);
  doc.text(doc.splitTextToSize(textoPdf(AVISO_COMPROBANTE), ancho - 2 * MARGEN - 6) as string[], ancho / 2, alto - 23, { align: "center" });

  dibujarPies(doc, emitido, numeroComprobante(venta.id));
  return doc;
}

export function descargarComprobanteVenta(venta: DatosComprobante) {
  generarComprobanteVenta(venta).save(`${numeroComprobante(venta.id)}.pdf`);
}

