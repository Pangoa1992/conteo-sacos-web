"use client";

import { useEffect, useRef, useState } from "react";
import { ETIQUETA_ESTADO_VALIDACION, type EstadoValidacion } from "@/lib/conteos";

export type DiaProduccion = {
  fecha: string; // YYYY-MM-DD (hora de la planta)
  totalSacos: number; // total detectado por la IA (suma de porEstado)
  registros: number;
  porEstado: Record<EstadoValidacion, number>; // sacos detectados según el estado del lote
};

// Orden de la pila desde la base: lo validado abajo, lo pendiente arriba.
export const ORDEN_PILA: EstadoValidacion[] = ["aprobado", "observado", "rechazado", "pendiente"];

/** Leyenda de estados: muestra de color + texto (el color nunca va solo). */
export function LeyendaEstados({ estados = ORDEN_PILA }: { estados?: EstadoValidacion[] }) {
  return (
    <ul className="leyenda" aria-label="Estado de validación">
      {estados.map((e) => (
        <li key={e}><span className={`muestra muestra-${e}`} aria-hidden="true" />{ETIQUETA_ESTADO_VALIDACION[e]}</li>
      ))}
    </ul>
  );
}

type Props = {
  dias: DiaProduccion[]; // cronológico, el último es "hoy"
  hoy: string | null;
};

// El SVG se dibuja al ancho real del contenedor (1 unidad = 1 px), así
// los textos conservan su tamaño en celulares en vez de encogerse.
const ANCHO_INICIAL = 720;
const ALTO = 240;
const ALTO_COMPACTO = 200; // contenedores angostos (celular)
const ANCHO_COMPACTO = 480;
const MARGEN = { arriba: 28, derecha: 12, abajo: 30, izquierda: 44 };
const ANCHO_MAX_COLUMNA = 24;
const RADIO = 4;
const ESPACIO_ETIQUETA_X = 52; // px mínimos por etiqueta de fecha ("24/10")
const MEDIO_TOOLTIP = 72; // si la columna está más cerca del borde, el tooltip se alinea hacia dentro
const HUECO = 2; // separación entre segmentos apilados, en el color de la superficie

const fmt = (n: number) => n.toLocaleString("es-PE");

