"use client";

import { useEffect, useState } from "react";
import {
  ETIQUETA_ESTADO_VALIDACION,
  LONGITUD_MAXIMA_OBSERVACION,
  erroresValidacion,
  type ClasificacionManual,
  type EstadoValidacion,
} from "@/lib/conteos";

export type DatosValidacion = {
  id: number;
  cantidadSacos: number;
  discrepancia?: boolean;
  estadoValidacion?: EstadoValidacion;
  sacosConformes?: number | null;
  sacosObservados?: number | null;
  sacosDefectuosos?: number | null;
  validadoPorNombre?: string | null;
  validadoEn?: string | null;
  observacionValidacion?: string | null;
};

type Revision = {
  id: number;
  estadoAnterior: EstadoValidacion;
  estado: EstadoValidacion;
  sacosConformes: number | null;
  sacosObservados: number | null;
  sacosDefectuosos: number | null;
  observacion: string | null;
  usuarioNombre: string | null;
  creadoEn: string;
};

type Props = {
  conteo: DatosValidacion;
  esAdmin: boolean;
  onValidado?: () => void;
};

const fmt = (n: number) => n.toLocaleString("es-PE");

export function BadgeValidacion({ estado }: { estado?: EstadoValidacion }) {
  const e = estado ?? "pendiente";
  return <span className={`badge badge-val-${e}`}>{ETIQUETA_ESTADO_VALIDACION[e]}</span>;
}

const cantidadCon = (n: number, singular: string) => `${fmt(n)} ${singular}${n === 1 ? "" : "s"}`;

function textoClasificacion(c: { sacosConformes?: number | null; sacosObservados?: number | null; sacosDefectuosos?: number | null }) {
  if (c.sacosConformes == null) return null;
  return [
    cantidadCon(c.sacosConformes, "conforme"),
    cantidadCon(c.sacosObservados ?? 0, "observado"),
    cantidadCon(c.sacosDefectuosos ?? 0, "defectuoso"),
  ].join(" · ");
}

/** Campo numérico vacío = sin dato; nunca se rellena con un valor supuesto. */
function aEntero(v: string): number | null {
  return /^\d+$/.test(v) ? Number(v) : null;
}

/**
 * Validación de un conteo por el personal de MACROMEC: estado vigente,
 * clasificación manual por estado físico e historial de revisiones.
 * El formulario solo se muestra al rol admin_macromec; el servidor vuelve a
 * comprobar el rol y las mismas reglas (lib/conteos.ts) y la BD las impone con CHECK.
 */
