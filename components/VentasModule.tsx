"use client";

import { useEffect, useState } from "react";
import { ConteoObjetivo, type ConteoResumido } from "./ConteoObjetivo";

type Venta = {
  id: number;
  conteoId: number;
  cantidadSacos: number | null;
  precioPorSaco: string | number | null;
  totalVenta: string | number | null;
  confirmada: boolean;
  creadoEn: string;
  esPrueba?: boolean;
};

type Props = {
  conteo?: ConteoResumido; // último conteo de la vista actual
};

const soles = (v: string | number | null) =>
  v === null || v === "" ? "—" : `S/ ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function VentasModule({ conteo }: Props) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [precio, setPrecio] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

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
    if (!conteo) {
      setMensaje({ ok: false, texto: "No hay ningún conteo disponible para vender todavía." });
      return;
    }

    setRegistrando(true);
    setMensaje(null);

    try {
      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteoId: conteo.id, precioPorSaco: Number(precio) }),
      });

      if (res.ok) {
        setPrecio("");
        setMensaje({ ok: true, texto: "Venta registrada." });
        cargarVentas();
      } else {
        const data = await res.json().catch(() => ({}));
        setMensaje({ ok: false, texto: data.error || "No se pudo registrar la venta." });
      }
    } catch {
      setMensaje({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setRegistrando(false);
    }
  }

  const precioNum = Number(precio);
  const totalEstimado = conteo && precio && precioNum > 0 ? precioNum * conteo.cantidadSacos : null;

  return (
    <section className="tarjeta" id="ventas">
      <div className="tarjeta-head">
        <div>
          <h2>Registro de venta</h2>
          <p className="tarjeta-sub">El total se calcula con los sacos del conteo seleccionado.</p>
        </div>
      </div>

      <ConteoObjetivo conteo={conteo} />

      <form onSubmit={registrarVenta} className="formulario">
        <label className="campo">
          <span>Precio por saco (S/)</span>
          <input type="number" step="0.01" min="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} required />
        </label>
        {totalEstimado !== null && (
          <p className="total-estimado">Total: <strong>{soles(totalEstimado)}</strong></p>
        )}
        <button type="submit" className="btn-acento" disabled={registrando || !conteo}>
          {registrando ? "Registrando…" : "Registrar venta"}
        </button>
      </form>

      {mensaje && <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>}

      <div className="tabla-scroll">
        <table className="historial">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Conteo</th>
              <th className="num">Sacos</th>
              <th className="num">Precio/saco</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} className={v.esPrueba ? "fila-prueba" : ""}>
                <td data-label="Fecha">{new Date(v.creadoEn).toLocaleString("es-PE")}</td>
                <td data-label="Conteo">#{v.conteoId} {v.esPrueba && <span className="badge badge-prueba">Prueba</span>}</td>
                <td data-label="Sacos" className="num">{v.cantidadSacos?.toLocaleString("es-PE") ?? "—"}</td>
                <td data-label="Precio/saco" className="num">{soles(v.precioPorSaco)}</td>
                <td data-label="Total" className="num fuerte">{soles(v.totalVenta)}</td>
              </tr>
            ))}
            {ventas.length === 0 && (
              <tr className="fila-vacia">
                <td colSpan={5}>Aún no hay ventas registradas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
