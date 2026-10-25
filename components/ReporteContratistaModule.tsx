"use client";

import { useState } from "react";
import { ConteoObjetivo, type ConteoResumido } from "./ConteoObjetivo";

type Props = {
  conteo?: ConteoResumido; // último conteo de la vista actual
  onRegistrado?: () => void;
};

/**
 * Módulo de reporte del contratista: permite ingresar cuántos sacos dice
 * el contratista que armó, para compararlo contra el conteo automático y
 * activar la alerta de discrepancia si no coinciden.
 *
 * Sin esta pantalla, la lógica de discrepancia de GET /api/conteo nunca
 * tiene con qué comparar (nunca hay un reporte guardado).
 */
export function ReporteContratistaModule({ conteo, onRegistrado }: Props) {
  const [cantidad, setCantidad] = useState("");
  const [nombre, setNombre] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  async function registrarReporte(e: React.FormEvent) {
    e.preventDefault();

    if (!conteo) {
      setMensaje({ ok: false, texto: "No hay ningún conteo disponible todavía para comparar." });
      return;
    }

    setRegistrando(true);
    setMensaje(null);

    try {
      const res = await fetch("/api/reportes-contratista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conteoId: conteo.id,
          cantidadReportada: Number(cantidad),
          nombreContratista: nombre || undefined,
        }),
      });

      if (res.ok) {
        setCantidad("");
        setNombre("");
        setMensaje({ ok: true, texto: "Reporte registrado. Se comparará contra el conteo automático." });
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
    <section className="tarjeta" id="contratistas">
      <div className="tarjeta-head">
        <div>
          <h2>Reporte del contratista</h2>
          <p className="tarjeta-sub">Cuántos sacos dice el contratista que armó, para verificarlo contra el conteo automático.</p>
        </div>
      </div>

      <ConteoObjetivo conteo={conteo} />

      <form onSubmit={registrarReporte} className="formulario">
        <label className="campo">
          <span>Sacos reportados</span>
          <input type="number" min="0" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
        </label>
        <label className="campo campo-ancho">
          <span>Contratista (opcional)</span>
          <input type="text" maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
        </label>
        <button type="submit" className="btn-acento" disabled={registrando || !conteo}>
          {registrando ? "Registrando…" : "Registrar reporte"}
        </button>
      </form>

      {mensaje && (
        <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>
      )}
    </section>
  );
}
