"use client";

import { useEffect, useState } from "react";

type Venta = {
  id: number;
  conteoId: number;
  cantidadSacos: number | null;
  precioPorSaco: string | number | null;
  totalVenta: string | number | null;
  confirmada: boolean;
  creadoEn: string;
};

type Props = {
  ultimoConteoId?: number;
};

/**
 * Módulo de venta (Fase 1, requerimiento N°3): permite registrar una
 * venta a partir de un conteo, y muestra el historial de ventas.
 * Solo visible para personal de MACROMEC (admin_macromec).
 */
export function VentasModule({ ultimoConteoId }: Props) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [precio, setPrecio] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  async function cargarVentas() {
    const res = await fetch("/api/ventas", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setVentas(data.ventas ?? []);
    }
  }

  useEffect(() => {
    cargarVentas();
  }, []);

  async function registrarVenta(e: React.FormEvent) {
    e.preventDefault();
    if (!ultimoConteoId) {
      setMensaje("No hay ningún conteo disponible para vender todavía.");
      return;
    }

    setRegistrando(true);
    setMensaje("");

    const res = await fetch("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteoId: ultimoConteoId, precioPorSaco: Number(precio) }),
    });

    if (res.ok) {
      setPrecio("");
      setMensaje("Venta registrada correctamente.");
      cargarVentas();
    } else {
      const data = await res.json();
      setMensaje(data.error || "No se pudo registrar la venta.");
    }
    setRegistrando(false);
  }

  return (
    <div style={{ background: "white", borderRadius: 12, padding: "1.5rem", marginTop: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
      <h2 style={{ fontSize: 18, color: "#1F3864", marginTop: 0 }}>💰 Módulo de venta</h2>

      <form onSubmit={registrarVenta} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
        <label style={{ fontSize: 14, color: "#555" }}>Precio por saco (S/):</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          required
          style={{ padding: "0.4rem", border: "1px solid #ddd", borderRadius: 6, width: 100 }}
        />
        <button
          type="submit"
          disabled={registrando}
          style={{ padding: "0.4rem 1rem", background: "#1F3864", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          {registrando ? "Registrando..." : "Registrar venta del último conteo"}
        </button>
      </form>

      {mensaje && <p style={{ fontSize: 13, color: mensaje.includes("correctamente") ? "#2e7d32" : "#c0392b" }}>{mensaje}</p>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f0f2f5", textAlign: "left" }}>
            <th style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>Fecha</th>
            <th style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>Sacos</th>
            <th style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>Precio/saco</th>
            <th style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {ventas.map((v) => (
            <tr key={v.id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>{new Date(v.creadoEn).toLocaleString("es-PE")}</td>
              <td style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>{v.cantidadSacos ?? "—"}</td>
              <td style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>S/ {v.precioPorSaco ?? "—"}</td>
              <td style={{ padding: "0.4rem 0.6rem", fontSize: 13 }}>S/ {v.totalVenta ?? "—"}</td>
            </tr>
          ))}
          {ventas.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: "0.6rem", fontSize: 13, color: "#999", textAlign: "center" }}>
                Aún no hay ventas registradas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
