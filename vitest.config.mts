import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// Pruebas unitarias de las reglas de negocio (lib/): sin servidor ni base de datos.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
