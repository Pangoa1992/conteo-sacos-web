"use client";

import { BotonPdf } from "@/components/BotonPdf";
import { useMemo, useState } from "react";
import { ETIQUETA_ESTADO_VALIDACION } from "@/lib/conteos";
import {
  etiquetaMes, mesesDisponibles, porcentaje, resumirPorMes, resumirValidacion,
  type FilaValidacion, type FilaValidacionMensual,
} from "@/lib/produccion-validada";
import { ORDEN_PILA } from "./GraficoProduccion";

export type FilaValidacionDiaria = FilaValidacion & { fecha: string };

type Periodo = "hoy" | "7d" | "14d" | "mes" | "historial";

const PERIODOS: { id: Periodo; texto: string; dias: number | null }[] = [
  { id: "hoy", texto: "Hoy", dias: 1 },
  { id: "7d", texto: "7 días", dias: 7 },
  { id: "14d", texto: "14 días", dias: 14 },
  { id: "mes", texto: "Por mes", dias: null },
  { id: "historial", texto: "Historial", dias: null },
];

type Props = {
  validacion: FilaValidacion[]; // todo el historial
  diarioPorEstado: FilaValidacionDiaria[]; // últimos días (hora de la planta)
  mensualPorEstado: FilaValidacionMensual[]; // todo el historial agrupado por mes
  hoy: string | null;
  incluir: (esPrueba: boolean) => boolean; // vista real / prueba / todos
  esVistaPrueba: boolean;
  etiquetaVista: string;
  cargando: boolean;
  /** Abre el historial filtrado por ese mes (AAAA-MM) para ver sus lotes. */
  onVerLotesMes?: (mes: string) => void;
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
 * «Por mes» consulta cualquier mes anterior y la tabla compara todos los meses.
 */
export function ProduccionValidada({
  validacion, diarioPorEstado, mensualPorEstado, hoy, incluir, esVistaPrueba, etiquetaVista, cargando, onVerLotesMes,
}: Props) {
  const [periodo, setPeriodo] = useState<Periodo>("historial");
  const [mesElegido, setMesElegido] = useState<string>("");
  const def = PERIODOS.find((p) => p.id === periodo)!;
  const meses = useMemo(() => mesesDisponibles(mensualPorEstado, hoy, incluir), [mensualPorEstado, hoy, incluir]);
  // Sin elegir, el mes actual (o el más reciente con lotes).
  const mes = meses.includes(mesElegido) ? mesElegido : meses[0] ?? "";
  const comparacion = useMemo(() => resumirPorMes(mensualPorEstado, incluir), [mensualPorEstado, incluir]);

  const r = useMemo(() => {
    if (periodo === "mes") return resumirValidacion(mensualPorEstado.filter((f) => f.mes === mes), incluir);
    if (def.dias === null) return resumirValidacion(validacion, incluir);
    if (!hoy) return resumirValidacion([], incluir);
    const desde = restarDias(hoy, def.dias - 1);
    return resumirValidacion(diarioPorEstado.filter((f) => f.fecha >= desde && f.fecha <= hoy), incluir);
  }, [validacion, diarioPorEstado, mensualPorEstado, mes, periodo, hoy, def, incluir]);

  const textoPeriodo = periodo === "mes" ? (mes ? etiquetaMes(mes) : "sin meses")
    : def.dias === null ? "todo el historial" : def.dias === 1 ? "hoy" : `últimos ${def.dias} días`;

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
            {textoPeriodo[0].toUpperCase() + textoPeriodo.slice(1)} · {etiquetaVista.toLowerCase()}
          </p>
        </div>
        <div className="acciones-exportar">
          <div className="segmentado" role="radiogroup" aria-label="Periodo de producción validada">
            {PERIODOS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={periodo === p.id}
                className={periodo === p.id ? "activo" : ""} onClick={() => setPeriodo(p.id)}>
                {p.texto}
              </button>
            ))}
          </div>
          {periodo === "mes" && (
            <label className="filtro-fecha">
              Mes
              <select value={mes} onChange={(e) => setMesElegido(e.target.value)}>
                {meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
              </select>
            </label>
          )}
          {periodo === "mes" && mes && onVerLotesMes && (
            <button type="button" className="btn-secundario" onClick={() => onVerLotesMes(mes)}>Ver lotes del mes</button>
          )}
          <BotonPdf seccionId="validada" titulo={`Producción validada · ${textoPeriodo}`}
            archivo={periodo === "mes" && mes ? `produccion-validada-${mes}` : "produccion-validada"} esPrueba={esVistaPrueba} />
        </div>
      </div>

      <div className="val-kpis">
        <div className="kpi">
          <span className="kpi-label">Detectado por la IA</span>
          <span className="kpi-valor">{v(total)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{lotes(r.detectado.registros)} en el periodo</span>
        </div>
        <div className="kpi kpi-validada">
          <span className="kpi-label">Producción validada</span>
          <span className="kpi-valor">{v(aprobado.sacos)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{fmtPct(porcentaje(aprobado.sacos, total))} del detectado</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Sacos conformes</span>
          <span className="kpi-valor">{v(cls.conformes)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{sumaClasificacion > 0 ? `${fmtPct(porcentaje(cls.conformes, sumaClasificacion))} de lo validado` : "sin lotes aprobados"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pendientes de validar</span>
          <span className="kpi-valor">{v(r.porEstado.pendiente.sacos)}<span className="kpi-unidad">sacos</span></span>
          <span className="kpi-sub">{lotes(r.porEstado.pendiente.registros)}</span>
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
          <span aria-hidden="true">✓</span> Totales cuadrados: los cuatro estados suman los {fmt(total)} sacos detectados.
        </p>
      ) : (
        <p className="nota-critica" role="alert">
          <span aria-hidden="true">⚠</span> Los totales no cuadran (estados {fmt(sumaEstados)} de {fmt(total)}; clasificación {fmt(sumaClasificacion)} de {fmt(aprobado.sacos)}). Revise los datos.
        </p>
      ))}

      <div className="comparacion-meses">
        <h3>Comparación mes a mes</h3>
        {comparacion.length === 0 ? (
          <p className="vacio">Todavía no hay lotes en esta vista.</p>
        ) : (
          <div className="tabla-scroll">
            <table className="historial">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="num">Lotes</th>
                  <th className="num">Detectado por la IA</th>
                  <th className="num">Producción validada</th>
                  <th className="num">% validado</th>
                  <th className="num">Conformes</th>
                  <th className="num">Pendientes</th>
                  <th aria-label="Acción"></th>
                </tr>
              </thead>
              <tbody>
                {comparacion.map((m) => (
                  <tr key={m.mes} className={periodo === "mes" && m.mes === mes ? "fila-seleccionada" : ""}>
                    <td data-label="Mes" className="fuerte">{etiquetaMes(m.mes)}</td>
                    <td data-label="Lotes" className="num">{fmt(m.detectado.registros)}</td>
                    <td data-label="Detectado" className="num">{fmt(m.detectado.sacos)}</td>
                    <td data-label="Validada" className="num fuerte">{fmt(m.porEstado.aprobado.sacos)}</td>
                    <td data-label="% validado" className="num">{fmtPct(porcentaje(m.porEstado.aprobado.sacos, m.detectado.sacos))}</td>
                    <td data-label="Conformes" className="num">{fmt(m.clasificacionAprobados.conformes)}</td>
                    <td data-label="Pendientes" className="num">{lotes(m.porEstado.pendiente.registros)}</td>
                    <td data-label="">
                      <button type="button" className="btn-link" onClick={() => { setPeriodo("mes"); setMesElegido(m.mes); }}>Ver mes</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="tarjeta-sub">
        Solo los lotes aprobados suman a la producción validada. La IA cuenta los sacos; la clasificación la registra el personal.
      </p>
    </section>
  );
}
