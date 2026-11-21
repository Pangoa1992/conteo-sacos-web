"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EstadoWhatsapp as Estado } from "@/lib/estado-whatsapp";
import {
  ETIQUETA_RESULTADO_MENSAJE, ETIQUETA_TIPO_MENSAJE, estadoFoto, type MensajeWhatsapp,
} from "@/lib/bitacora-whatsapp";

type Props = {
  recarga?: unknown; // cambia cuando el dashboard actualiza sus datos
  onRegistrado?: () => void; // tras registrar una foto como lote se recarga el panel
};

const URL_PUBLICA: Record<Estado["urlPublica"], string> = {
  https: "configurada (HTTPS)",
  no_https: "configurada sin HTTPS: Twilio exige HTTPS",
  no_configurada: "no configurada",
};

const fmt = (n: number) => n.toLocaleString("es-PE");
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });

function Fila({ ok, titulo, detalle }: { ok: boolean; titulo: string; detalle: string }) {
  return (
    <li className="fuente">
      <span className={`estado-punto ${ok ? "estado-ok" : "estado-desconocido"}`} aria-hidden="true" />
      <div className="fuente-info">
        <span className="fuente-nombre-texto">{titulo}</span>
        <span className="fuente-meta">{detalle}</span>
      </div>
    </li>
  );
}

/** Quién envió el mensaje: el nombre del contacto autorizado, o su número enmascarado. */
function Remitente({ m }: { m: MensajeWhatsapp }) {
  return m.contacto
    ? <>{m.contacto} <span className="tenue mono">{m.remitente}</span></>
    : <span className="mono">{m.remitente}</span>;
}

