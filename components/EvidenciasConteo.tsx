"use client";

import { useEffect, useRef, useState } from "react";
import {
  LONGITUD_MAXIMA_DESCRIPCION,
  LONGITUD_MAXIMA_MOTIVO,
  MAXIMO_EVIDENCIAS_ACTIVAS,
  urlImagenEvidencia,
  type Evidencia,
} from "@/lib/evidencias";
import { comprimirFoto, type FotoComprimida } from "@/lib/compresion-foto";

type Props = {
  conteoId: number;
  esAdmin: boolean;
};

type Preparada = FotoComprimida & { url: string; bytesOriginal: number; tomadaEn: string | null };

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`
    : `${Math.round(bytes / 1024).toLocaleString("es-PE")} KB`;
const fecha = (iso: string) => new Date(iso).toLocaleString("es-PE");

/**
 * Evidencias fotográficas de un conteo, dentro de la fila expandida del historial.
 * El personal de MACROMEC toma la foto con la cámara del celular (o la elige de
 * la galería), la ve comprimida antes de subirla y puede anularla con un motivo.
 * El cliente solo ve las evidencias activas. Las fotos no cambian el conteo.
 */
export function EvidenciasConteo({ conteoId, esAdmin }: Props) {
  const [lista, setLista] = useState<Evidencia[] | null>(null);
  const [activas, setActivas] = useState(0);
  const [errorLista, setErrorLista] = useState(false);
  const [preparada, setPreparada] = useState<Preparada | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [abierta, setAbierta] = useState<Evidencia | null>(null);
  const [motivo, setMotivo] = useState("");
  const visor = useRef<HTMLDialogElement>(null);

  async function cargar() {
    try {
      const res = await fetch(`/api/conteo/${conteoId}/evidencias`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLista(data.evidencias ?? []);
      setActivas(data.activas ?? 0);
      setErrorLista(false);
    } catch {
      setErrorLista(true);
    }
  }

  useEffect(() => {
    cargar();
    // cargar solo depende de conteoId: se vuelve a consultar al cambiar de lote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conteoId]);

  // Libera la vista previa al cambiarla o al cerrar la fila.
  useEffect(() => () => { if (preparada) URL.revokeObjectURL(preparada.url); }, [preparada]);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir la misma foto
    if (!archivo) return;
    setMensaje(null);
    setProcesando(true);
    try {
      const comprimida = await comprimirFoto(archivo);
      setPreparada({
        ...comprimida,
        url: URL.createObjectURL(comprimida.blob),
        bytesOriginal: archivo.size,
        // Fecha del archivo según el celular: se guarda como "declarada", no verificada.
        tomadaEn: archivo.lastModified ? new Date(archivo.lastModified).toISOString() : null,
      });
    } catch (err) {
      setMensaje({ ok: false, texto: err instanceof Error ? err.message : "No se pudo procesar la foto." });
    } finally {
      setProcesando(false);
    }
  }

  async function subir() {
    if (!preparada) return;
    setProcesando(true);
    setMensaje(null);
    const datos = new FormData();
    datos.append("foto", preparada.blob, "evidencia.jpg");
    if (descripcion.trim()) datos.append("descripcion", descripcion.trim());
    if (preparada.tomadaEn) datos.append("tomadaEn", preparada.tomadaEn);
    try {
      const res = await fetch(`/api/conteo/${conteoId}/evidencias`, { method: "POST", body: datos });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPreparada(null);
        setDescripcion("");
        await cargar();
        setMensaje({ ok: true, texto: "Evidencia guardada." });
      } else {
        setMensaje({ ok: false, texto: data.error || "No se pudo guardar la evidencia." });
      }
    } catch {
      setMensaje({ ok: false, texto: "Error de conexión. La foto sigue lista para reintentar." });
    } finally {
      setProcesando(false);
    }
  }

  function abrir(ev: Evidencia) {
    setAbierta(ev);
    setMotivo("");
    setMensaje(null);
    visor.current?.showModal();
  }

  async function anular(e: React.FormEvent) {
    e.preventDefault();
    if (!abierta || !motivo.trim()) return;
    setProcesando(true);
    try {
      const res = await fetch(`/api/evidencias/${abierta.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const anuladaId = abierta.id;
        visor.current?.close();
        await cargar();
        setMensaje({ ok: true, texto: `Evidencia #${anuladaId} anulada. Se conserva en el registro.` });
      } else {
        setMensaje({ ok: false, texto: data.error || "No se pudo anular la evidencia." });
      }
    } catch {
      setMensaje({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setProcesando(false);
    }
  }

  const lleno = activas >= MAXIMO_EVIDENCIAS_ACTIVAS;

  return (
    <div className="evidencias">
      <div className="validacion-head">
        <h3>Evidencias fotográficas</h3>
        <span className="tenue evidencias-cuenta">{activas} de {MAXIMO_EVIDENCIAS_ACTIVAS}</span>
      </div>
      <p className="validacion-nota">
        Las fotos respaldan la revisión del lote. No modifican la cantidad contada por el sistema de visión.
      </p>

      {esAdmin && !preparada && (
        <div className="evidencias-acciones">
          <label className={`btn-acento btn-archivo ${lleno || procesando ? "deshabilitado" : ""}`}>
            Tomar foto
            <input type="file" accept="image/*" capture="environment" onChange={alElegir} disabled={lleno || procesando} />
          </label>
          <label className={`btn-secundario btn-archivo ${lleno || procesando ? "deshabilitado" : ""}`}>
            Elegir de la galería
            <input type="file" accept="image/*" onChange={alElegir} disabled={lleno || procesando} />
          </label>
          {procesando && <span className="tenue">Procesando…</span>}
          {lleno && <span className="tenue">Límite alcanzado: anule una evidencia para agregar otra.</span>}
        </div>
      )}

      {esAdmin && preparada && (
        <div className="evidencia-previa">
          <img src={preparada.url} alt="Vista previa de la foto a subir" />
          <div className="evidencia-previa-datos">
            <p>
              Original {preparada.anchoOriginal}×{preparada.altoOriginal} px · {kb(preparada.bytesOriginal)}
              <br />
              Se subirá {preparada.ancho}×{preparada.alto} px · {kb(preparada.blob.size)} · sin datos de ubicación
            </p>
            <label className="campo campo-bloque">
              <span>Descripción (opcional)</span>
              <input
                type="text"
                maxLength={LONGITUD_MAXIMA_DESCRIPCION}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Ej.: fila norte, sacos con malla rota"
              />
            </label>
            <div className="evidencias-acciones">
              <button type="button" className="btn-acento" onClick={subir} disabled={procesando}>
                {procesando ? "Subiendo…" : "Subir evidencia"}
              </button>
              <button type="button" className="btn-secundario" onClick={() => setPreparada(null)} disabled={procesando}>
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {mensaje && (
        <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>
      )}

      {errorLista ? (
        <p className="mensaje mensaje-error">No se pudieron cargar las evidencias.</p>
      ) : lista === null ? (
        <p className="tenue">Cargando evidencias…</p>
      ) : lista.length === 0 ? (
        <p className="tenue">Sin evidencias registradas.</p>
      ) : (
        <ul className="galeria">
          {lista.map((ev) => (
            <li key={ev.id} className={ev.anuladaEn ? "galeria-anulada" : ""}>
              <button type="button" onClick={() => abrir(ev)} aria-label={`Ver evidencia #${ev.id}${ev.anuladaEn ? " (anulada)" : ""}`}>
                <img src={urlImagenEvidencia(ev.id, "miniatura")} alt="" width={120} height={90} />
                <span className="galeria-pie">
                  #{ev.id}{ev.anuladaEn && <> · <span className="badge badge-val-rechazado">Anulada</span></>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={visor} className="visor" onClose={() => setAbierta(null)} aria-label="Evidencia fotográfica">
        {abierta && (
          <>
            <div className="visor-cabecera">
              <strong>Evidencia #{abierta.id} · conteo #{abierta.conteoId}</strong>
              {abierta.anuladaEn && <span className="badge badge-val-rechazado">Anulada</span>}
              <button type="button" className="btn-secundario" onClick={() => visor.current?.close()}>Cerrar</button>
            </div>
            <img className="visor-imagen" src={urlImagenEvidencia(abierta.id, "completa")} alt={abierta.descripcion ?? `Evidencia ${abierta.id}`} />
            <dl className="detalle-grid">
              <div><dt>Descripción</dt><dd>{abierta.descripcion || <span className="tenue">—</span>}</dd></div>
              <div><dt>Subida por</dt><dd>{abierta.subidoPorNombre ?? "—"} · {fecha(abierta.subidoEn)}</dd></div>
              <div><dt>Fecha según el celular</dt><dd>{abierta.tomadaEn ? fecha(abierta.tomadaEn) : <span className="tenue">No informada</span>}</dd></div>
              <div><dt>Imagen guardada</dt><dd>{abierta.ancho}×{abierta.alto} px · {kb(abierta.bytes)}</dd></div>
              <div className="detalle-ancho"><dt>SHA-256</dt><dd className="mono">{abierta.sha256}</dd></div>
              {abierta.anuladaEn && (
                <div className="detalle-ancho">
                  <dt>Anulación</dt>
                  <dd>{abierta.anuladaPorNombre ?? "—"} · {fecha(abierta.anuladaEn)} · «{abierta.motivoAnulacion}»</dd>
                </div>
              )}
            </dl>
            {esAdmin && !abierta.anuladaEn && (
              <form onSubmit={anular} className="visor-anular">
                <label className="campo campo-bloque">
                  <span>Motivo de la anulación (obligatorio; la foto no se borra)</span>
                  <textarea rows={2} maxLength={LONGITUD_MAXIMA_MOTIVO} value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
                </label>
                <button type="submit" className="btn-secundario btn-peligro" disabled={procesando || !motivo.trim()}>
                  Anular evidencia
                </button>
              </form>
            )}
            {mensaje && !mensaje.ok && <p className="mensaje mensaje-error" role="alert">{mensaje.texto}</p>}
          </>
        )}
      </dialog>
    </div>
  );
}
