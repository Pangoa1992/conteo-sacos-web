"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { LONGITUD_MAXIMA_COMPRADOR, LONGITUD_MAXIMA_MOTIVO_ANULACION, calcularImporte, nuevaClaveIdempotencia, precioEnCentimos } from "@/lib/ventas";

type Venta = {
  id: number;
  conteoId: number;
  cantidadSacos: number;
  precioUnitario: string;
  importe: string;
  comprador: string | null;
  registradaEn: string;
  registradaPorNombre: string | null;
  anuladaEn: string | null;
  anuladaPorNombre: string | null;
  motivoAnulacion: string | null;
  fechaConteo: string;
  esPrueba: boolean;
};

type Lote = {
  conteoId: number;
  cantidadSacos: number;
  sacosConformes: number | null;
  vendidos: number;
  disponible: number;
  fuenteCamara: string | null;
  fechaConteo: string;
  esPrueba: boolean;
};

type VentaHistorica = {
  id: number;
  conteoId: number;
  precioPorSaco: string | null;
  totalVenta: string | null;
  creadoEn: string;
  cantidadSacosConteo: number | null;
  esPrueba: boolean;
};

type Props = {
  incluir: (esPrueba: boolean) => boolean; // vista real / prueba / todos del dashboard
  esVistaPrueba: boolean;
  recarga?: unknown; // cambia cuando el dashboard actualiza sus datos
  onCambio?: () => void; // tras registrar o anular una venta (el dashboard recarga el inventario)
};

type Mensaje = { ok: boolean; texto: string } | null;

