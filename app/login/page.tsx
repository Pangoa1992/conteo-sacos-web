"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "No se pudo iniciar sesión");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="login-shell">
      {/* Foto de la planta: panel lateral en computadora (#48) y banda superior en celular (#78) */}
      <figure className="login-foto">
        <picture>
          <source media="(max-width: 899px)" srcSet="/fotos/login-movil.webp" />
          <img
            src="/fotos/login-escritorio.webp"
            alt="Sacos de zanahoria listos en el lavadero"
            width={814}
            height={1086}
            fetchPriority="high"
          />
        </picture>
        <figcaption>Lavadero de zanahorias · conteo automatizado de sacos</figcaption>
      </figure>

      <div className="login-panel">
        <div className="plant-id">
          <img src="/logo-macromec.png" alt="MACROMEC" width={32} height={32} className="brand-mark" />
          <span className="name">Conteo de Sacos</span>
        </div>
        <p className="lede">MACROMEC J&S S.A.C. — acceso al panel de planta</p>

        <form onSubmit={handleSubmit} className="login-card">
          <label htmlFor="correo">Correo</label>
          <input id="correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />

          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-carrot" disabled={cargando}>
            {cargando ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}