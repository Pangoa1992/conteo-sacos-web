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
      setMensaje("Venta registrada.");
      cargarVentas();
    } else {
      const data = await res.json();
      setMensaje(data.error || "No se pudo registrar la venta.");
    }
    setRegistrando(false);
  }

  return (
    <div className="ledger">
      <h2>Registro de venta</h2>

      <form onSubmit={registrarVenta} className="ledger-form">
        <label htmlFor="precio">Precio por saco (S/)</label>
        <input
          id="precio"
          type="number"
          step="0.01"
          min="0"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          required
        />
        <button type="submit" className="btn-carrot" disabled={registrando}>
          {registrando ? "Registrando…" : "Registrar venta del último conteo"}
        </button>
      </form>

      {mensaje && <p className={`ledger-msg ${mensaje.includes("registrada") ? "ok" : "err"}`}>{mensaje}</p>}

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Sacos</th>
            <th>Precio/saco</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {ventas.map((v) => (
            <tr key={v.id}>
              <td>{new Date(v.creadoEn).toLocaleString("es-PE")}</td>
              <td className="num">{v.cantidadSacos ?? "—"}</td>
              <td className="num">S/ {v.precioPorSaco ?? "—"}</td>
              <td className="num">S/ {v.totalVenta ?? "—"}</td>
            </tr>
          ))}
          {ventas.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "var(--paper-muted)", fontStyle: "italic" }}>
                Aún no hay ventas registradas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