// Ventas que se muestran antes de pulsar "Ver todas".
const VENTAS_VISIBLES = 10;
// Reintentos automáticos (misma clave) cuando se pierde la conexión al registrar.
const ESPERAS_REINTENTO_MS = [1000, 2000];

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmt = (n: number) => n.toLocaleString("es-PE");
const soles = (v: string | number | null) =>
  v === null || v === "" ? "—" : `S/ ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
const sacos = (n: number) => `${fmt(n)} saco${n === 1 ? "" : "s"}`;

function EtiquetaPrueba() {
  return <span className="badge badge-prueba" title="Dato de prueba: no es una detección real">Prueba</span>;
}

/**
 * Ventas parciales de sacos conformes de lotes aprobados (etapa 3B). Solo lo
 * ve el personal de MACROMEC. El importe que se muestra antes de registrar es
 * una estimación: el servidor lo calcula y lo guarda (cantidad × precio).
 * Las ventas históricas, anteriores al control de validación, se muestran
 * aparte, sin cambios y fuera del cálculo de stock.
 */
export function VentasModule({ incluir, esVistaPrueba, recarga, onCambio }: Props) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [historicas, setHistoricas] = useState<VentaHistorica[]>([]);
  const [errorCarga, setErrorCarga] = useState(false);

  const [loteId, setLoteId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [comprador, setComprador] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  // Clave de idempotencia de la operación en curso y los datos a los que
  // corresponde: un doble clic o un reintento tras un corte de conexión
  // reutilizan la misma clave (el servidor no crea otra venta); al cambiar
  // los datos o confirmarse la venta se genera una nueva.
  const operacion = useRef<{ clave: string; datos: string } | null>(null);
  const enviando = useRef(false);
  // Lote de una venta enviada cuyo resultado aún se desconoce (en curso o con la
  // conexión perdida): sigue seleccionable aunque la recarga lo muestre agotado
  // por esa misma venta.
  const [lotePendiente, setLotePendiente] = useState<number | null>(null);

  const [anulando, setAnulando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [procesandoAnulacion, setProcesandoAnulacion] = useState(false);
  const [mensajeAnulacion, setMensajeAnulacion] = useState<Mensaje>(null);
  const [verTodas, setVerTodas] = useState(false);

  async function cargar() {
    try {
      const res = await fetch("/api/ventas", { cache: "no-store" });
      if (!res.ok) throw new Error("respuesta no válida");
      const data = await res.json();
      setVentas(data.ventas ?? []);
      setLotes(data.lotes ?? []);
      setHistoricas(data.historicas ?? []);
      setErrorCarga(false);
    } catch {
      setErrorCarga(true);
    }
  }

  useEffect(() => {
    cargar();
  }, [recarga]);

  const lotesVista = useMemo(() => lotes.filter((l) => incluir(l.esPrueba)), [lotes, incluir]);
  const ventasVista = ventas.filter((v) => incluir(v.esPrueba));
  const ventasMostradas = verTodas ? ventasVista : ventasVista.slice(0, VENTAS_VISIBLES);
  const historicasVista = historicas.filter((h) => incluir(h.esPrueba));
  const lotesElegibles = lotesVista.filter((l) => l.disponible > 0 || l.conteoId === lotePendiente);
  const lote = lotesElegibles.find((l) => String(l.conteoId) === loteId);

  // Si el lote elegido se agotó o salió de la vista, se deselecciona.
  useEffect(() => {
    if (loteId && !lote) setLoteId("");
  }, [loteId, lote]);

  const cantidadNum = /^\d+$/.test(cantidad) ? Number(cantidad) : null;
  const precioCentimos = precio ? precioEnCentimos(Number(precio)) : null;
  const importeEstimado = cantidadNum && precioCentimos ? calcularImporte(cantidadNum, precioCentimos) : null;
  const activas = ventasVista.filter((v) => !v.anuladaEn);
  const totalActivo = activas.reduce((s, v) => s + Number(v.importe), 0);
  const sacosActivos = activas.reduce((s, v) => s + v.cantidadSacos, 0);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!lote) return setMensaje({ ok: false, texto: "Elija un lote aprobado con sacos disponibles." });
    if (!cantidadNum || cantidadNum < 1) return setMensaje({ ok: false, texto: "La cantidad debe ser un número entero mayor que 0." });
    if (!precioCentimos) return setMensaje({ ok: false, texto: "El precio debe ser mayor que 0 y tener como máximo 2 decimales." });

    if (enviando.current) return; // segundo clic mientras la primera solicitud sigue en curso
    const datos = { conteoId: lote.conteoId, cantidadSacos: cantidadNum, precioUnitario: precioCentimos / 100, comprador: comprador.trim() || null };
    const firma = JSON.stringify(datos);
    // Reintento de la misma operación: el stock en pantalla ya puede incluir esa
    // venta, así que no se revisa aquí; el servidor responde si ya se registró.
    const reintento = operacion.current?.datos === firma;
    if (!reintento && cantidadNum > lote.disponible) {
      return setMensaje({ ok: false, texto: `El lote #${lote.conteoId} solo tiene ${sacos(lote.disponible)} disponible${lote.disponible === 1 ? "" : "s"}.` });
    }
    if (!reintento) operacion.current = { clave: nuevaClaveIdempotencia(), datos: firma };
    const cuerpo = JSON.stringify({ ...datos, claveIdempotencia: operacion.current!.clave });

    enviando.current = true;
    // Pendiente desde el envío: si una recarga trae el stock ya descontado por
    // esta venta mientras se espera la respuesta, el lote no se deselecciona.
    setLotePendiente(datos.conteoId);
    setRegistrando(true);
    setMensaje(null);
    try {
      // Si se pierde la conexión se reintenta solo, con la misma clave: el servidor no duplica.
      let res: Response | null = null;
      for (let intento = 0; !res; intento++) {
        try {
          res = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo });
        } catch (err) {
          if (intento >= ESPERAS_REINTENTO_MS.length) throw err;
          await esperar(ESPERAS_REINTENTO_MS[intento]);
        }
      }
      const data = await res.json().catch(() => ({}));
      setLotePendiente(null);
      if (res.ok) {
        operacion.current = null;
        setCantidad("");
        setComprador("");
        setMensaje({
          ok: true,
          texto: data.duplicado
            ? `Esta venta ya estaba registrada (no se duplicó): ${sacos(data.venta.cantidadSacos)} por ${soles(data.venta.importe)}.`
            : `Venta registrada: ${sacos(data.venta.cantidadSacos)} por ${soles(data.venta.importe)}. Quedan ${sacos(data.disponible)} en el lote #${lote.conteoId}.`,
        });
      } else {
        setMensaje({ ok: false, texto: data.error || "No se pudo registrar la venta." });
      }
      cargar();
      onCambio?.();
    } catch {
      // Se conservan la clave y el lote pendiente: si la venta llegó a registrarse, el reintento no la duplica.
      setMensaje({ ok: false, texto: "Error de conexión. Intente nuevamente: la venta no se duplicará." });
    } finally {
      enviando.current = false;
      setRegistrando(false);
    }
  }

  async function anular(e: React.FormEvent, venta: Venta) {
    e.preventDefault();
    if (!motivo.trim()) return setMensajeAnulacion({ ok: false, texto: "Indique el motivo de la anulación." });
    setProcesandoAnulacion(true);
    setMensajeAnulacion(null);
    try {
      const res = await fetch(`/api/ventas/${venta.id}/anular`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAnulando(null);
        setMotivo("");
        setMensajeAnulacion({ ok: true, texto: `Venta anulada: ${sacos(venta.cantidadSacos)} vuelven al lote #${venta.conteoId} (disponibles: ${fmt(data.disponible)}).` });
      } else {
        setMensajeAnulacion({ ok: false, texto: data.error || "No se pudo anular la venta." });
      }
      cargar();
      onCambio?.();
    } catch {
      setMensajeAnulacion({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setProcesandoAnulacion(false);
    }
  }

  return (
    <section className="tarjeta" id="ventas">
      <div className="tarjeta-head">
        <div>
          <h2>Ventas de sacos conformes {esVistaPrueba && <EtiquetaPrueba />}</h2>
          <p className="tarjeta-sub">
            Solo lotes aprobados · se puede vender una parte del lote y registrar varias ventas hasta agotarlo · el importe lo calcula el servidor
          </p>
        </div>
      </div>

      {errorCarga && <p className="mensaje mensaje-error" role="alert">No se pudieron cargar las ventas. Se muestran los últimos datos recibidos.</p>}

      {/* ---- Nueva venta ---- */}
      {lotesElegibles.length === 0 ? (
        <p className="vacio">No hay lotes aprobados con sacos conformes disponibles en esta vista.</p>
      ) : (
        // noValidate: los avisos propios (p. ej. cuántos sacos quedan) son más claros que los del navegador.
        <form onSubmit={registrar} className="formulario formulario-venta" noValidate>
          <label className="campo campo-lote">
            <span>Lote aprobado</span>
            <select value={loteId} onChange={(e) => { setLoteId(e.target.value); setMensaje(null); }} required>
              <option value="">Elija un lote…</option>
              {lotesElegibles.map((l) => (
                <option key={l.conteoId} value={l.conteoId}>
                  #{l.conteoId} · {fechaCorta(l.fechaConteo)} · {fmt(l.disponible)} de {fmt(l.sacosConformes ?? 0)} conformes disponibles{l.esPrueba ? " · PRUEBA" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Cantidad (sacos)</span>
            <input type="number" inputMode="numeric" min={1} max={lote?.disponible} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          </label>
          <label className="campo">
            <span>Precio por saco (S/)</span>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} required />
          </label>
          <label className="campo campo-ancho">
            <span>Comprador (opcional)</span>
            <input type="text" maxLength={LONGITUD_MAXIMA_COMPRADOR} value={comprador} onChange={(e) => setComprador(e.target.value)} />
          </label>
          <div className="venta-resumen">
            {lote && <span className="tenue">Disponible: {sacos(lote.disponible)}</span>}
            {importeEstimado && <span>Importe estimado: <strong>{soles(importeEstimado)}</strong></span>}
          </div>
          <button type="submit" className="btn-acento" disabled={registrando || !lote}>
            {registrando ? "Registrando…" : "Registrar venta"}
          </button>
        </form>
      )}
      {mensaje && <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>}

      {/* ---- Stock por lote ---- */}
      <h3 className="subtitulo">Stock de lotes aprobados</h3>
      <div className="tabla-scroll">
        <table className="historial tabla-stock">
          <thead>
            <tr>
              <th>Lote</th>
              <th>Fecha del conteo</th>
              <th className="num">Conformes</th>
              <th className="num">Vendidos</th>
              <th className="num">Disponibles</th>
            </tr>
          </thead>
          <tbody>
            {lotesVista.map((l) => (
              <tr key={l.conteoId} className={l.esPrueba ? "fila-prueba" : ""}>
                <td data-label="Lote">#{l.conteoId} {l.esPrueba && <EtiquetaPrueba />}</td>
                <td data-label="Fecha">{fecha(l.fechaConteo)}</td>
                <td data-label="Conformes" className="num">{fmt(l.sacosConformes ?? 0)}</td>
                <td data-label="Vendidos" className="num">{fmt(l.vendidos)}</td>
                <td data-label="Disponibles" className="num fuerte">{l.disponible === 0 ? <span className="badge badge-agotado">Agotado</span> : fmt(l.disponible)}</td>
              </tr>
            ))}
            {lotesVista.length === 0 && (
              <tr className="fila-vacia"><td colSpan={5}>No hay lotes aprobados en esta vista.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Ventas registradas ---- */}
      <h3 className="subtitulo">Ventas registradas</h3>
      <p className="tarjeta-sub">
        {ventasVista.length} venta{ventasVista.length === 1 ? "" : "s"} · activas: {sacos(sacosActivos)} por {soles(totalActivo)} · las anuladas se conservan y no restan del stock
      </p>
      {mensajeAnulacion && <p className={`mensaje ${mensajeAnulacion.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensajeAnulacion.texto}</p>}
      <div className="tabla-scroll">
        <table className="historial tabla-ventas">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Lote</th>
              <th>Comprador</th>
              <th className="num">Sacos</th>
              <th className="num">Precio</th>
              <th className="num">Importe</th>
              <th>Registró</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {ventasMostradas.map((v) => (
              <Fragment key={v.id}>
                <tr className={`${v.esPrueba ? "fila-prueba" : ""} ${v.anuladaEn ? "fila-anulada" : ""}`}>
                  <td data-label="Fecha">{fecha(v.registradaEn)}</td>
                  <td data-label="Lote">#{v.conteoId} {v.esPrueba && <EtiquetaPrueba />}</td>
                  <td data-label="Comprador">{v.comprador ?? <span className="tenue">—</span>}</td>
                  <td data-label="Sacos" className="num">{fmt(v.cantidadSacos)}</td>
                  <td data-label="Precio" className="num">{soles(v.precioUnitario)}</td>
                  <td data-label="Importe" className="num fuerte">{soles(v.importe)}</td>
                  <td data-label="Registró">{v.registradaPorNombre ?? "—"}</td>
                  <td data-label="Estado">
                    {v.anuladaEn ? (
                      <span className="badge badge-critico">Anulada</span>
                    ) : (
                      <span className="venta-acciones">
                        <span className="badge badge-ok">Activa</span>
                        {anulando !== v.id && (
                          <button type="button" className="btn-secundario btn-peligro btn-chico" onClick={() => { setAnulando(v.id); setMotivo(""); setMensajeAnulacion(null); }}>
                            Anular
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
                {v.anuladaEn && (
                  <tr className="fila-detalle-venta">
                    <td colSpan={8}>
                      Anulada el {fecha(v.anuladaEn)} por {v.anuladaPorNombre ?? "—"}: «{v.motivoAnulacion}». Los {sacos(v.cantidadSacos)} volvieron al stock del lote.
                    </td>
                  </tr>
                )}
                {anulando === v.id && !v.anuladaEn && (
                  <tr className="fila-detalle-venta">
                    <td colSpan={8}>
                      <form onSubmit={(e) => anular(e, v)} className="formulario-anulacion">
                        <label className="campo campo-bloque">
                          <span>Motivo de la anulación de la venta #{v.id} (obligatorio)</span>
                          <textarea rows={2} maxLength={LONGITUD_MAXIMA_MOTIVO_ANULACION} value={motivo} onChange={(e) => setMotivo(e.target.value)} required autoFocus />
                        </label>
                        <div className="acciones-anulacion">
                          <button type="submit" className="btn-secundario btn-peligro" disabled={procesandoAnulacion || !motivo.trim()}>
                            {procesandoAnulacion ? "Anulando…" : `Anular y devolver ${sacos(v.cantidadSacos)} al stock`}
                          </button>
                          <button type="button" className="btn-secundario" onClick={() => setAnulando(null)}>Cancelar</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {ventasVista.length === 0 && (
              <tr className="fila-vacia"><td colSpan={8}>Aún no hay ventas registradas en esta vista.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ventasVista.length > VENTAS_VISIBLES && (
        <button type="button" className="btn-link btn-ver-todas" onClick={() => setVerTodas((v) => !v)} aria-expanded={verTodas}>
          {verTodas ? `Mostrar solo las ${VENTAS_VISIBLES} más recientes` : `Ver todas las ventas (${ventasVista.length})`}
        </button>
      )}

      {/* ---- Ventas históricas ---- */}
      {historicasVista.length > 0 && (
        <details className="historicas">
          <summary>
            Ventas históricas ({historicasVista.length}) · registros anteriores al control de validación
          </summary>
          <p className="tarjeta-sub">
            Se registraron por lote completo, antes de que existiera la validación de conteos. Se conservan sin cambios
            y no cuentan para el stock disponible.
          </p>
          <div className="tabla-scroll">
            <table className="historial">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Lote</th>
                  <th className="num">Sacos del conteo</th>
                  <th className="num">Precio/saco</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {historicasVista.map((h) => (
                  <tr key={h.id} className={h.esPrueba ? "fila-prueba" : ""}>
                    <td data-label="Fecha">{fecha(h.creadoEn)}</td>
                    <td data-label="Lote">
                      #{h.conteoId} <span className="badge badge-historica" title="Registro anterior al control de validación">Histórica</span>
                      {h.esPrueba && <> <EtiquetaPrueba /></>}
                    </td>
                    <td data-label="Sacos del conteo" className="num">{h.cantidadSacosConteo === null ? "—" : fmt(h.cantidadSacosConteo)}</td>
                    <td data-label="Precio/saco" className="num">{soles(h.precioPorSaco)}</td>
                    <td data-label="Total" className="num">{soles(h.totalVenta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
