"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

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
      <div className="plant-id">
        <Image src="/logo-macromec.png" alt="MACROMEC" width={32} height={32} className="brand-mark" />
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

      <p className="login-hint">
        Cuentas de prueba: <code>admin@macromec.com</code> / <code>macromec2026</code> (personal)
        {" "}o <code>dueno@fabrica.com</code> / <code>fabrica2026</code> (dueño de fábrica).
      </p>
    </main>
  );
}
