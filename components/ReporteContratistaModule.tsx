"use client";

import { useState } from "react";

type Props = {
  ultimoConteoId?: number;
  onRegistrado?: () => void;
};

/**
 * Módulo de reporte del contratista (Fase 2): permite ingresar cuántos
 * sacos dice el contratista que armó, para compararlo contra el conteo
 * automático y activar la alerta de discrepancia si no coinciden.
 *
 * Sin esta pantalla, la lógica de discrepancia ya construida en
 * GET /api/conteo nunca tiene con qué comparar (nunca hay un reporte
 * guardado), así que las alertas nunca se disparan de verdad.
 */
export function ReporteContratistaModule({ ultimoConteoId, onRegistrado }: Props) {
  const [cantidad, setCantidad] = useState("");
  const [nombre, setNombre] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  async function registrarReporte(e: React.FormEvent) {
    e.preventDefault();

    if (!ultimoConteoId) {
      setMensaje("No hay ningún conteo disponible todavía para comparar.");
      return;
    }

    setRegistrando(true);
    setMensaje("");

    const res = await fetch("/api/reportes-contratista", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conteoId: ultimoConteoId,
        cantidadReportada: Number(cantidad),
        nombreContratista: nombre || undefined,
      }),
    });

    if (res.ok) {
      setCantidad("");
      setNombre("");
      setMensaje("Reporte registrado. Se comparará contra el conteo automático.");
      onRegistrado?.();
    } else {
      const data = await res.json();
      setMensaje(data.error || "No se pudo registrar el reporte.");
    }
    setRegistrando(false);
  }

  return (
    <div className="ledger" style={{ marginTop: "1.25rem" }}>
      <h2>Reporte del contratista</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--paper-muted)", marginTop: "-0.5rem", marginBottom: "1rem" }}>
        Cuántos sacos dice el contratista que armó, para verificarlo contra el conteo automático.
      </p>

      <form onSubmit={registrarReporte} className="ledger-form">
        <label htmlFor="cantidad">Sacos reportados</label>
        <input
          id="cantidad"
          type="number"
          min="0"
          step="1"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          required
          style={{ width: 90 }}
        />

        <label htmlFor="nombre">Contratista (opcional)</label>
        <input
          id="nombre"
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          style={{ width: 160 }}
        />

        <button type="submit" className="btn-carrot" disabled={registrando}>
          {registrando ? "Registrando…" : "Registrar reporte del último conteo"}
        </button>
      </form>

      {mensaje && (
        <p className={`ledger-msg ${mensaje.includes("registrado") ? "ok" : "err"}`}>{mensaje}</p>
      )}
    </div>
  );
}
