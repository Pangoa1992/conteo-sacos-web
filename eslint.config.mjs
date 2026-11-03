import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

// Reglas oficiales de Next.js (React, hooks, accesibilidad básica y TypeScript).
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "db/migrations/**", "next-env.d.ts", "actualizacion-seguridad/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Variables omitidas a propósito al quitar campos de un objeto ({ campo, ...resto })
      // y parámetros obligatorios de las rutas que no se usan (prefijo _).
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
      // Las imágenes son fotos de evidencia protegidas por sesión, vistas previas locales
      // (blob:) y fotos ya optimizadas en WebP; next.config usa images.unoptimized.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