export function ValidacionConteo({ conteo, esAdmin, onValidado }: Props) {
  const estadoActual = conteo.estadoValidacion ?? "pendiente";
  const [historial, setHistorial] = useState<Revision[] | null>(null);
  const [errorHistorial, setErrorHistorial] = useState(false);

  const [estado, setEstado] = useState<Exclude<EstadoValidacion, "pendiente">>("aprobado");
  const [conformes, setConformes] = useState("");
  const [observados, setObservados] = useState("");
  const [defectuosos, setDefectuosos] = useState("");
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; textos: string[] } | null>(null);

  async function cargarHistorial() {
    try {
      const res = await fetch(`/api/conteo/${conteo.id}/validacion`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHistorial(data.historial ?? []);
      setErrorHistorial(false);
    } catch {
      setErrorHistorial(true);
    }
  }

  useEffect(() => {
    cargarHistorial();
  }, [conteo.id, estadoActual, conteo.validadoEn]);

  const camposClasificacion = [conformes, observados, defectuosos];
  const algunaCantidad = camposClasificacion.some((v) => v !== "");
  const valores = camposClasificacion.map(aEntero);
  const clasificacion: ClasificacionManual | null =
    algunaCantidad && valores.every((v) => v !== null)
      ? { conformes: valores[0]!, observados: valores[1]!, defectuosos: valores[2]! }
      : null;
  const suma = valores.reduce<number>((s, v) => s + (v ?? 0), 0);
  const usaClasificacion = estado !== "rechazado";

  function todosConformes() {
    setConformes(String(conteo.cantidadSacos));
    setObservados("0");
    setDefectuosos("0");
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    const obs = observacion.trim();
    const clasif = usaClasificacion ? clasificacion : null;

    const errores: string[] = [];
    if (usaClasificacion && algunaCantidad && !clasificacion) {
      errores.push("Complete las tres cantidades con números enteros (0 si no hay sacos en esa categoría).");
    }
    errores.push(
      ...erroresValidacion({
        estado,
        clasificacion: clasif,
        observacion: obs,
        cantidadSacos: conteo.cantidadSacos,
        conDiscrepancia: !!conteo.discrepancia,
      })
    );
    if (errores.length > 0) {
      setMensaje({ ok: false, textos: errores });
      return;
    }

    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch(`/api/conteo/${conteo.id}/validacion`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, clasificacion: clasif, observacion: obs || null, estadoEsperado: estadoActual }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMensaje({ ok: true, textos: [`Conteo #${conteo.id} marcado como ${ETIQUETA_ESTADO_VALIDACION[estado].toLowerCase()}.`] });
        setConformes("");
        setObservados("");
        setDefectuosos("");
        setObservacion("");
        onValidado?.();
      } else {
        setMensaje({ ok: false, textos: data.errores ?? [data.error || "No se pudo registrar la validación."] });
      }
    } catch {
      setMensaje({ ok: false, textos: ["Error de conexión. Intente nuevamente."] });
    } finally {
      setEnviando(false);
    }
  }

  const clasificacionVigente = textoClasificacion(conteo);

  return (
    <div className="validacion">
      <div className="validacion-head">
        <h3>Validación del conteo</h3>
        <BadgeValidacion estado={estadoActual} />
      </div>

      {estadoActual === "pendiente" ? (
        <p className="validacion-texto tenue">Ninguna persona ha revisado todavía este conteo.</p>
      ) : (
        <dl className="detalle-grid">
          <div><dt>Revisado por</dt><dd>{conteo.validadoPorNombre ?? "—"}</dd></div>
          <div><dt>Fecha de revisión</dt><dd>{conteo.validadoEn ? new Date(conteo.validadoEn).toLocaleString("es-PE") : "—"}</dd></div>
          <div><dt>Clasificación manual</dt><dd>{clasificacionVigente ?? <span className="tenue">Sin clasificar</span>}</dd></div>
          <div><dt>Observación</dt><dd>{conteo.observacionValidacion || <span className="tenue">—</span>}</dd></div>
        </dl>
      )}
      <p className="validacion-nota">
        La clasificación por estado físico (conforme, observado, defectuoso) la registra el personal de planta al revisar el lote.
        El modelo de visión solo cuenta sacos: no evalúa su calidad.
      </p>

      {esAdmin && (
        <form onSubmit={registrar} className="validacion-form">
          <fieldset className="validacion-estados">
            <legend>{estadoActual === "pendiente" ? "Resultado de la revisión" : "Corregir la validación"}</legend>
            {(["aprobado", "observado", "rechazado"] as const).map((op) => (
              <label key={op} className={`opcion-estado ${estado === op ? "activa" : ""}`}>
                <input type="radio" name={`estado-${conteo.id}`} value={op} checked={estado === op} onChange={() => setEstado(op)} />
                {ETIQUETA_ESTADO_VALIDACION[op]}
              </label>
            ))}
          </fieldset>

          {usaClasificacion ? (
            <fieldset className="validacion-clasificacion">
              <legend>
                Clasificación manual · {estado === "aprobado" ? "obligatoria" : "opcional"} · total del conteo {fmt(conteo.cantidadSacos)} sacos
              </legend>
              <div className="formulario">
                <label className="campo">
                  <span>Conformes</span>
                  <input type="number" min="0" step="1" inputMode="numeric" value={conformes} onChange={(e) => setConformes(e.target.value)} />
                </label>
                <label className="campo">
                  <span>Observados</span>
                  <input type="number" min="0" step="1" inputMode="numeric" value={observados} onChange={(e) => setObservados(e.target.value)} />
                </label>
                <label className="campo">
                  <span>Defectuosos</span>
                  <input type="number" min="0" step="1" inputMode="numeric" value={defectuosos} onChange={(e) => setDefectuosos(e.target.value)} />
                </label>
                <button type="button" className="btn-secundario" onClick={todosConformes}>Todos conformes</button>
              </div>
              {algunaCantidad && (
                <p className={`validacion-suma ${suma === conteo.cantidadSacos ? "suma-ok" : "suma-error"}`} aria-live="polite">
                  Suma: {fmt(suma)} de {fmt(conteo.cantidadSacos)} sacos
                  {suma !== conteo.cantidadSacos && " — debe coincidir con el total del conteo"}
                </p>
              )}
            </fieldset>
          ) : (
            <p className="validacion-texto tenue">Un conteo rechazado no lleva clasificación.</p>
          )}

          <label className="campo campo-bloque">
            <span>
              Observación{" "}
              {estado !== "aprobado" ? "(obligatoria)" : conteo.discrepancia ? "(obligatoria: hay discrepancia con el contratista)" : "(opcional)"}
            </span>
            <textarea
              rows={2}
              maxLength={LONGITUD_MAXIMA_OBSERVACION}
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              placeholder="Motivo, diferencias encontradas, sacos dañados…"
            />
          </label>

          <button type="submit" className="btn-acento" disabled={enviando}>
            {enviando ? "Registrando…" : "Registrar validación"}
          </button>
        </form>
      )}

      {mensaje && (
        <div className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">
          {mensaje.textos.length === 1 ? mensaje.textos[0] : <ul>{mensaje.textos.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>
      )}

      <div className="validacion-historial">
        <h4>Historial de revisiones</h4>
        {errorHistorial ? (
          <p className="mensaje mensaje-error">No se pudo cargar el historial.</p>
        ) : historial === null ? (
          <p className="tenue">Cargando…</p>
        ) : historial.length === 0 ? (
          <p className="tenue">Sin revisiones registradas.</p>
        ) : (
          <ol>
            {historial.map((h) => (
              <li key={h.id}>
                <span className="tenue">{new Date(h.creadoEn).toLocaleString("es-PE")}</span> · {h.usuarioNombre ?? "—"}:{" "}
                {ETIQUETA_ESTADO_VALIDACION[h.estadoAnterior]} → <BadgeValidacion estado={h.estado} />
                {textoClasificacion(h) && <> · {textoClasificacion(h)}</>}
                {h.observacion && <> · «{h.observacion}»</>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
