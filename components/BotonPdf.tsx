"use client";

import { useState } from "react";

type Props = {
  /** id de la sección (tarjeta) cuyas tablas se exportan. */
  seccionId: string;
  titulo: string;
  /** Base del nombre del archivo («inventario» → inventario-2026-11-14.pdf). */
  archivo: string;
  esPrueba?: boolean;
  deshabilitado?: boolean;
  /** Antes de leer las tablas (p. ej. mostrar todas las filas); se espera a que React pinte. */
  preparar?: () => void;
};

/**
 * «Exportar PDF»: genera en el navegador un reporte con las tablas que se ven en
 * la sección (con los filtros aplicados), con encabezado MACROMEC y numeración.
 */
export function BotonPdf({ seccionId, titulo, archivo, esPrueba, deshabilitado, preparar }: Props) {
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState(false);

  async function exportar() {
    const seccion = document.getElementById(seccionId);
    if (!seccion) return;
    setGenerando(true);
    setError(false);
    try {
      if (preparar) {
        preparar();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      const { exportarSeccionPdf } = await import("@/lib/pdf-generar");
      exportarSeccionPdf(seccion, { titulo, archivo, esPrueba });
    } catch {
      setError(true);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <span className="boton-pdf" data-pdf-omitir>
      <button type="button" className="btn-secundario" onClick={exportar} disabled={generando || deshabilitado}>
        {generando ? "Generando PDF…" : "Exportar PDF"}
      </button>
      {error && <span className="mensaje-error-inline" role="alert"> No se pudo generar el PDF.</span>}
    </span>
  );
}
