"use client";

import { useEffect, useState } from "react";
import { ETIQUETA_ROL, LONGITUD_MAXIMA_CORREO, LONGITUD_MAXIMA_NOMBRE, LONGITUD_MINIMA_PASSWORD, problemaPassword, type Rol } from "@/lib/usuarios";

type Cuenta = { id: number; nombre: string; correo: string; rol: Rol; activo: boolean; creadoEn: string };
type Mensaje = { ok: boolean; texto: string } | null;
type Accion = { id: number; tipo: "editar" | "password" | "estado" } | null;

const ROL_CORTO: Record<Rol, string> = { admin_macromec: "Administrador", cliente: "Cliente" };

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Lima" });
}

async function enviar(url: string, metodo: string, cuerpo: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/**
 * Gestión de usuarios (solo administrador): alta de cuentas, cambio de nombre y rol,
 * contraseña nueva para quien la olvidó, y desactivar/activar. Las reglas las aplica
 * el servidor (/api/usuarios): nadie se desactiva a sí mismo y siempre queda un administrador.
 */
export function UsuariosModule() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [yo, setYo] = useState<number | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);

  // Alta
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<Rol>("cliente");
  const [password, setPassword] = useState("");
  const [creando, setCreando] = useState(false);
  const [mensajeAlta, setMensajeAlta] = useState<Mensaje>(null);

  // Acciones por fila
  const [accion, setAccion] = useState<Accion>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editRol, setEditRol] = useState<Rol>("cliente");
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [mensajeFila, setMensajeFila] = useState<Mensaje>(null);
  const [mensajeGeneral, setMensajeGeneral] = useState<Mensaje>(null);

  async function cargar() {
    try {
      const res = await fetch("/api/usuarios", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCarga(data.error || "No se pudo cargar la lista de usuarios.");
        return;
      }
      setCuentas(data.usuarios);
      setYo(data.yo);
      setErrorCarga(null);
    } catch {
      setErrorCarga("No se pudo cargar la lista de usuarios.");
    } finally {
      setCargado(true);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaPassword(password, correo);
    if (problema) {
      setMensajeAlta({ ok: false, texto: problema });
      return;
    }
    setCreando(true);
    setMensajeAlta(null);
    try {
      const { ok, data } = await enviar("/api/usuarios", "POST", { nombre, correo, rol, password });
      if (!ok) {
        setMensajeAlta({ ok: false, texto: String(data.error || "No se pudo crear la cuenta.") });
        return;
      }
      const creado = data.usuario as Cuenta;
      setMensajeAlta({ ok: true, texto: `Cuenta creada: ${creado.correo} (${ROL_CORTO[creado.rol]}). Entréguele la contraseña por un medio privado.` });
      setNombre("");
      setCorreo("");
      setPassword("");
      setRol("cliente");
      await cargar();
    } catch {
      setMensajeAlta({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setCreando(false);
    }
  }

  function abrir(c: Cuenta, tipo: NonNullable<Accion>["tipo"]) {
    setAccion({ id: c.id, tipo });
    setEditNombre(c.nombre);
    setEditRol(c.rol);
    setNuevaPassword("");
    setMensajeFila(null);
    setMensajeGeneral(null);
  }

  async function aplicar(c: Cuenta, url: string, metodo: string, cuerpo: unknown, exito: string) {
    setProcesando(true);
    setMensajeFila(null);
    try {
      const { ok, data } = await enviar(url, metodo, cuerpo);
      if (!ok) {
        setMensajeFila({ ok: false, texto: String(data.error || "No se pudo completar la operación.") });
        return;
      }
      setAccion(null);
      setMensajeGeneral({ ok: true, texto: exito });
      await cargar();
    } catch {
      setMensajeFila({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setProcesando(false);
    }
  }

  function guardarEdicion(e: React.FormEvent, c: Cuenta) {
    e.preventDefault();
    const cambio: { nombre?: string; rol?: Rol } = {};
    if (editNombre.trim() !== c.nombre) cambio.nombre = editNombre.trim();
    if (editRol !== c.rol) cambio.rol = editRol;
    if (Object.keys(cambio).length === 0) {
      setAccion(null);
      return;
    }
    const aviso = cambio.rol ? " Su sesión abierta se cerró: deberá volver a ingresar." : "";
    aplicar(c, `/api/usuarios/${c.id}`, "PATCH", cambio, `Cuenta ${c.correo} actualizada.${aviso}`);
  }

  function guardarPassword(e: React.FormEvent, c: Cuenta) {
    e.preventDefault();
    const problema = problemaPassword(nuevaPassword, c.correo);
    if (problema) {
      setMensajeFila({ ok: false, texto: problema });
      return;
    }
    aplicar(c, `/api/usuarios/${c.id}/password`, "POST", { password: nuevaPassword },
      `Contraseña de ${c.correo} cambiada y sus sesiones abiertas cerradas. Entréguesela por un medio privado.`);
  }

  function cambiarEstado(c: Cuenta) {
    aplicar(c, `/api/usuarios/${c.id}`, "PATCH", { activo: !c.activo },
      c.activo ? `Cuenta ${c.correo} desactivada: ya no puede ingresar.` : `Cuenta ${c.correo} activada de nuevo.`);
  }

  const activos = cuentas.filter((c) => c.activo).length;

  return (
    <section className="tarjeta" id="usuarios">
      <div className="tarjeta-head">
        <div>
          <h2>Usuarios</h2>
          <p className="tarjeta-sub">
            Cuentas con acceso al panel · {cuentas.length} en total, {activos} activa{activos === 1 ? "" : "s"} · las contraseñas se guardan cifradas y nunca se muestran
          </p>
        </div>
      </div>

      {/* ---- Alta ---- */}
      <h3 className="subtitulo">Nueva cuenta</h3>
      <form onSubmit={crear} className="formulario" noValidate>
        <label className="campo campo-ancho">
          <span>Nombre</span>
          <input type="text" value={nombre} maxLength={LONGITUD_MAXIMA_NOMBRE} onChange={(e) => setNombre(e.target.value)} required autoComplete="off" />
        </label>
        <label className="campo campo-ancho">
          <span>Correo</span>
          <input type="email" value={correo} maxLength={LONGITUD_MAXIMA_CORREO} onChange={(e) => setCorreo(e.target.value)} required autoComplete="off" />
        </label>
        <label className="campo">
          <span>Rol</span>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            <option value="cliente">{ETIQUETA_ROL.cliente}</option>
            <option value="admin_macromec">{ETIQUETA_ROL.admin_macromec}</option>
          </select>
        </label>
        <label className="campo campo-ancho">
          <span>Contraseña inicial (mín. {LONGITUD_MINIMA_PASSWORD})</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        </label>
        <button type="submit" className="btn-acento" disabled={creando || !nombre.trim() || !correo.trim() || !password}>
          {creando ? "Creando…" : "Crear cuenta"}
        </button>
      </form>
      {mensajeAlta && <p className={`mensaje ${mensajeAlta.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensajeAlta.texto}</p>}

      {/* ---- Lista ---- */}
      <h3 className="subtitulo">Cuentas registradas</h3>
      {errorCarga && <p className="mensaje mensaje-error" role="alert">{errorCarga}</p>}
      {mensajeGeneral && <p className={`mensaje ${mensajeGeneral.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensajeGeneral.texto}</p>}
      {!cargado && <p className="vacio">Cargando usuarios…</p>}
      {cargado && !errorCarga && (
        <div className="tabla-scroll">
          <table className="historial tabla-usuarios">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Alta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => {
                const soyYo = c.id === yo;
                const abierta = accion?.id === c.id ? accion.tipo : null;
                return (
                  <tr key={c.id} className={c.activo ? undefined : "fila-anulada"}>
                    <td data-label="Nombre">{c.nombre}{soyYo && <span className="tenue"> (usted)</span>}</td>
                    <td data-label="Correo">{c.correo}</td>
                    <td data-label="Rol">{ROL_CORTO[c.rol] ?? c.rol}</td>
                    <td data-label="Estado">
                      <span className={`badge ${c.activo ? "badge-ok" : "badge-agotado"}`}>{c.activo ? "Activa" : "Desactivada"}</span>
                    </td>
                    <td data-label="Alta">{fechaCorta(c.creadoEn)}</td>
                    <td data-label="Acciones">
                      {!abierta && (
                        <span className="venta-acciones">
                          <button type="button" className="btn-secundario btn-chico" onClick={() => abrir(c, "editar")}>Editar</button>
                          {!soyYo && (
                            <>
                              <button type="button" className="btn-secundario btn-chico" onClick={() => abrir(c, "password")}>Nueva contraseña</button>
                              <button type="button" className={`btn-secundario btn-chico ${c.activo ? "btn-peligro" : ""}`} onClick={() => abrir(c, "estado")}>
                                {c.activo ? "Desactivar" : "Activar"}
                              </button>
                            </>
                          )}
                        </span>
                      )}

                      {abierta === "editar" && (
                        <form onSubmit={(e) => guardarEdicion(e, c)} className="formulario-anulacion" noValidate>
                          <label className="campo">
                            <span>Nombre</span>
                            <input type="text" value={editNombre} maxLength={LONGITUD_MAXIMA_NOMBRE} onChange={(e) => setEditNombre(e.target.value)} />
                          </label>
                          <label className="campo">
                            <span>Rol</span>
                            <select value={editRol} onChange={(e) => setEditRol(e.target.value as Rol)} disabled={soyYo}>
                              <option value="cliente">{ROL_CORTO.cliente}</option>
                              <option value="admin_macromec">{ROL_CORTO.admin_macromec}</option>
                            </select>
                          </label>
                          {soyYo && <span className="tenue">No puede cambiar su propio rol.</span>}
                          <div className="acciones-anulacion">
                            <button type="submit" className="btn-acento btn-chico" disabled={procesando || editNombre.trim().length < 2}>Guardar</button>
                            <button type="button" className="btn-secundario btn-chico" onClick={() => setAccion(null)}>Cancelar</button>
                          </div>
                        </form>
                      )}

                      {abierta === "password" && (
                        <form onSubmit={(e) => guardarPassword(e, c)} className="formulario-anulacion" noValidate>
                          <label className="campo">
                            <span>Contraseña nueva (mín. {LONGITUD_MINIMA_PASSWORD})</span>
                            <input type="password" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} autoComplete="new-password" />
                          </label>
                          <span className="tenue">Se cerrarán las sesiones abiertas de esta cuenta.</span>
                          <div className="acciones-anulacion">
                            <button type="submit" className="btn-acento btn-chico" disabled={procesando || !nuevaPassword}>Cambiar contraseña</button>
                            <button type="button" className="btn-secundario btn-chico" onClick={() => setAccion(null)}>Cancelar</button>
                          </div>
                        </form>
                      )}

                      {abierta === "estado" && (
                        <div className="formulario-anulacion">
                          <span>
                            {c.activo
                              ? `¿Desactivar a ${c.nombre}? No podrá ingresar y sus sesiones abiertas se cerrarán. Sus registros se conservan.`
                              : `¿Activar de nuevo a ${c.nombre}? Podrá ingresar con su contraseña.`}
                          </span>
                          <div className="acciones-anulacion">
                            <button type="button" className={`btn-secundario btn-chico ${c.activo ? "btn-peligro" : ""}`} disabled={procesando} onClick={() => cambiarEstado(c)}>
                              {c.activo ? "Sí, desactivar" : "Sí, activar"}
                            </button>
                            <button type="button" className="btn-secundario btn-chico" onClick={() => setAccion(null)}>Cancelar</button>
                          </div>
                        </div>
                      )}

                      {abierta && mensajeFila && (
                        <p className={`mensaje ${mensajeFila.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensajeFila.texto}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
