"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { VentasModule } from "./VentasModule";
import { ReporteContratistaModule } from "./ReporteContratistaModule";

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

function tiempoRelativo(fechaISO: string): string {
  const diffMs = Date.now() - new Date(fechaISO).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(fechaISO).toLocaleDateString("es-PE");
}

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
  const totalHoy = conteos.reduce((sum, c) => sum + c.cantidadSacos, 0);
  const confianzaProm =
    conteos.length > 0
      ? Math.round(conteos.reduce((s, c) => s + Number(c.confianzaPromedio || 0), 0) / conteos.length)
      : 0;

  return (
    <div className="shell">
      <div className="topbar">
        <div className="plant-id">
          <Image src="/logo-macromec.png" alt="MACROMEC" width={32} height={32} className="brand-mark" />
          <div>
            <div className="name">Conteo de Sacos</div>
            <div className="sub">MACROMEC J&S S.A.C. · Lavadero de zanahorias</div>
          </div>
        </div>
        <div className="session">
          {usuario ? (
            <>
              <span className="who">{usuario.nombre}</span>
              <span className="role-tag">{usuario.rol === "admin_macromec" ? "Planta" : "Cliente"}</span>
              <button onClick={cerrarSesion} className="btn-quiet">Salir</button>
            </>
          ) : (
            <span>Cargando…</span>
          )}
        </div>
      </div>

      {modoSimulado && (
        <div className="banner banner-caution">
          Mostrando datos simulados — cámara y modelo de conteo aún no conectados en definitivo.
        </div>
      )}

      {hayDiscrepancias && (
        <div className="banner banner-alert">
          Discrepancia detectada entre el conteo automático y el reporte del contratista en al menos un registro.
        </div>
      )}

      <div className="readout">
        <p className="readout-label">Último conteo registrado</p>
        <p className="readout-value">
          {cargando ? "—" : ultimo ? ultimo.cantidadSacos : "0"}
          <span className="unit">sacos</span>
        </p>
        <div className="readout-meta">
          <span>{ultimo ? tiempoRelativo(ultimo.creadoEn) : "sin registros aún"}</span>
          {ultimo && <span>confianza <b>{ultimo.confianzaPromedio ?? "—"}%</b></span>}
          <span>total en el registro <b>{totalHoy}</b> sacos</span>
          {conteos.length > 0 && <span>confianza media <b>{confianzaProm}%</b></span>}
        </div>
      </div>

      <div className="section-head">
        <h2>Historial reciente</h2>
        <span className="count">{conteos.length} registro{conteos.length !== 1 ? "s" : ""}</span>
      </div>

      <table className="manifest">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Sacos</th>
            <th>Cámara / origen</th>
            <th>Confianza</th>
            <th>Contratista</th>
          </tr>
        </thead>
        <tbody>
          {conteos.map((c) => (
            <tr key={c.id} className={c.discrepancia ? "flagged" : ""}>
              <td data-label="Hora" className="muted">{new Date(c.creadoEn).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</td>
              <td data-label="Sacos" className="num">{c.cantidadSacos}</td>
              <td data-label="Origen" className="muted">{c.fuenteCamara ?? "—"}</td>
              <td data-label="Confianza">{c.confianzaPromedio ?? "—"}%</td>
              <td data-label="Contratista">
                {c.reporteContratista ? (
                  <>
                    {c.reporteContratista.cantidadReportada}{" "}
                    {c.discrepancia && <span className="tag tag-flag">discrepancia</span>}
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
          {conteos.length === 0 && (
            <tr className="empty-row">
              <td colSpan={5}>Todavía no hay conteos registrados.</td>
            </tr>
          )}
        </tbody>
      </table>

      {usuario?.rol === "admin_macromec" && (
        <>
          <ReporteContratistaModule ultimoConteoId={ultimo?.id} onRegistrado={cargar} />
          <VentasModule ultimoConteoId={ultimo?.id} />
        </>
      )}
    </div>
  );
}
