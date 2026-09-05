import { Dashboard } from "@/components/Dashboard";

/**
 * Página principal: dashboard de conteo en tiempo real.
 * Consume GET /api/conteo (ver ese endpoint para el modo simulado
 * que se usa mientras no hay cámara/BD real conectada).
 */
export default async function HomePage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ color: "#1F3864" }}>📦 Conteo de Sacos — MACROMEC</h1>
      <p style={{ color: "#555" }}>
        Sistema de conteo automatizado mediante visión computacional. Fábrica de lavado de zanahorias.
      </p>
      <Dashboard />
    </main>
  );
}
