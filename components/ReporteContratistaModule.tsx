"use client";

import { useEffect, useMemo, useState } from "react";
import { ConteoObjetivo } from "./ConteoObjetivo";
import { ETIQUETA_ESTADO_VALIDACION, type EstadoValidacion } from "@/lib/conteos";
import type { TipoDato } from "@/lib/inventario";
import { LONGITUD_MAXIMA_CONTRATISTA } from "@/lib/reportes-contratista";

/** Lote que se puede elegir para el reporte. */
export type LoteParaReporte = {
  id: number;
  cantidadSacos: number;
  fechaConteo: string;
  esPrueba: boolean;
  estadoValidacion: EstadoValidacion;
  reporteVigente: { cantidadReportada: number; nombreContratista?: string | null } | null;
};

type Props = {
  lotes: LoteParaReporte[]; // los más recientes de la vista (del más reciente al más antiguo)
  tipo: TipoDato; // vista real / prueba / todos: también acota la búsqueda
  contratistas: string[]; // nombres ya usados (sugerencias)
  onRegistrado?: () => void;
};

type Busqueda = { lotes: (LoteParaReporte & { fuenteCamara: string | null })[]; pagina: number; hayMas: boolean };

const fechaCorta = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fechaLarga = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Formulario del reporte del contratista (solo personal de MACROMEC): cuántos
 * sacos dice el contratista que armó en el lote ELEGIDO. El selector trae los
 * lotes más recientes; uno anterior se busca en el servidor (paginado, sin
 * cargar todos los lotes en el navegador). Un nuevo reporte de un lote que ya
 * tenía uno pasa a ser el vigente; el anterior se conserva en el historial.
 */
