"use client";

import { useEffect, useRef, useState } from "react";
import type { EstadoConteoFoto } from "@/lib/conteo-foto";
import { LONGITUD_MAXIMA_DESCRIPCION } from "@/lib/evidencias";
import {
  SeguidorSacos,
  VIDEO_LINEA_X_MAX,
  VIDEO_LINEA_X_MIN,
  VIDEO_LINEA_X_POR_DEFECTO,
  VIDEO_PASO_SEGUNDOS,
  VIDEO_SEGUNDOS_MAXIMOS,
  confianzaPromedio,
  type DireccionConteo,
  type FotogramaDetectado,
  type LoteRegistradoVideo,
  type ParametrosConteoVideo,
  type PistaVisible,
  type RespuestaFotogramaVideo,
  type SacoContado,
} from "@/lib/conteo-video";

type Props = {
  visible: boolean;
  onRegistrado?: () => void;
};

type TipoDato = "real" | "prueba";
type Fase = "sin_video" | "listo" | "analizando" | "detenido" | "terminado";

/** Lado mayor de cada fotograma enviado: suficiente para el modelo y liviano para subirlo. */
const LADO_FOTOGRAMA = 1280;
/** Fotogramas en análisis a la vez (las respuestas se aplican siempre en orden). */
const EN_PARALELO = 3;
const REINTENTOS = 3;

type Paso = { tiempo: number; pistas: PistaVisible[]; total: number };