export function etiquetaDia(fecha: string): string {
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

/** Máximo "redondo" del eje (1, 2, 5 × 10^n) y sus marcas. */
function escalaEje(max: number): number[] {
  if (max <= 0) return [0, 1];
  const pasoBruto = max / 4;
  const potencia = Math.pow(10, Math.floor(Math.log10(pasoBruto)));
  const paso = [1, 2, 5, 10].map((f) => f * potencia).find((p) => p >= pasoBruto) ?? pasoBruto;
  const marcas: number[] = [];
  for (let v = 0; v <= max + paso * 0.001; v += paso) marcas.push(Math.round(v));
  if (marcas[marcas.length - 1] < max) marcas.push(Math.round(marcas[marcas.length - 1] + paso));
  return marcas;
}

/** Columna con punta redondeada (4px, o el radio indicado) y base recta. */
function rutaColumna(x: number, y: number, w: number, h: number, radio = RADIO): string {
  const r = Math.min(radio, h, w / 2);
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/**
 * Producción diaria (sacos por día). La altura de cada columna es el total
 * detectado por la IA; los segmentos lo reparten según el estado de
 * validación de cada lote (leyenda arriba). El día actual lleva su total.
 * Tooltip en hover y en foco de teclado; la tabla equivalente está
 * siempre disponible con "Ver tabla".
 */
export function GraficoProduccion({ dias, hoy }: Props) {
  const [activo, setActivo] = useState<number | null>(null);
  const [verTabla, setVerTabla] = useState(false);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(ANCHO_INICIAL);

  useEffect(() => {
    const el = lienzoRef.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(240, Math.round(el.clientWidth)));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [verTabla]);

  const altoGrafico = ancho < ANCHO_COMPACTO ? ALTO_COMPACTO : ALTO;
  const max = Math.max(0, ...dias.map((d) => d.totalSacos));
  const marcas = escalaEje(max);
  const tope = marcas[marcas.length - 1] || 1;

  const anchoPlot = ancho - MARGEN.izquierda - MARGEN.derecha;
  const altoPlot = altoGrafico - MARGEN.arriba - MARGEN.abajo;
  const banda = anchoPlot / Math.max(dias.length, 1);
  const anchoCol = Math.min(ANCHO_MAX_COLUMNA, banda * 0.6);
  const y = (v: number) => MARGEN.arriba + altoPlot - (v / tope) * altoPlot;
  // Cada cuántos días se rotula el eje X, según el espacio disponible (hoy siempre se rotula).
  const maxEtiquetas = Math.max(2, Math.floor(anchoPlot / ESPACIO_ETIQUETA_X));
  const pasoEtiqueta = Math.ceil(dias.length / Math.min(7, maxEtiquetas));

  const sinDatos = dias.every((d) => d.registros === 0);
  const diaActivo = activo !== null ? dias[activo] : null;
  const xActivo = MARGEN.izquierda + ((activo ?? 0) + 0.5) * banda;

  return (
    <div className="grafico">
      <div className="grafico-acciones">
        <button type="button" className="btn-link" onClick={() => setVerTabla((v) => !v)} aria-pressed={verTabla}>
          {verTabla ? "Ver gráfico" : "Ver tabla"}
        </button>
      </div>
      {!verTabla && <LeyendaEstados />}

      {verTabla ? (
        <div className="tabla-scroll">
          <table className="tabla-simple">
            <thead>
              <tr>
                <th>Día</th>
                <th className="num">Detectado (IA)</th>
                {ORDEN_PILA.map((e) => <th key={e} className="num">{ETIQUETA_ESTADO_VALIDACION[e]}</th>)}
                <th className="num">Registros</th>
              </tr>
            </thead>
            <tbody>
              {[...dias].reverse().map((d) => (
                <tr key={d.fecha}>
                  <td>{etiquetaDia(d.fecha)}{d.fecha === hoy ? " (hoy)" : ""}</td>
                  <td className="num">{fmt(d.totalSacos)}</td>
                  {ORDEN_PILA.map((e) => <td key={e} className="num">{fmt(d.porEstado[e])}</td>)}
                  <td className="num">{d.registros}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grafico-lienzo" ref={lienzoRef} onPointerLeave={() => setActivo(null)}>
          {sinDatos && <p className="grafico-vacio">Sin conteos registrados en este periodo.</p>}
          <svg viewBox={`0 0 ${ancho} ${altoGrafico}`} width={ancho} height={altoGrafico} role="img" aria-label="Producción diaria de sacos, últimos días">
            {marcas.map((m) => (
              <g key={m}>
                <line x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(m)} y2={y(m)} className="eje-rejilla" />
                <text x={MARGEN.izquierda - 8} y={y(m)} className="eje-texto" textAnchor="end" dominantBaseline="middle">
                  {m >= 1000 ? `${(m / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })}K` : m}
                </text>
              </g>
            ))}

            {dias.map((d, i) => {
              const xBanda = MARGEN.izquierda + i * banda;
              const xCol = xBanda + (banda - anchoCol) / 2;
              const yCol = y(d.totalSacos);
              const esHoy = d.fecha === hoy;
              // Se cuenta hacia atrás desde hoy; se omite la vecina inmediata de "Hoy" para que no se encimen.
              const desdeHoy = dias.length - 1 - i;
              const mostrarEtiqueta = desdeHoy % pasoEtiqueta === 0 && (desdeHoy === 0 || desdeHoy >= Math.min(2, pasoEtiqueta));
              // Segmentos desde la base; solo el superior lleva la punta redondeada.
              const visibles = ORDEN_PILA.filter((e) => d.porEstado[e] > 0);
              let acumulado = 0;
              return (
                <g key={d.fecha}>
                  {activo === i && (
                    <rect x={xBanda} y={MARGEN.arriba} width={banda} height={altoPlot} className="banda-activa" />
                  )}
                  {visibles.map((e, k) => {
                    const yBase = y(acumulado);
                    acumulado += d.porEstado[e];
                    const yTope = y(acumulado);
                    const alto = Math.max(1, yBase - yTope - (k > 0 ? HUECO : 0));
                    const esTope = k === visibles.length - 1;
                    return (
                      <path
                        key={e}
                        d={rutaColumna(xCol, yTope, anchoCol, alto, esTope ? RADIO : 0)}
                        className={`segmento seg-${e}`}
                      />
                    );
                  })}
                  {esHoy && d.totalSacos > 0 && activo !== i && (
                    <text x={xCol + anchoCol / 2} y={yCol - 8} className="columna-valor" textAnchor="middle">
                      {fmt(d.totalSacos)}
                    </text>
                  )}
                  {(mostrarEtiqueta || esHoy) && (
                    <text x={xBanda + banda / 2} y={altoGrafico - 10} className={`eje-texto ${esHoy ? "eje-texto-hoy" : ""}`} textAnchor="middle">
                      {esHoy ? "Hoy" : etiquetaDia(d.fecha)}
                    </text>
                  )}
                  {/* Zona de interacción: toda la banda, mayor que la columna */}
                  <rect
                    x={xBanda}
                    y={MARGEN.arriba}
                    width={banda}
                    height={altoPlot}
                    className="columna-hit"
                    tabIndex={0}
                    aria-label={`${etiquetaDia(d.fecha)}: ${fmt(d.totalSacos)} sacos detectados en ${d.registros} registros${
                      visibles.length ? "; " + visibles.map((e) => `${ETIQUETA_ESTADO_VALIDACION[e].toLowerCase()} ${fmt(d.porEstado[e])}`).join(", ") : ""}`}
                    onPointerEnter={() => setActivo(i)}
                    onFocus={() => setActivo(i)}
                    onBlur={() => setActivo(null)}
                  />
                </g>
              );
            })}
            <line
              x1={MARGEN.izquierda}
              x2={ancho - MARGEN.derecha}
              y1={MARGEN.arriba + altoPlot}
              y2={MARGEN.arriba + altoPlot}
              className="eje-base"
            />
          </svg>

          {diaActivo && activo !== null && (
            <div
              className={`tooltip ${xActivo < MEDIO_TOOLTIP ? "tooltip-izq" : ancho - xActivo < MEDIO_TOOLTIP ? "tooltip-der" : ""}`}
              style={{
                left: `${(xActivo / ancho) * 100}%`,
                top: `${(y(diaActivo.totalSacos) / altoGrafico) * 100}%`,
              }}
              role="status"
            >
              <strong>{fmt(diaActivo.totalSacos)} sacos detectados</strong>
              <span>
                {diaActivo.fecha === hoy ? "Hoy" : etiquetaDia(diaActivo.fecha)} · {diaActivo.registros} registro
                {diaActivo.registros !== 1 ? "s" : ""}
              </span>
              {[...ORDEN_PILA].reverse().filter((e) => diaActivo.porEstado[e] > 0).map((e) => (
                <span key={e} className="tooltip-fila">
                  <span className={`muestra muestra-${e}`} aria-hidden="true" />
                  {ETIQUETA_ESTADO_VALIDACION[e]}: {fmt(diaActivo.porEstado[e])}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
