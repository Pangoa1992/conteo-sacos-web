"use client";

import { useEffect, useState } from "react";
import { comprimirFoto } from "@/lib/compresion-foto";
import type { EstadoConteoFoto, LoteRegistradoFoto, RespuestaConteoFoto } from "@/lib/conteo-foto";
import { LONGITUD_MAXIMA_DESCRIPCION } from "@/lib/evidencias";

type Props = {
  visible: boolean; // el estado se consulta la primera vez que se abre el módulo
  onRegistrado?: () => void; // recarga el panel al crear un lote
};

type TipoDato = "real" | "prueba";

const porcentaje = (fraccion: number) =>
  `${(fraccion * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;

/**
 * Contar sacos en una fotografía. Solo lo ve el personal de MACROMEC.
 * La foto se toma con la cámara del celular o se elige de la galería o del equipo,
 * se reduce en el navegador y el servidor la cuenta con RF-DETR (POST /api/contar-foto).
 * Se muestra la foto con las cajas, el total y la confianza. Si el personal lo decide,
 * el resultado se registra como un lote pendiente de validación y la foto queda como su
 * evidencia (POST /api/contar-foto/registrar); el total lo fija el servidor.
 */
export function ConteoPorFoto({ visible, onRegistrado }: Props) {
  const [estado, setEstado] = useState<EstadoConteoFoto | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null); // URL local de la foto reducida
  const [blobFoto, setBlobFoto] = useState<Blob | null>(null); // la misma foto que se contó, para registrarla
  const [resultado, setResultado] = useState<RespuestaConteoFoto | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDato | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [registrado, setRegistrado] = useState<LoteRegistradoFoto | null>(null);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);

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
    setBlobFoto(null);
    setResultado(null);
    setTipo(null);
    setDescripcion("");
    setRegistrado(null);
    setErrorRegistro(null);
    setProcesando(true);
    try {
      const comprimida = await comprimirFoto(archivo);
      setFoto(URL.createObjectURL(comprimida.blob));
      setBlobFoto(comprimida.blob);
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

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!resultado?.registro || !blobFoto || !tipo || registrando || registrado) return;
    setErrorRegistro(null);
    setRegistrando(true);
    try {
      const datos = new FormData();
      datos.append("foto", blobFoto, "foto.jpg");
      datos.append("registro", resultado.registro);
      datos.append("tipo", tipo);
      if (descripcion.trim()) datos.append("descripcion", descripcion.trim());
      const res = await fetch("/api/contar-foto/registrar", { method: "POST", body: datos });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorRegistro(data.error || "No se pudo registrar el lote.");
        return;
      }
      setRegistrado(data);
      onRegistrado?.();
    } catch {
      setErrorRegistro("Error de conexión. Intente nuevamente: la foto no se registrará dos veces.");
    } finally {
      setRegistrando(false);
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
            Si lo decide, el resultado se registra como un lote pendiente de validación, con la foto como evidencia.
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
                El modelo detecta sacos, no evalúa su calidad. Mientras no lo registre, este conteo no aparece en el
                historial ni modifica el inventario.
              </p>

              {r.registro && (
                <form className="conteo-foto-registro" onSubmit={registrar}>
                  <fieldset className="validacion-estados" disabled={registrando || !!registrado}>
                    <legend>Registrar como lote · {r.total} saco{r.total === 1 ? "" : "s"}</legend>
                    {(["real", "prueba"] as const).map((op) => (
                      <label key={op} className={`opcion-estado ${tipo === op ? "activa" : ""}`}>
                        <input type="radio" name="tipo-dato-foto" value={op} checked={tipo === op} onChange={() => setTipo(op)} />
                        {op === "real" ? "Dato real" : "Dato de prueba"}
                      </label>
                    ))}
                  </fieldset>
                  <label className="campo">
                    <span>Descripción de la evidencia (opcional)</span>
                    <input
                      type="text"
                      maxLength={LONGITUD_MAXIMA_DESCRIPCION}
                      value={descripcion}
                      onChange={(e) => setDescripcion(e.target.value)}
                      placeholder="Ej.: fila 3 de la zona de embolsado"
                      disabled={registrando || !!registrado}
                    />
                  </label>
                  <button type="submit" className="btn-acento" disabled={!tipo || registrando || !!registrado}>
                    {registrando ? "Registrando…" : "Registrar lote"}
                  </button>
                  {!tipo && !registrado && <span className="tenue">Elija si es un dato real o de prueba.</span>}
                </form>
              )}
              {registrado && (
                <p className="mensaje mensaje-ok" role="status">
                  {registrado.yaRegistrado
                    ? `Esta foto ya estaba registrada como lote #${registrado.lote.id} (no se duplicó).`
                    : `Lote #${registrado.lote.id} registrado con ${registrado.lote.cantidadSacos} sacos, pendiente de validación; la foto quedó como evidencia.`}
                  {" "}Valídelo desde el Historial.
                </p>
              )}
              {errorRegistro && <p className="mensaje mensaje-error" role="alert">{errorRegistro}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