export function ReporteContratistaModule({ lotes, tipo, contratistas, onRegistrado }: Props) {
  const [loteId, setLoteId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [nombre, setNombre] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  // Búsqueda de lotes anteriores
  const [texto, setTexto] = useState("");
  const [dia, setDia] = useState("");
  const [busqueda, setBusqueda] = useState<Busqueda | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [loteBuscado, setLoteBuscado] = useState<LoteParaReporte | null>(null);

  // Al cambiar de vista (real / prueba) la búsqueda anterior deja de valer.
  useEffect(() => {
    setBusqueda(null);
    setLoteBuscado(null);
  }, [tipo]);

  // El lote buscado se mantiene actualizado si también está entre los recientes.
  const opciones = useMemo(() => (loteBuscado && !lotes.some((l) => l.id === loteBuscado.id) ? [loteBuscado, ...lotes] : lotes), [lotes, loteBuscado]);

  // Por defecto, el lote más reciente; si el elegido sale de las opciones, se vuelve a ese.
  useEffect(() => {
    if (!opciones.some((l) => String(l.id) === loteId)) setLoteId(opciones[0] ? String(opciones[0].id) : "");
  }, [opciones, loteId]);

  const lote = opciones.find((l) => String(l.id) === loteId);

  async function buscar(pagina: number) {
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      const p = new URLSearchParams({ tipo, pagina: String(pagina) });
      if (texto.trim()) p.set("q", texto.trim());
      if (dia) { p.set("desde", dia); p.set("hasta", dia); }
      const res = await fetch(`/api/reportes-contratista/lotes?${p}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErrorBusqueda(data.detalles?.join(" ") || data.error || "No se pudo buscar.");
      setBusqueda({ lotes: data.lotes ?? [], pagina: data.pagina ?? pagina, hayMas: !!data.hayMas });
    } catch {
      setErrorBusqueda("Error de conexión. Intente nuevamente.");
    } finally {
      setBuscando(false);
    }
  }

  function elegir(l: LoteParaReporte) {
    setLoteBuscado(l);
    setLoteId(String(l.id));
    setMensaje(null);
  }

  async function registrarReporte(e: React.FormEvent) {
    e.preventDefault();
    if (!lote) return setMensaje({ ok: false, texto: "Elija el lote del reporte." });
    if (!/^\d+$/.test(cantidad)) return setMensaje({ ok: false, texto: "La cantidad reportada debe ser un número entero (0 o más)." });

    setRegistrando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/reportes-contratista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteoId: lote.id, cantidadReportada: Number(cantidad), nombreContratista: nombre.trim() || undefined }),
      });
      if (res.ok) {
        const diferencia = Number(cantidad) - lote.cantidadSacos;
        setCantidad("");
        if (loteBuscado?.id === lote.id) {
          setLoteBuscado({ ...loteBuscado, reporteVigente: { cantidadReportada: Number(cantidad), nombreContratista: nombre.trim() || null } });
        }
        setMensaje({
          ok: true,
          texto: `Reporte registrado en el lote #${lote.id}: ${Number(cantidad).toLocaleString("es-PE")} sacos reportados, ` +
            `${lote.cantidadSacos.toLocaleString("es-PE")} detectados por la IA (diferencia ${diferencia > 0 ? "+" : ""}${diferencia.toLocaleString("es-PE")}).`,
        });
        onRegistrado?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setMensaje({ ok: false, texto: data.error || "No se pudo registrar el reporte." });
      }
    } catch {
      setMensaje({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <div className="reporte-form">
      <h3 className="subtitulo">Registrar reporte del contratista</h3>
      <form onSubmit={registrarReporte} className="formulario" noValidate>
        <label className="campo campo-lote">
          <span>Lote</span>
          <select value={loteId} onChange={(e) => { setLoteId(e.target.value); setMensaje(null); }} disabled={opciones.length === 0}>
            {opciones.length === 0 && <option value="">No hay lotes en esta vista</option>}
            {opciones.map((l) => (
              <option key={l.id} value={l.id}>
                #{l.id} · {fechaCorta(l.fechaConteo)} · {l.cantidadSacos.toLocaleString("es-PE")} sacos IA · {ETIQUETA_ESTADO_VALIDACION[l.estadoValidacion]}
                {l.reporteVigente ? ` · ya reportado: ${l.reporteVigente.cantidadReportada}` : ""}{l.esPrueba ? " · PRUEBA" : ""}
                {l.id === loteBuscado?.id && !lotes.some((x) => x.id === l.id) ? " · (buscado)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Sacos reportados</span>
          <input type="number" inputMode="numeric" min="0" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
        </label>
        <label className="campo campo-ancho">
          <span>Contratista (opcional)</span>
          <input type="text" maxLength={LONGITUD_MAXIMA_CONTRATISTA} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" list="lista-contratistas" />
          <datalist id="lista-contratistas">{contratistas.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <button type="submit" className="btn-acento" disabled={registrando || !lote}>
          {registrando ? "Registrando…" : "Registrar reporte"}
        </button>
      </form>
      {lote && (
        <ConteoObjetivo conteo={{ id: lote.id, cantidadSacos: lote.cantidadSacos, creadoEn: lote.fechaConteo, esPrueba: lote.esPrueba }} />
      )}
      {lote?.reporteVigente && (
        <p className="tarjeta-sub">
          Este lote ya tiene un reporte vigente{lote.reporteVigente.nombreContratista ? ` de ${lote.reporteVigente.nombreContratista}` : ""}:{" "}
          {lote.reporteVigente.cantidadReportada.toLocaleString("es-PE")} sacos. El nuevo pasará a ser el vigente; el anterior se conserva en el historial.
        </p>
      )}
      {mensaje && <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>}

      <details className="buscar-lote">
        <summary>¿El lote no está en la lista? Buscar un lote anterior</summary>
        <form className="filtros" onSubmit={(e) => { e.preventDefault(); buscar(0); }} noValidate>
          <label className="filtro-fecha">
            N.º de lote o cámara
            <input type="search" className="filtro-input" value={texto} maxLength={100} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: 27 o camara_poza_1" />
          </label>
          <label className="filtro-fecha">
            Fecha del conteo
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>
          <button type="submit" className="btn-secundario" disabled={buscando}>{buscando ? "Buscando…" : "Buscar"}</button>
        </form>
        {errorBusqueda && <p className="mensaje mensaje-error" role="alert">{errorBusqueda}</p>}
        {busqueda && (
          <>
            <p className="tarjeta-sub">
              {busqueda.lotes.length === 0 ? "Ningún lote coincide con la búsqueda en esta vista." : `Página ${busqueda.pagina + 1} · ${busqueda.lotes.length} lote${busqueda.lotes.length === 1 ? "" : "s"} · del más reciente al más antiguo`}
            </p>
            {busqueda.lotes.length > 0 && (
              <ul className="lotes-encontrados">
                {busqueda.lotes.map((l) => (
                  <li key={l.id} className={l.esPrueba ? "fila-prueba" : ""}>
                    <span>
                      <strong>#{l.id}</strong> · {fechaLarga(l.fechaConteo)} · {l.cantidadSacos.toLocaleString("es-PE")} sacos IA · {ETIQUETA_ESTADO_VALIDACION[l.estadoValidacion]}
                      {l.fuenteCamara ? ` · ${l.fuenteCamara}` : ""}
                      {l.reporteVigente ? ` · ya reportado: ${l.reporteVigente.cantidadReportada}` : ""}
                      {l.esPrueba && <> <span className="badge badge-prueba">Prueba</span></>}
                    </span>
                    <button type="button" className="btn-secundario btn-chico" onClick={() => elegir(l)} disabled={String(l.id) === loteId}>
                      {String(l.id) === loteId ? "Elegido" : "Elegir"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="acciones-anulacion">
              <button type="button" className="btn-secundario btn-chico" disabled={buscando || busqueda.pagina === 0} onClick={() => buscar(busqueda.pagina - 1)}>Anteriores</button>
              <button type="button" className="btn-secundario btn-chico" disabled={buscando || !busqueda.hayMas} onClick={() => buscar(busqueda.pagina + 1)}>Siguientes</button>
            </div>
          </>
        )}
      </details>
    </div>
  );
}
