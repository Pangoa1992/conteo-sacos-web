"use client";

import { useState } from "react";
import { ETIQUETA_ROL, LONGITUD_MINIMA_PASSWORD, problemaPassword, type Rol } from "@/lib/usuarios";

type Props = { usuario: { nombre: string; correo: string; rol: Rol } };

/**
 * «Mi cuenta»: datos del usuario y cambio de su propia contraseña (todos los roles).
 * Pide la actual; al cambiarla se cierran sus otras sesiones y esta sigue abierta.
 */
export function MiCuenta({ usuario }: Props) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  async function cambiar(e: React.FormEvent) {
    e.preventDefault();
    if (nueva !== repetida) {
      setMensaje({ ok: false, texto: "La contraseña nueva y su repetición no coinciden." });
      return;
    }
    const problema = problemaPassword(nueva, usuario.correo);
    if (problema) {
      setMensaje({ ok: false, texto: problema });
      return;
    }
    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/auth/cambiar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje({ ok: false, texto: data.error || "No se pudo cambiar la contraseña." });
        return;
      }
      setMensaje({ ok: true, texto: "Contraseña cambiada. Sus sesiones en otros equipos se cerraron; esta sigue abierta." });
      setActual("");
      setNueva("");
      setRepetida("");
    } catch {
      setMensaje({ ok: false, texto: "Error de conexión. Intente nuevamente." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="tarjeta" id="cuenta">
      <div className="tarjeta-head">
        <div>
          <h2>Mi cuenta</h2>
          <p className="tarjeta-sub">
            {usuario.nombre} · {usuario.correo} · {ETIQUETA_ROL[usuario.rol] ?? usuario.rol}
          </p>
        </div>
      </div>

      <h3 className="subtitulo">Cambiar mi contraseña</h3>
      <form onSubmit={cambiar} className="formulario" noValidate>
        <label className="campo campo-ancho">
          <span>Contraseña actual</span>
          <input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="campo campo-ancho">
          <span>Contraseña nueva (mín. {LONGITUD_MINIMA_PASSWORD})</span>
          <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" required />
        </label>
        <label className="campo campo-ancho">
          <span>Repita la contraseña nueva</span>
          <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" required />
        </label>
        <button type="submit" className="btn-acento" disabled={enviando || !actual || !nueva || !repetida}>
          {enviando ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>
      {mensaje && <p className={`mensaje ${mensaje.ok ? "mensaje-ok" : "mensaje-error"}`} role="status">{mensaje.texto}</p>}
    </section>
  );
}
