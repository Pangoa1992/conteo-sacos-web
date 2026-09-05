"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { VentasModule } from "./VentasModule";

type Conteo = {
  id: number;
  cantidadSacos: number;
  fuenteCamara?: string | null;
  confianzaPromedio?: number | string | null;
  creadoEn: string;
  reporteContratista?: { cantidadReportada: number; nombreContratista?: string | null } | null;
  discrepancia?: boolean;
};

type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "admin_macromec" | "cliente";
};

/**
 * Dashboard principal: hace polling cada 10s a GET /api/conteo.
 * Muestra el usuario logueado, alertas de discrepancia, y (solo para
 * personal de MACROMEC) el módulo de ventas.
 */
export function Dashboard() {
  const router = useRouter();
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [modoSimulado, setModoSimulado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState<Usuario | null>(null);

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

  async function cargarUsuario() {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();
    setUsuario(data.usuario);
  }

  async function cerrarSesion() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    cargar();
    cargarUsuario();
    const interval = setInterval(cargar, 10000);
    return () => clearInterval(interval);
  }, []);

  const ultimo = conteos[0];
  const hayDiscrepancias = conteos.some((c) => c.discrepancia);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontSize: 14, color: "#555" }}>
          {usuario ? (
            <>👤 {usuario.nombre} <span style={{ color: "#999" }}>({usuario.rol === "admin_macromec" ? "Personal MACROMEC" : "Dueño de fábrica"})</span></>
          ) : (
            "Cargando usuario..."
          )}
        </div>
        {usuario && (
          <button onClick={cerrarSesion} style={{ fontSize: 13, background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "0.3rem 0.8rem", cursor: "pointer" }}>
            Cerrar sesión
          </button>
        )}
      </div>

      {modoSimulado && (
        <div style={{ background: "#FFF4CE", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: 14 }}>
          ⚠️ Mostrando datos simulados — todavía no hay cámara ni base de datos conectada.
        </div>
      )}

      {hayDiscrepancias && (
        <div style={{ background: "#FDECEA", color: "#c0392b", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: 14 }}>
          🚨 Hay discrepancia entre el conteo automático y lo reportado por el contratista en al menos un registro.
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
            <th style={{ padding: "0.5rem 0.75rem" }}>Sacos (auto)</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Cámara</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Confianza</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Contratista</th>
          </tr>
        </thead>
        <tbody>
          {conteos.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid #eee", background: c.discrepancia ? "#FDECEA" : undefined }}>
              <td style={{ padding: "0.5rem 0.75rem" }}>{new Date(c.creadoEn).toLocaleString("es-PE")}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{c.cantidadSacos}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{c.fuenteCamara ?? "—"}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{c.confianzaPromedio ?? "—"}%</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                {c.reporteContratista
                  ? `${c.reporteContratista.cantidadReportada} sacos${c.discrepancia ? " ⚠️" : ""}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {usuario?.rol === "admin_macromec" && <VentasModule ultimoConteoId={ultimo?.id} />}
    </div>
  );
}
