"use client";

import { useEffect, useState } from "react";

type Tabla = { tabla: string; descripcion: string; registros: number };
type Descarga = { id: number; creadoEn: string; registros: number; bytes: number; sha256: string; usuario: string };
type Estado = { tablas: Tabla[]; historial: Descarga[] | null; historialDisponible: boolean };

const fmt = (n: number) => n.toLocaleString("es-PE");
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });
const tamano = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Días entre una fecha y hoy, en palabras. */
function hace(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`;
}

/**
 * Respaldo (solo administrador): descarga un ZIP con un CSV por tabla, manifiesto
 * con huellas y LEEME. Muestra qué se respalda y quién descargó los últimos. Solo
 * lectura: restaurar lo hace el técnico (no el panel), para no arriesgar los datos.
 */
export function RespaldoModule() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  async function cargar() {
    try {
      const res = await fetch("/api/respaldo", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "No se pudo cargar el estado del respaldo.");
      setEstado(data);
      setError(null);
    } catch {
      setError("Error de conexión al cargar el estado del respaldo.");
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function descargar() {
    setDescargando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/respaldo?descargar=1", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMensaje({ ok: false, texto: data.error || "No se pudo generar el respaldo." });
        return;
      }
      const nombre = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "respaldo-macromec.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
      const registros = Number(res.headers.get("x-respaldo-registros"));
      setMensaje({ ok: true, texto: `Respaldo descargado: ${nombre} (${fmt(registros)} registros). Guárdelo fuera de esta computadora (USB o nube).` });
      cargar();
    } catch {
      setMensaje({ ok: false, texto: "Error de conexión al descargar. Intente nuevamente." });
    } finally {
      setDescargando(false);
    }
  }

  const total = estado?.tablas.reduce((s, t) => s + t.registros, 0) ?? 0;
  const ultimo = estado?.historial?.[0] ?? null;

  return (
    <section className="tarjeta" id="respaldo">
      <div className="tarjeta-head">
        <div>
          <h2>Respaldo de la información</h2>
          <p className="tarjeta-sub">
            Descarga una copia de todos los datos del sistema · un archivo ZIP con una hoja CSV por tabla (se abre con Excel) ·
            no incluye contraseñas ni las imágenes de las evidencias
          </p>
        </div>
        <button type="button" className="btn-acento" onClick={descargar} disabled={descargando || !estado}>
          {descargando ? "Generando respaldo…" : "Descargar respaldo"}
        </button>
      </div>

      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      {mensaje && <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>}

      <div className="val-kpis">
        <div className="kpi kpi-validada">
          <span className="kpi-label">Último respaldo</span>
          <span className="kpi-valor">{ultimo ? hace(ultimo.creadoEn) : estado?.historialDisponible === false ? "—" : "Nunca"}</span>
          <span className="kpi-sub">{ultimo ? `${fecha(ultimo.creadoEn)} · ${ultimo.usuario}` : "descargue uno ahora"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Registros a respaldar</span>
          <span className="kpi-valor">{estado ? fmt(total) : "—"}</span>
          <span className="kpi-sub">en {estado?.tablas.length ?? "—"} tablas</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Respaldo automático</span>
          <span className="kpi-valor kpi-valor-texto">En la nube</span>
          <span className="kpi-sub">la base de datos (Neon) guarda copias por su cuenta</span>
        </div>
      </div>

      <h3 className="subtitulo">Qué incluye</h3>
      <div className="tabla-scroll">
        <table className="historial">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Contenido</th>
              <th className="num">Registros</th>
            </tr>
          </thead>
          <tbody>
            {(estado?.tablas ?? []).map((t) => (
              <tr key={t.tabla}>
                <td data-label="Archivo"><code>{t.tabla}.csv</code></td>
                <td data-label="Contenido">{t.descripcion}</td>
                <td data-label="Registros" className="num">{fmt(t.registros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="subtitulo">Últimas descargas</h3>
      {estado?.historialDisponible === false ? (
        <p className="vacio">El historial de descargas se activa cuando se aplique la actualización de la base de datos (migración 0009). La descarga ya funciona.</p>
      ) : !estado?.historial?.length ? (
        <p className="vacio">Todavía no se ha descargado ningún respaldo.</p>
      ) : (
        <div className="tabla-scroll">
          <table className="historial">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descargó</th>
                <th className="num">Registros</th>
                <th className="num">Tamaño</th>
                <th>Huella SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {estado.historial.map((d) => (
                <tr key={d.id}>
                  <td data-label="Fecha">{fecha(d.creadoEn)}</td>
                  <td data-label="Descargó">{d.usuario}</td>
                  <td data-label="Registros" className="num">{fmt(d.registros)}</td>
                  <td data-label="Tamaño" className="num">{tamano(d.bytes)}</td>
                  <td data-label="Huella"><code title={d.sha256}>{d.sha256.slice(0, 16)}…</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="tarjeta-sub respaldo-nota">
        Restaurar no se hace desde el panel, para no arriesgar los datos: el técnico carga los CSV en la base de datos
        siguiendo el LEEME incluido en el ZIP. El manifiesto trae la huella de cada archivo para comprobar que no se modificó.
      </p>
    </section>
  );
}
