"use client";

import { useMemo, useState } from "react";
import { ETIQUETA_ESTADO_VALIDACION } from "@/lib/conteos";
import { porcentaje, resumirValidacion, type FilaValidacion } from "@/lib/produccion-validada";
import { ORDEN_PILA } from "./GraficoProduccion";

export type FilaValidacionDiaria = FilaValidacion & { fecha: string };

type Periodo = "hoy" | "7d" | "14d" | "historial";

const PERIODOS: { id: Periodo; texto: string; dias: number | null }[] = [
  { id: "hoy", texto: "Hoy", dias: 1 },
  { id: "7d", texto: "7 días", dias: 7 },
  { id: "14d", texto: "14 días", dias: 14 },
  { id: "historial", texto: "Historial", dias: null },
];

type Props = {
  validacion: FilaValidacion[]; // todo el historial
  diarioPorEstado: FilaValidacionDiaria[]; // últimos días (hora de la planta)
  hoy: string | null;
  incluir: (esPrueba: boolean) => boolean; // vista real / prueba / todos
  esVistaPrueba: boolean;
  etiquetaVista: string;
  cargando: boolean;
};

type Parte = { clave: string; etiqueta: string; sacos: number; lotes?: number };

const fmt = (n: number) => n.toLocaleString("es-PE");
const fmtPct = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`);
const lotes = (n: number) => `${fmt(n)} lote${n === 1 ? "" : "s"}`;

/** Resta n días a una fecha YYYY-MM-DD (sin depender de la zona del navegador). */
function restarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Barra de composición (parte de un todo) con su leyenda-tabla: cada parte
 * lleva muestra de color, nombre, sacos, lotes y porcentaje escritos, así el
 * color nunca es la única señal.
 */
function Composicion({ titulo, partes, total, vacio }: { titulo: string; partes: Parte[]; total: number; vacio: string }) {
  return (
    <div className="composicion">
      <h3>{titulo}</h3>
      <div className="barra-composicion" role="img" aria-label={
        total > 0 ? `${titulo}: ${partes.map((p) => `${p.etiqueta} ${fmt(p.sacos)}`).join(", ")}` : `${titulo}: ${vacio}`}>
        {total > 0
          ? partes.filter((p) => p.sacos > 0).map((p) => (
              <span
                key={p.clave}
                className={`barra-seg muestra-${p.clave}`}
                style={{ flexGrow: p.sacos }}
                title={`${p.etiqueta}: ${fmt(p.sacos)} sacos (${fmtPct(porcentaje(p.sacos, total))})`}
              />
            ))
          : <span className="barra-vacia">{vacio}</span>}
      </div>
      <table className="tabla-composicion">
        <tbody>
          {partes.map((p) => (
            <tr key={p.clave}>
              <th scope="row"><span className={`muestra muestra-${p.clave}`} aria-hidden="true" />{p.etiqueta}</th>
              <td className="num fuerte">{fmt(p.sacos)} <span className="tenue">sacos</span></td>
              {p.lotes !== undefined && <td className="num tenue">{lotes(p.lotes)}</td>}
              <td className="num">{fmtPct(porcentaje(p.sacos, total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Producción validada: reparte el total detectado por la IA según el estado
 * de validación de cada lote y muestra la clasificación manual de los lotes
 * aprobados. Los lotes se ubican en el periodo por la fecha del conteo.
 */
export function ProduccionValidada({ validacion, diarioPorEstado, hoy, incluir, esVistaPrueba, etiquetaVista, cargando }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>("historial");
  const def = PERIODOS.find((p) => p.id === periodo)!;

  const r = useMemo(() => {
    if (def.dias === null) return resumirValidacion(validacion, incluir);
    if (!hoy) return resumirValidacion([], incluir);
    const desde = restarDias(hoy, def.dias - 1);
    return resumirValidacion(diarioPorEstado.filter((f) => f.fecha >= desde && f.fecha <= hoy), incluir);
  }, [validacion, diarioPorEstado, hoy, def, incluir]);

  const total = r.detectado.sacos;
  const aprobado = r.porEstado.aprobado;
  const cls = r.clasificacionAprobados;
  const sumaEstados = ORDEN_PILA.reduce((s, e) => s + r.porEstado[e].sacos, 0);
  const sumaClasificacion = cls.conformes + cls.observados + cls.defectuosos;
  const v = (n: number) => (cargando ? "—" : fmt(n));

  return (
    <section className="tarjeta" id="validada">
      <div className="tarjeta-head">
        <div>
          <h2>Producción validada {esVistaPrueba && <span className="badge badge-prueba" title="Dato de prueba: no es una detección real">Prueba</span>}</h2>
          <p className="tarjeta-sub">
            Lotes revisados por el personal · {def.dias === null ? "todo el historial" : def.dias === 1 ? "hoy" : `últimos ${def.dias} días`} · por fecha del conteo · {etiquetaVista.toLowerCase()}
          </p>
        </div>
        <div className="segmentado" role="radiogroup" aria-label="Periodo de producción validada">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={periodo === p.id}
              className={periodo === p.id ? "activo" : ""} onClick={() => setPeriodo(p.id)}>
              {p.texto}
            </button>
          ))}
        </div>
      </div>

      <div className="val-kpis">
        <div className="kpi">
          <span className="kpi-label">Detectado por la IA</span>
          <span className="kpi-valor">{v(total)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{lotes(r.detectado.registros)} · total original, sin modificar</span>
        </div>
        <div className="kpi kpi-validada">
          <span className="kpi-label">Producción validada</span>
          <span className="kpi-valor">{v(aprobado.sacos)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{lotes(aprobado.registros)} aprobado{aprobado.registros === 1 ? "" : "s"} · {fmtPct(porcentaje(aprobado.sacos, total))} del detectado</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Sacos conformes</span>
          <span className="kpi-valor">{v(cls.conformes)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{fmtPct(porcentaje(cls.conformes, sumaClasificacion))} de la producción validada</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pendientes de validar</span>
          <span className="kpi-valor">{v(r.porEstado.pendiente.sacos)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{lotes(r.porEstado.pendiente.registros)} sin revisar</span>
        </div>
      </div>

      <div className="composiciones">
        <Composicion
          titulo="Estado de validación del total detectado"
          total={total}
          vacio="Sin lotes en este periodo"
          partes={ORDEN_PILA.map((e) => ({ clave: e, etiqueta: ETIQUETA_ESTADO_VALIDACION[e], sacos: r.porEstado[e].sacos, lotes: r.porEstado[e].registros }))}
        />
        <Composicion
          titulo="Clasificación manual de los lotes aprobados"
          total={sumaClasificacion}
          vacio="Ningún lote aprobado en este periodo"
          partes={[
            { clave: "conforme", etiqueta: "Conformes", sacos: cls.conformes },
            { clave: "observado-fisico", etiqueta: "Observados", sacos: cls.observados },
            { clave: "defectuoso", etiqueta: "Defectuosos", sacos: cls.defectuosos },
          ]}
        />
      </div>

      {!cargando && (sumaEstados === total && sumaClasificacion === aprobado.sacos ? (
        <p className="nota-comprobacion">
          <span aria-hidden="true">✓</span> Aprobados + observados + rechazados + pendientes = {fmt(total)} sacos detectados por la IA.
          La clasificación de los aprobados suma {fmt(sumaClasificacion)} sacos.
        </p>
      ) : (
        <p className="nota-critica" role="alert">
          <span aria-hidden="true">⚠</span> Los totales no cuadran (estados {fmt(sumaEstados)} de {fmt(total)}; clasificación {fmt(sumaClasificacion)} de {fmt(aprobado.sacos)}). Revise los datos.
        </p>
      ))}
      <p className="tarjeta-sub">
        Los lotes observados o rechazados conservan su conteo original, pero no suman a la producción validada.
        La clasificación por estado físico la registra el personal al revisar el lote: el modelo de visión solo cuenta sacos.
      </p>
    </section>
  );
}
