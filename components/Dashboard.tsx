"use client";

import { useEffect, useState } from "react";

type Conteo = {
  id: number;
  cantidadSacos: number;
  fuenteCamara?: string | null;
  confianzaPromedio?: number | string | null;
  creadoEn: string;
};

/**
 * Dashboard simple: hace polling cada 10s a GET /api/conteo.
 * Mientras no haya cámara real ni base de datos configurada,
 * el propio endpoint devuelve datos simulados (modoSimulado: true),
 * así que este componente ya puede probarse end-to-end hoy mismo.
 */
export function Dashboard() {
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [modoSimulado, setModoSimulado] = useState(true);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    try {
      const res = await fetch("/api/conteo", { cache: "no-store" });
      const data = await res.json();
      setConteos(data.conteos ?? []);
      setModoSimulado(data.modoSimulado ?? true);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    const interval = setInterval(cargar, 10000);
    return () => clearInterval(interval);
  }, []);

  const ultimo = conteos[0];

  return (
    <div>
      {modoSimulado && (
        <div style={{ background: "#FFF4CE", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: 14 }}>
          ⚠️ Mostrando datos simulados — todavía no hay cámara ni base de datos conectada.
        </div>
      )}

      <div style={{ background: "white", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <p style={{ margin: 0, color: "#888", fontSize: 14 }}>Último conteo registrado</p>
        <p style={{ margin: 0, fontSize: 48, fontWeight: "bold", color: "#1F3864" }}>
          {cargando ? "…" : ultimo ? `${ultimo.cantidadSacos} sacos` : "Sin datos"}
        </p>
        {ultimo && (
          <p style={{ margin: 0, color: "#888", fontSize: 13 }}>
            {new Date(ultimo.creadoEn).toLocaleString("es-PE")} · Confianza del modelo: {ultimo.confianzaPromedio ?? "N/A"}%
          </p>
        )}
      </div>

      <h2 style={{ fontSize: 18, color: "#1F3864" }}>Historial reciente</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "white", borderRadius: 8, overflow: "hidden" }}>
        <thead>
          <tr style={{ background: "#1F3864", color: "white", textAlign: "left" }}>
            <th style={{ padding: "0.5rem 0.75rem" }}>Fecha</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Sacos</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Cámara</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Confianza</th>
          </tr>
        </thead>
        <tbody>
          {conteos.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem 0.75rem" }}>{new Date(c.creadoEn).toLocaleString("es-PE")}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{c.cantidadSacos}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{c.fuenteCamara ?? "—"}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{c.confianzaPromedio ?? "—"}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
