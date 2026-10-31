"use client";

import { useEffect, useState } from "react";
import { comprimirFoto } from "@/lib/compresion-foto";
import type { EstadoConteoFoto, ResultadoConteoFoto } from "@/lib/conteo-foto";

type Props = {
  visible: boolean; // el estado se consulta la primera vez que se abre el módulo
};

const porcentaje = (fraccion: number) =>
  `${(fraccion * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;

/**
 * Contar sacos en una fotografía (fase 1). Solo lo ve el personal de MACROMEC.
 * La foto se toma con la cámara del celular o se elige de la galería o del equipo,
 * se reduce en el navegador y el servidor la cuenta con RF-DETR (POST /api/contar-foto).
 * Se muestra la foto con las cajas, el total y la confianza. No se guarda nada
 * ni se crean lotes: el conteo oficial sigue siendo el del sistema de visión.
 */
export function ConteoPorFoto({ visible }: Props) {
  const [estado, setEstado] = useState<EstadoConteoFoto | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null); // URL local de la foto reducida
  const [resultado, setResultado] = useState<ResultadoConteoFoto | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || estado) return;
    let vigente = true;
    (async () => {
      try {
        const res = await fetch("/api/contar-foto", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) {
          setErrorEstado(data.error || "No se pudo consultar si el conteo por foto está disponible.");
          return;
        }
        setEstado(data);
        setErrorEstado(null);
      } catch {
        if (vigente) setErrorEstado("No se pudo consultar si el conteo por foto está disponible.");
      }
    })();
    return () => {
      vigente = false;
    };
  }, [visible, estado]);

  // Libera la imagen anterior al cambiarla o al salir del panel.
  useEffect(() => () => { if (foto) URL.revokeObjectURL(foto); }, [foto]);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir la misma foto
    if (!archivo) return;
    setError(null);
    setFoto(null);
    setResultado(null);
    setProcesando(true);
    try {
      const comprimida = await comprimirFoto(archivo);
      setFoto(URL.createObjectURL(comprimida.blob));
      const datos = new FormData();
      datos.append("foto", comprimida.blob, "foto.jpg");
      const res = await fetch("/api/contar-foto", { method: "POST", body: datos });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo contar la foto.");
        return;
      }
      setResultado(data);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Error de conexión. Intente nuevamente.");
    } finally {
      setProcesando(false);
    }
  }

  const disponible = estado?.disponible === true;
  const r = resultado;
  // Tamaño del texto de las cajas en píxeles de la imagen (se ve igual en celular y computadora).
  const letra = r ? Math.max(14, Math.round(Math.max(r.ancho, r.alto) / 55)) : 14;

  return (
    <section className="tarjeta conteo-foto" id="foto">
      <div className="tarjeta-head">
        <div>
          <h2>Contar sacos por foto</h2>
          <p className="tarjeta-sub">
            Tome una foto con el celular o elija una imagen del equipo. El modelo RF-DETR marca cada saco detectado.
            El resultado solo se muestra: no se guarda ni crea lotes.
          </p>
        </div>
      </div>

      {errorEstado && <p className="mensaje mensaje-error" role="alert">{errorEstado}</p>}
      {!estado && !errorEstado && <p className="vacio">Comprobando el servicio de detección…</p>}
      {estado && !disponible && (
        <p className="aviso aviso-info">
          El conteo por foto no está configurado en este servidor: falta la clave del servicio de detección.
        </p>
      )}

      {disponible && (
        <div className="evidencias-acciones">
          <label className={`btn-acento btn-archivo ${procesando ? "deshabilitado" : ""}`}>
            Tomar foto
            <input type="file" accept="image/*" capture="environment" onChange={alElegir} disabled={procesando} />
          </label>
          <label className={`btn-secundario btn-archivo ${procesando ? "deshabilitado" : ""}`}>
            Elegir imagen
            <input type="file" accept="image/*" onChange={alElegir} disabled={procesando} />
          </label>
          {procesando && <span className="tenue" role="status">Contando sacos…</span>}
        </div>
      )}

      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}

      {foto && (
        <div className="conteo-foto-resultado">
          <div className="conteo-foto-figura">
            <img
              src={foto}
              alt={r ? `Foto analizada: ${r.total} saco${r.total === 1 ? "" : "s"} detectado${r.total === 1 ? "" : "s"}` : "Foto en análisis"}
            />
            {r && (
              <svg viewBox={`0 0 ${r.ancho} ${r.alto}`} preserveAspectRatio="none" aria-hidden="true">
                {r.detecciones.map((d, i) => (
                  <g key={i}>
                    <rect x={d.x1} y={d.y1} width={d.x2 - d.x1} height={d.y2 - d.y1} className="conteo-foto-caja" />
                    <text x={d.x1 + 4} y={d.y1 + letra + 2} fontSize={letra} className="conteo-foto-etiqueta">
                      {i + 1} · {porcentaje(d.confianza)}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>

          {r && (
            <div className="conteo-foto-datos">
              <div className="kpi kpi-hero">
                <span className="kpi-label">Sacos detectados</span>
                <span className="kpi-valor">{r.total}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Confianza promedio</span>
                <span className="kpi-valor kpi-valor-par">
                  {r.confianzaPromedio === null ? "—" : `${r.confianzaPromedio.toLocaleString("es-PE", { maximumFractionDigits: 2 })} %`}
                </span>
                {r.confianzaMinima !== null && r.confianzaMaxima !== null && (
                  <span className="kpi-sub">De {porcentaje(r.confianzaMinima)} a {porcentaje(r.confianzaMaxima)}</span>
                )}
              </div>
              <p className="validacion-nota">
                Modelo RF-DETR · confianza mínima {porcentaje(r.umbralConfianza)} · imagen analizada {r.ancho}×{r.alto} px.
                {r.total === 0 && " No se detectaron sacos: pruebe con una foto más cercana y con buena luz."}
              </p>
              <p className="validacion-nota">
                Conteo de referencia: no se registra en el historial ni modifica el inventario. El modelo detecta sacos,
                no evalúa su calidad.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