/** Foto pendiente en la bandeja: el personal la registra como lote o la descarta. */
function FotoBandeja({ m, onCambio }: { m: MensajeWhatsapp; onCambio: () => void }) {
  const [tipo, setTipo] = useState<"real" | "prueba">(m.demo ? "prueba" : "real");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(accion: "registrar" | "descartar") {
    if (accion === "descartar" && !window.confirm("¿Descartar esta foto? Seguirá en la bitácora, pero no se registrará como lote.")) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/mensajes/${m.id}/${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accion === "registrar" ? { tipo } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo completar la acción.");
        return;
      }
      onCambio();
    } catch {
      setError("Error de conexión. Intente nuevamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <li className="bandeja-foto">
      <a href={`/api/whatsapp/mensajes/${m.id}/foto`} target="_blank" rel="noopener noreferrer" title="Ver la foto completa">
        <img src={`/api/whatsapp/mensajes/${m.id}/foto`} alt={`Foto n.º ${m.id} recibida por WhatsApp`} loading="lazy" width={160} height={120} />
      </a>
      <div className="bandeja-info">
        <span className="fuerte">{fmt(m.sacos ?? 0)} sacos contados por la IA</span>
        <span className="tenue">
          n.º {m.id} · {fechaHora(m.recibidoEn)} · <Remitente m={m} />
          {m.confianzaPromedio !== null && <> · confianza {m.confianzaPromedio.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %</>}
          {m.demo && <> · <span className="badge badge-prueba">DEMO</span></>}
        </span>
        <div className="bandeja-acciones">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "real" | "prueba")} disabled={m.demo || enviando} aria-label="Tipo de dato">
            <option value="real">Dato real</option>
            <option value="prueba">Dato de prueba</option>
          </select>
          <button type="button" className="btn-acento" disabled={enviando} onClick={() => enviar("registrar")}>
            {enviando ? "Guardando…" : "Registrar como lote"}
          </button>
          <button type="button" className="btn-secundario" disabled={enviando} onClick={() => enviar("descartar")}>Descartar</button>
        </div>
        {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      </div>
    </li>
  );
}

/**
 * Módulo WhatsApp (solo personal de MACROMEC): cómo funciona, estado de la configuración,
 * fotos recibidas (bandeja) y bitácora de mensajes. Nunca muestra el token, los números
 * completos ni la URL pública.
 */
export function EstadoWhatsapp({ recarga, onRegistrado }: Props) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<MensajeWhatsapp[] | null>(null);
  const [errorBitacora, setErrorBitacora] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/estado", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) {
          setError(data.error || "No se pudo consultar el estado de WhatsApp.");
          return;
        }
        setEstado(data);
        setError(null);
      } catch {
        if (vigente) setError("No se pudo consultar el estado de WhatsApp.");
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/mensajes", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) {
          setErrorBitacora(data.error || "No se pudo leer la bitácora de WhatsApp.");
          return;
        }
        setMensajes(data.mensajes ?? []);
        setErrorBitacora(null);
      } catch {
        if (vigente) setErrorBitacora("No se pudo leer la bitácora de WhatsApp.");
      }
    })();
    return () => {
      vigente = false;
    };
  }, [recarga, version]);

  const alCambiar = useCallback(() => {
    setVersion((v) => v + 1);
    onRegistrado?.();
  }, [onRegistrado]);

  const pendientes = useMemo(() => (mensajes ?? []).filter((m) => estadoFoto(m) === "pendiente"), [mensajes]);
  const resumen = useMemo(() => {
    const desde = Date.now() - 30 * 24 * 3600_000;
    const recientes = (mensajes ?? []).filter((m) => new Date(m.recibidoEn).getTime() >= desde);
    const autorizados = recientes.filter((m) => m.tipo !== "no_autorizado" && m.tipo !== "sin_lista");
    return {
      mensajes: recientes.length,
      personas: new Set(autorizados.map((m) => m.contacto ?? m.remitente)).size,
      fotos: recientes.filter((m) => m.tipo === "foto").length,
      lotes: recientes.filter((m) => m.conteoId !== null).length,
      rechazados: recientes.filter((m) => m.tipo === "no_autorizado").length,
    };
  }, [mensajes]);
  const visibles = verTodos ? mensajes ?? [] : (mensajes ?? []).slice(0, 15);

  const e = estado;
  const numeros = e ? `${e.numerosAutorizados} número${e.numerosAutorizados === 1 ? "" : "s"} autorizado${e.numerosAutorizados === 1 ? "" : "s"}` : "";

  return (
    <section className="tarjeta" id="whatsapp">
      <div className="tarjeta-head">
        <div>
          <h2>Consultas por WhatsApp</h2>
          <p className="tarjeta-sub">
            Quién lo usa, qué consulta y adónde van los datos.
          </p>
        </div>
      </div>

      {/* ---- Cómo funciona ---- */}
      <div className="flujo-whatsapp">
        <h3>¿Cómo funciona?</h3>
        <ol className="flujo-pasos">
          <li>
            <span className="fuerte">Quién lo usa</span>
            Solo los celulares que MACROMEC autoriza (supervisor, jefe de planta, cliente). Otros números no reciben información.
          </li>
          <li>
            <span className="fuerte">Qué envía</span>
            Un comando (<span className="mono">hoy</span>, <span className="mono">semana</span>, <span className="mono">mes octubre</span>,{" "}
            <span className="mono">lote 123</span>, <span className="mono">discrepancias</span>) o una foto de los sacos.
          </li>
          <li>
            <span className="fuerte">Quién lo recibe</span>
            Twilio lo reenvía a este servidor con firma digital; lo que no viene firmado se rechaza.
          </li>
          <li>
            <span className="fuerte">De dónde sale la respuesta</span>
            De la base de datos del sistema (solo lotes reales). Las fotos las cuenta la misma IA (RF-DETR) del panel.
          </li>
          <li>
            <span className="fuerte">Adónde van los datos</span>
            Cada mensaje queda en la bitácora. Las fotos con sacos llegan a «Fotos recibidas», donde el personal las registra como lote o las descarta.
          </li>
        </ol>
      </div>

      {/* ---- Estado de la configuración ---- */}
      <h3>Estado de la configuración</h3>
      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      {!e && !error && <p className="vacio">Consultando el estado…</p>}
      {e && (
        <>
          {e.modoDemo && (
            <p className="aviso aviso-prueba">
              Modo DEMO activo: WhatsApp responde con los lotes de prueba de la demostración y cada respuesta va marcada
              «🧪 DEMO · datos de prueba». No son datos de producción.
            </p>
          )}
          <ul className="fuentes estado-whatsapp">
            <Fila ok={e.webhookHabilitado} titulo="Webhook de Twilio"
              detalle={e.webhookHabilitado ? "habilitado (con verificación de firma)" : "deshabilitado: falta configurar el token de Twilio"} />
            <Fila ok={e.urlPublica === "https"} titulo="URL pública" detalle={URL_PUBLICA[e.urlPublica]} />
            <Fila ok={e.numerosAutorizados > 0} titulo="Números autorizados"
              detalle={e.numerosAutorizados > 0
                ? numeros + (e.entradasNoValidas > 0 ? ` · ${e.entradasNoValidas} entrada${e.entradasNoValidas === 1 ? "" : "s"} no válida${e.entradasNoValidas === 1 ? "" : "s"} (se ignora${e.entradasNoValidas === 1 ? "" : "n"})` : "")
                : "ninguno: nadie recibe información" + (e.entradasNoValidas > 0 ? ` (${e.entradasNoValidas} entrada${e.entradasNoValidas === 1 ? "" : "s"} no válida${e.entradasNoValidas === 1 ? "" : "s"})` : "")} />
            <Fila ok={e.hayConteosReales === true || e.modoDemo} titulo="Datos para responder"
              detalle={e.modoDemo ? "lotes de prueba de la demostración (modo DEMO)"
                : e.hayConteosReales === null ? "no se pudo consultar"
                : e.hayConteosReales ? "hay conteos reales" : "no hay conteos reales: WhatsApp responderá que no hay datos"} />
          </ul>
        </>
      )}

      {errorBitacora && <p className="mensaje mensaje-error" role="alert">{errorBitacora}</p>}
      {mensajes && (
        <>
          {/* ---- Uso en los últimos 30 días ---- */}
          <h3>Uso en los últimos 30 días</h3>
          <div className="val-kpis">
            <div className="kpi"><span className="kpi-label">Mensajes</span><span className="kpi-valor">{fmt(resumen.mensajes)}</span>
              <span className="kpi-sub">de {fmt(resumen.personas)} persona{resumen.personas === 1 ? "" : "s"} autorizada{resumen.personas === 1 ? "" : "s"}</span></div>
            <div className="kpi"><span className="kpi-label">Fotos recibidas</span><span className="kpi-valor">{fmt(resumen.fotos)}</span>
              <span className="kpi-sub">{fmt(resumen.lotes)} registrada{resumen.lotes === 1 ? "" : "s"} como lote</span></div>
            <div className="kpi"><span className="kpi-label">Fotos por revisar</span><span className="kpi-valor">{fmt(pendientes.length)}</span>
              <span className="kpi-sub">en la bandeja</span></div>
            <div className="kpi"><span className="kpi-label">Números rechazados</span><span className="kpi-valor">{fmt(resumen.rechazados)}</span>
              <span className="kpi-sub">intentos sin autorización</span></div>
          </div>

          {/* ---- Bandeja de fotos ---- */}
          <h3>Fotos recibidas por revisar</h3>
          {pendientes.length === 0
            ? <p className="vacio">No hay fotos pendientes. Las fotos con sacos que lleguen por WhatsApp aparecerán aquí.</p>
            : <ul className="bandeja">{pendientes.map((m) => <FotoBandeja key={m.id} m={m} onCambio={alCambiar} />)}</ul>}

          {/* ---- Bitácora ---- */}
          <h3>Bitácora de mensajes</h3>
          <div className="tabla-scroll">
            <table className="historial">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Quién</th>
                  <th>Qué pidió</th>
                  <th>Resultado</th>
                  <th>Destino de los datos</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => {
                  const ef = estadoFoto(m);
                  return (
                    <tr key={m.id} className={m.demo ? "fila-prueba" : ""}>
                      <td data-label="Fecha">{fechaHora(m.recibidoEn)}</td>
                      <td data-label="Quién"><Remitente m={m} /></td>
                      <td data-label="Qué pidió">
                        {ETIQUETA_TIPO_MENSAJE[m.tipo] ?? m.tipo}
                        {m.sacos !== null && <> · {fmt(m.sacos)} sacos</>}
                        {m.demo && <> <span className="badge badge-prueba">DEMO</span></>}
                      </td>
                      <td data-label="Resultado">
                        <span className={`badge ${m.resultado === "respondido" ? "badge-ok" : m.resultado === "error" ? "badge-critico" : ""}`}>
                          {ETIQUETA_RESULTADO_MENSAJE[m.resultado]}
                        </span>
                      </td>
                      <td data-label="Destino" className="tenue">
                        {ef === "registrada" ? <>Lote #{m.conteoId} (registrado por {m.revisadoPorNombre ?? "—"})</>
                          : ef === "descartada" ? <>Foto descartada por {m.revisadoPorNombre ?? "—"}</>
                          : ef === "pendiente" ? "Foto en la bandeja, por revisar"
                          : m.tipo === "foto" ? "Foto sin sacos o no contada: no se guardó"
                          : m.resultado === "rechazado" ? "No se entregó información"
                          : "Solo consulta (no cambia datos)"}
                      </td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr className="fila-vacia"><td colSpan={5}>Todavía no llegó ningún mensaje por WhatsApp.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {mensajes.length > 15 && (
            <button type="button" className="btn-secundario" onClick={() => setVerTodos((v) => !v)}>
              {verTodos ? "Ver menos" : `Ver todos (${fmt(mensajes.length)})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
