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
    <main style={{ maxWidth: 400, margin: "4rem auto", padding: "0 1rem" }}>
      <h1 style={{ color: "#1F3864", fontSize: 24 }}>📦 Conteo de Sacos — MACROMEC</h1>
      <p style={{ color: "#888", marginBottom: "2rem" }}>Inicia sesión para continuar</p>

      <form onSubmit={handleSubmit} style={{ background: "white", padding: "1.5rem", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <label style={{ display: "block", marginBottom: 4, fontSize: 14, color: "#555" }}>Correo</label>
        <input
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          required
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem", border: "1px solid #ddd", borderRadius: 6 }}
        />

        <label style={{ display: "block", marginBottom: 4, fontSize: 14, color: "#555" }}>Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem", border: "1px solid #ddd", borderRadius: 6 }}
        />

        {error && <p style={{ color: "#c0392b", fontSize: 14, marginBottom: "1rem" }}>{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          style={{ width: "100%", padding: "0.6rem", background: "#1F3864", color: "white", border: "none", borderRadius: 6, fontWeight: "bold", cursor: "pointer" }}
        >
          {cargando ? "Ingresando..." : "Ingresar"}
        </button>
      </form>

      <p style={{ fontSize: 13, color: "#999", marginTop: "1.5rem" }}>
        Cuentas de prueba: <code>admin@macromec.com</code> / <code>macromec2026</code>
        {" "}(personal) o <code>dueno@fabrica.com</code> / <code>fabrica2026</code> (dueño de fábrica).
      </p>
    </main>
  );
}