const segundos = (s: number) => `${s.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const pct = (f: number | null) => (f === null ? "—" : `${(f * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`);

function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lleva el video a un segundo y espera a que el fotograma esté listo para dibujarlo. */
function irA(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => {
      video.removeEventListener("seeked", listo);
      reject(new Error("El navegador no pudo leer un fotograma del video."));
    }, 10_000);
    function listo() {
      clearTimeout(limite);
      video.removeEventListener("seeked", listo);
      resolve();
    }
    video.addEventListener("seeked", listo);
    video.currentTime = t;
  });
}

function dibujar(ctx: CanvasRenderingContext2D, fuente: CanvasImageSource, ancho: number, alto: number, paso: Paso | null, params: ParametrosConteoVideo) {
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  const grosor = Math.max(2, Math.round(Math.max(ancho, alto) / 400));
  const letra = Math.max(14, Math.round(Math.max(ancho, alto) / 45));
  const x = params.lineaX * ancho;
  ctx.lineWidth = grosor * 1.5;
  ctx.strokeStyle = "#2563eb";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, alto);
  ctx.stroke();
  // Flecha de la dirección de conteo.
  const dir = params.direccion === "derecha_a_izquierda" ? -1 : 1;
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.moveTo(x + dir * letra * 1.6, letra * 1.2);
  ctx.lineTo(x + dir * letra * 0.6, letra * 0.6);
  ctx.lineTo(x + dir * letra * 0.6, letra * 1.8);
  ctx.fill();
  if (!paso) return;
  ctx.font = `600 ${letra}px system-ui, sans-serif`;
  for (const p of paso.pistas) {
    if (!p.detectadaAhora) continue;
    const color = p.contada ? "#16a34a" : p.confirmada ? "#f97316" : "#9ca3af";
    ctx.strokeStyle = color;
    ctx.lineWidth = grosor;
    ctx.setLineDash(p.confirmada ? [] : [grosor * 3, grosor * 2]);
    ctx.strokeRect(p.caja.x1, p.caja.y1, p.caja.x2 - p.caja.x1, p.caja.y2 - p.caja.y1);
    ctx.setLineDash([]);
    const etiqueta = `#${p.id}${p.contada ? " ✓" : ""}`;
    const w = ctx.measureText(etiqueta).width + 8;
    ctx.fillStyle = color;
    ctx.fillRect(p.caja.x1, Math.max(0, p.caja.y1 - letra - 6), w, letra + 6);
    ctx.fillStyle = "#fff";
    ctx.fillText(etiqueta, p.caja.x1 + 4, Math.max(letra, p.caja.y1 - 6));
  }
  const texto = `Sacos contados: ${paso.total}`;
  ctx.font = `700 ${Math.round(letra * 1.3)}px system-ui, sans-serif`;
  const w = ctx.measureText(texto).width + 20;
  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.fillRect(10, alto - letra * 2.4, w, letra * 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(texto, 20, alto - letra * 0.9);
}

/**
 * Contar sacos en un video desde el panel (solo personal de MACROMEC), sin terminal.
 * El video no se sube: el navegador toma un fotograma cada 1/6 s (como el detector,
 * 1 de cada 5 a 30 fps), lo envía al modelo RF-DETR (POST /api/contar-video/fotograma),
 * sigue cada saco y cuenta los que cruzan la línea en la dirección elegida. Al terminar,
 * el resultado puede registrarse como lote pendiente con un fotograma como evidencia; el
 * servidor vuelve a contar con las detecciones firmadas (POST /api/contar-video/registrar).
 */
export function ConteoPorVideo({ visible, onRegistrado }: Props) {
  const [estado, setEstado] = useState<EstadoConteoFoto | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [urlVideo, setUrlVideo] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [duracion, setDuracion] = useState(0);
  const [inicio, setInicio] = useState(0);
  const [fin, setFin] = useState(0);
  const [lineaX, setLineaX] = useState(VIDEO_LINEA_X_POR_DEFECTO);
  const [direccion, setDireccion] = useState<DireccionConteo>("derecha_a_izquierda");
  const [fase, setFase] = useState<Fase>("sin_video");
  const [hechos, setHechos] = useState(0);
  const [planificados, setPlanificados] = useState(0);
  const [contados, setContados] = useState<SacoContado[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDato | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [registrado, setRegistrado] = useState<LoteRegistradoVideo | null>(null);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);
  const [repasando, setRepasando] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const detenerRef = useRef(false);
  // Datos del último análisis (no necesitan volver a dibujar la página).
  const analisis = useRef<{
    sesion: string;
    params: ParametrosConteoVideo;
    inicio: number;
    firmas: string[];
    pasos: Paso[];
    evidencia: { indice: number; blob: Blob; detecciones: number } | null;
  } | null>(null);
  // Detecciones de cada fotograma analizado, para rehacer el seguimiento al continuar.
  const detecciones = useRef<FotogramaDetectado[]>([]);

  useEffect(() => {
    if (!visible || estado) return;
    let vigente = true;
    (async () => {
      try {
        const res = await fetch("/api/contar-foto", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) return setErrorEstado(data.error || "No se pudo consultar si el servicio de detección está disponible.");
        setEstado(data);
      } catch {
        if (vigente) setErrorEstado("No se pudo consultar si el servicio de detección está disponible.");
      }
    })();
    return () => {
      vigente = false;
    };
  }, [visible, estado]);

  useEffect(() => () => { if (urlVideo) URL.revokeObjectURL(urlVideo); }, [urlVideo]);
  // Al salir del módulo se detiene el análisis en curso.
  useEffect(() => {
    if (!visible) detenerRef.current = true;
  }, [visible]);

  function reiniciarResultado() {
    analisis.current = null;
    detecciones.current = [];
    setHechos(0);
    setPlanificados(0);
    setContados([]);
    setError(null);
    setTipo(null);
    setDescripcion("");
    setRegistrado(null);
    setErrorRegistro(null);
  }

  function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    detenerRef.current = true;
    reiniciarResultado();
    setNombre(archivo.name);
    setDuracion(0);
    setFase("sin_video");
    setUrlVideo(URL.createObjectURL(archivo));
  }

  async function alCargarMetadatos() {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) {
      setError("No se pudo leer la duración del video.");
      return;
    }
    setDuracion(v.duration);
    setInicio(0);
    setFin(Math.min(v.duration, VIDEO_SEGUNDOS_MAXIMOS));
    setFase("listo");
    setError(null);
    // Muestra el primer fotograma con la línea.
    try {
      await irA(v, Math.min(0.05, v.duration / 2));
      pintar(v, null, { lineaX, direccion });
    } catch {
      // Si no se puede mostrar, el análisis lo informará.
    }
  }

  function tamanoLienzo(v: HTMLVideoElement) {
    const escala = Math.min(1, LADO_FOTOGRAMA / Math.max(v.videoWidth, v.videoHeight));
    return { ancho: Math.max(1, Math.round(v.videoWidth * escala)), alto: Math.max(1, Math.round(v.videoHeight * escala)) };
  }

  function pintar(fuente: CanvasImageSource & { videoWidth?: number }, paso: Paso | null, params: ParametrosConteoVideo, tam?: { ancho: number; alto: number }) {
    const c = lienzoRef.current;
    const v = videoRef.current;
    if (!c || !v) return;
    const { ancho, alto } = tam ?? tamanoLienzo(v);
    if (c.width !== ancho) c.width = ancho;
    if (c.height !== alto) c.height = alto;
    const ctx = c.getContext("2d");
    if (ctx) dibujar(ctx, fuente, ancho, alto, paso, params);
  }

  // La línea se ve al moverla, antes de analizar.
  useEffect(() => {
    const v = videoRef.current;
    if (fase === "listo" && v && v.readyState >= 2) pintar(v, null, { lineaX, direccion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineaX, direccion, fase]);

  async function enviarFotograma(blob: Blob, sesion: string, indice: number, tiempo: number): Promise<RespuestaFotogramaVideo> {
    let ultimo = "No se pudo analizar el fotograma.";
    for (let intento = 0; intento < REINTENTOS; intento++) {
      if (detenerRef.current) throw new Error("detenido");
      const datos = new FormData();
      datos.append("foto", blob, `f${indice}.jpg`);
      datos.append("sesion", sesion);
      datos.append("indice", String(indice));
      datos.append("tiempo", String(tiempo));
      try {
        const res = await fetch("/api/contar-video/fotograma", { method: "POST", body: datos });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data as RespuestaFotogramaVideo;
        ultimo = data.error || ultimo;
        // Errores que no se arreglan reintentando.
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 413) throw new Error(ultimo);
        await esperar(res.status === 429 ? 5000 : 1500 * (intento + 1));
      } catch (err) {
        if (err instanceof Error && (err.message === ultimo || err.message === "detenido")) throw err;
        ultimo = "Error de conexión al analizar el video.";
        await esperar(1500 * (intento + 1));
      }
    }
    throw new Error(ultimo);
  }

  async function analizar(continuar: boolean) {
    const v = videoRef.current;
    if (!v || fase === "analizando") return;
    const params: ParametrosConteoVideo = { lineaX: Number(lineaX.toFixed(3)), direccion };
    if (!continuar || !analisis.current) {
      reiniciarResultado();
      analisis.current = { sesion: crypto.randomUUID(), params, inicio, firmas: [], pasos: [], evidencia: null };
      detecciones.current = [];
    }
    const a = analisis.current;
    const total = Math.floor((Math.min(fin, a.inicio + VIDEO_SEGUNDOS_MAXIMOS) - a.inicio) / VIDEO_PASO_SEGUNDOS + 1e-9) + 1;
    setPlanificados(total);
    setError(null);
    setFase("analizando");
    detenerRef.current = false;
    v.pause();

    // El seguimiento se reconstruye con lo ya analizado (al continuar tras un corte).
    const seguidor = new SeguidorSacos(a.params);
    const reproducir = (r: FotogramaDetectado) => {
      const paso = seguidor.paso(r);
      a.pasos[r.indice] = { tiempo: r.tiempo, pistas: paso.pistas, total: paso.total };
      return paso;
    };
    const previos = a.firmas.length;
    for (let i = 0; i < previos; i++) reproducir(detecciones.current[i]);
    setContados([...seguidor.contados]);
    setHechos(previos);

    const { ancho, alto } = tamanoLienzo(v);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) {
      setError("El navegador no permite procesar el video.");
      setFase("detenido");
      return;
    }

    type Pendiente = { indice: number; tiempo: number; blob: Blob; imagen: ImageBitmap; promesa: Promise<RespuestaFotogramaVideo> };
    const cola: Pendiente[] = [];
    let siguiente = previos;
    try {
      while (siguiente < total || cola.length) {
        while (siguiente < total && cola.length < EN_PARALELO) {
          if (detenerRef.current) throw new Error("detenido");
          const tiempo = Number((siguiente * VIDEO_PASO_SEGUNDOS).toFixed(3));
          await irA(v, Math.min(a.inicio + tiempo, duracion - 0.001));
          ctx.drawImage(v, 0, 0, ancho, alto);
          const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
          if (!blob) throw new Error("El navegador no pudo convertir el fotograma.");
          const imagen = await createImageBitmap(lienzo);
          const indice = siguiente++;
          const promesa = enviarFotograma(blob, a.sesion, indice, tiempo);
          promesa.catch(() => undefined); // se atiende al sacarlo de la cola
          cola.push({ indice, tiempo, blob, imagen, promesa });
        }
        const p = cola.shift()!;
        let r: RespuestaFotogramaVideo;
        try {
          r = await p.promesa;
        } catch (err) {
          p.imagen.close();
          throw err;
        }
        if (detenerRef.current) {
          p.imagen.close();
          throw new Error("detenido");
        }
        const det: FotogramaDetectado = { indice: r.indice, tiempo: r.tiempo, ancho: r.ancho, alto: r.alto, detecciones: r.detecciones };
        detecciones.current[r.indice] = det;
        a.firmas[r.indice] = r.firma;
        const paso = reproducir(det);
        // Evidencia: el fotograma con más sacos detectados.
        if (!a.evidencia || r.detecciones.length > a.evidencia.detecciones) {
          a.evidencia = { indice: r.indice, blob: p.blob, detecciones: r.detecciones.length };
        }
        pintar(p.imagen, a.pasos[r.indice], a.params, { ancho, alto });
        p.imagen.close();
        if (paso.nuevos.length) setContados([...seguidor.contados]);
        setHechos(r.indice + 1);
      }
      setContados([...seguidor.contados]);
      setFase("terminado");
    } catch (err) {
      for (const p of cola) p.imagen.close();
      // Lo ya analizado se conserva en orden; se puede continuar desde el primer faltante.
      const completos = a.firmas.findIndex((f) => !f);
      const n = completos === -1 ? a.firmas.length : completos;
      a.firmas.length = n;
      a.pasos.length = n;
      detecciones.current.length = n;
      setHechos(n);
      setFase("detenido");
      if (!(err instanceof Error && err.message === "detenido")) {
        setError(`${err instanceof Error ? err.message : "Error al analizar el video."} Puede continuar desde el segundo ${segundos(n * VIDEO_PASO_SEGUNDOS)}.`);
      }
    }
  }

  async function repasar() {
    const v = videoRef.current;
    const a = analisis.current;
    if (!v || !a || repasando) return;
    setRepasando(true);
    detenerRef.current = false;
    try {
      for (const paso of a.pasos) {
        if (detenerRef.current) break;
        await irA(v, Math.min(a.inicio + paso.tiempo, duracion - 0.001));
        pintar(v, paso, a.params);
        await esperar(60);
      }
    } catch {
      // Si el navegador no puede volver a leer el video, se deja el último fotograma.
    } finally {
      setRepasando(false);
    }
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    const a = analisis.current;
    if (!a?.evidencia || !tipo || registrando || registrado || fase !== "terminado") return;
    setErrorRegistro(null);
    setRegistrando(true);
    try {
      const datos = new FormData();
      datos.append("fotogramas", JSON.stringify(a.firmas));
      datos.append("parametros", JSON.stringify(a.params));
      datos.append("evidencia", String(a.evidencia.indice));
      datos.append("foto", a.evidencia.blob, "fotograma.jpg");
      datos.append("tipo", tipo);
      if (descripcion.trim()) datos.append("descripcion", descripcion.trim());
      const res = await fetch("/api/contar-video/registrar", { method: "POST", body: datos });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorRegistro(data.error || "No se pudo registrar el lote.");
        return;
      }
      setRegistrado(data);
      onRegistrado?.();
    } catch {
      setErrorRegistro("Error de conexión. Intente nuevamente: el análisis no se registrará dos veces.");
    } finally {
      setRegistrando(false);
    }
  }

  const disponible = estado?.disponible === true;
  const tramo = Math.max(0, Math.min(fin, inicio + VIDEO_SEGUNDOS_MAXIMOS) - inicio);
  const consultas = Math.floor(tramo / VIDEO_PASO_SEGUNDOS + 1e-9) + 1;
  const ocupado = fase === "analizando" || repasando;
  const confianza = confianzaPromedio(contados);
  const progreso = planificados ? Math.round((hechos / planificados) * 100) : 0;

  return (
    <section className="tarjeta conteo-foto conteo-video" id="video">
      <div className="tarjeta-head">
        <div>
          <h2>Contar sacos por video</h2>
          <p className="tarjeta-sub">
            Grabe o elija un video de la zona de empaquetado. El video no se sube: el navegador toma 6 fotogramas por
            segundo, el modelo RF-DETR detecta los sacos y el sistema cuenta los que cruzan la línea azul en la dirección
            de la flecha. Si lo decide, el resultado se registra como un lote pendiente de validación.
          </p>
        </div>
      </div>

      {errorEstado && <p className="mensaje mensaje-error" role="alert">{errorEstado}</p>}
      {!estado && !errorEstado && <p className="vacio">Comprobando el servicio de detección…</p>}
      {estado && !disponible && (
        <p className="aviso aviso-info">El conteo por video no está configurado en este servidor: falta la clave del servicio de detección.</p>
      )}

      {disponible && (
        <div className="evidencias-acciones">
          <label className={`btn-acento btn-archivo ${ocupado ? "deshabilitado" : ""}`}>
            Grabar video
            <input type="file" accept="video/*" capture="environment" onChange={alElegir} disabled={ocupado} />
          </label>
          <label className={`btn-secundario btn-archivo ${ocupado ? "deshabilitado" : ""}`}>
            Elegir video
            <input type="file" accept="video/*" onChange={alElegir} disabled={ocupado} />
          </label>
          {nombre && <span className="tenue">{nombre}{duracion ? ` · ${segundos(duracion)}` : ""}</span>}
        </div>
      )}

      {urlVideo && (
        <video
          ref={videoRef}
          src={urlVideo}
          muted
          playsInline
          preload="auto"
          className="conteo-video-fuente"
          onLoadedMetadata={alCargarMetadatos}
          onError={() => {
            setFase("sin_video");
            setError("El navegador no puede reproducir este video. Use un MP4 (H.264); en iPhone: Ajustes › Cámara › Formatos › Más compatible.");
          }}
        />
      )}

      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}

      {urlVideo && fase !== "sin_video" && (
        <div className="conteo-foto-resultado">
          <div className="conteo-foto-figura conteo-video-figura">
            <canvas ref={lienzoRef} aria-label="Fotograma analizado con las cajas, la línea de conteo y el total" />
          </div>

          <div className="conteo-foto-datos">
            <fieldset className="conteo-video-ajustes" disabled={ocupado || fase === "terminado" || fase === "detenido"}>
              <legend>Ajustes del conteo</legend>
              <label className="campo">
                <span>Línea de conteo: {Math.round(lineaX * 100)} % del ancho</span>
                <input type="range" min={VIDEO_LINEA_X_MIN} max={VIDEO_LINEA_X_MAX} step={0.05} value={lineaX} onChange={(e) => setLineaX(Number(e.target.value))} />
              </label>
              <label className="campo">
                <span>Dirección en que avanzan los sacos</span>
                <select value={direccion} onChange={(e) => setDireccion(e.target.value as DireccionConteo)}>
                  <option value="derecha_a_izquierda">De derecha a izquierda</option>
                  <option value="izquierda_a_derecha">De izquierda a derecha</option>
                </select>
              </label>
              <div className="conteo-video-tramo">
                <label className="campo">
                  <span>Desde (s)</span>
                  <input type="number" lang="en" min={0} max={Math.max(0, duracion - 0.5)} step={0.5} value={inicio}
                    onChange={(e) => { const x = Math.max(0, Math.min(Number(e.target.value) || 0, duracion - 0.5)); setInicio(x); if (fin <= x) setFin(Math.min(duracion, x + 1)); }} />
                </label>
                <label className="campo">
                  <span>Hasta (s)</span>
                  <input type="number" lang="en" min={inicio + 0.5} max={duracion} step={0.5} value={Number(fin.toFixed(1))}
                    onChange={(e) => setFin(Math.max(inicio + 0.5, Math.min(Number(e.target.value) || 0, duracion)))} />
                </label>
              </div>
              <p className="validacion-nota">
                Se analizarán {segundos(tramo)} ({consultas} consultas al modelo).
                {duracion > VIDEO_SEGUNDOS_MAXIMOS && ` Por análisis se cuentan como máximo ${VIDEO_SEGUNDOS_MAXIMOS} s; un video más largo se cuenta por tramos.`}
              </p>
            </fieldset>

            <div className="evidencias-acciones">
              {(fase === "listo" || fase === "terminado") && (
                <button type="button" className="btn-acento" onClick={() => analizar(false)} disabled={ocupado || tramo <= 0}>
                  {fase === "terminado" ? "Analizar de nuevo" : "Contar sacos"}
                </button>
              )}
              {fase === "detenido" && (
                <>
                  <button type="button" className="btn-acento" onClick={() => analizar(true)}>Continuar análisis</button>
                  <button type="button" className="btn-secundario" onClick={() => { reiniciarResultado(); setFase("listo"); }}>Empezar de nuevo</button>
                </>
              )}
              {fase === "analizando" && (
                <button type="button" className="btn-secundario" onClick={() => { detenerRef.current = true; }}>Detener</button>
              )}
              {fase === "terminado" && (
                <button type="button" className="btn-secundario" onClick={repasar} disabled={repasando}>
                  {repasando ? "Repasando…" : "Repasar el conteo"}
                </button>
              )}
            </div>

            {(fase === "analizando" || fase === "detenido" || fase === "terminado") && planificados > 0 && (
              <div className="conteo-video-progreso" role="status">
                <progress max={planificados} value={hechos} />
                <span className="tenue">
                  {fase === "terminado" ? "Análisis terminado" : fase === "detenido" ? "Análisis detenido" : "Analizando"} · {hechos} de {planificados} fotogramas ({progreso} %)
                </span>
              </div>
            )}

            {hechos > 0 && (
              <>
                <div className="kpi kpi-hero">
                  <span className="kpi-label">{fase === "terminado" ? "Sacos contados" : "Sacos contados hasta ahora"}</span>
                  <span className="kpi-valor">{contados.length}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Confianza promedio</span>
                  <span className="kpi-valor kpi-valor-par">
                    {confianza === null ? "—" : `${confianza.toLocaleString("es-PE", { maximumFractionDigits: 2 })} %`}
                  </span>
                </div>
                {contados.length > 0 && (
                  <details className="conteo-video-lista">
                    <summary>Momento en que se contó cada saco</summary>
                    <ol>
                      {contados.map((s) => (
                        <li key={s.id}>
                          Saco #{s.id} · segundo {segundos((analisis.current?.inicio ?? 0) + s.tiempo)} · confianza {pct(s.confianza)}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <p className="validacion-nota">
                  Recuadro verde: saco contado · naranja: saco seguido · gris punteado: detección por confirmar. Un saco se
                  cuenta una sola vez y no se vuelve a contar si retrocede o si la cámara gira hacia atrás.
                </p>
              </>
            )}

            {fase === "terminado" && contados.length === 0 && (
              <p className="aviso aviso-info">
                Ningún saco cruzó la línea. Revise la dirección y la posición de la línea, o use un video en que los sacos
                pasen por delante de la cámara.
              </p>
            )}

            {fase === "terminado" && contados.length > 0 && analisis.current?.evidencia && (
              <form className="conteo-foto-registro" onSubmit={registrar}>
                <fieldset className="validacion-estados" disabled={registrando || !!registrado}>
                  <legend>Registrar como lote · {contados.length} saco{contados.length === 1 ? "" : "s"}</legend>
                  {(["real", "prueba"] as const).map((op) => (
                    <label key={op} className={`opcion-estado ${tipo === op ? "activa" : ""}`}>
                      <input type="radio" name="tipo-dato-video" value={op} checked={tipo === op} onChange={() => setTipo(op)} />
                      {op === "real" ? "Dato real" : "Dato de prueba"}
                    </label>
                  ))}
                </fieldset>
                <label className="campo">
                  <span>Descripción de la evidencia (opcional)</span>
                  <input type="text" maxLength={LONGITUD_MAXIMA_DESCRIPCION} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                    placeholder="Ej.: turno mañana, línea de embolsado 2" disabled={registrando || !!registrado} />
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
                  ? `Este análisis ya estaba registrado como lote #${registrado.lote.id} (no se duplicó).`
                  : `Lote #${registrado.lote.id} registrado con ${registrado.lote.cantidadSacos} sacos, pendiente de validación; un fotograma quedó como evidencia.`}
                {" "}Valídelo desde el Historial.
              </p>
            )}
            {errorRegistro && <p className="mensaje mensaje-error" role="alert">{errorRegistro}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
