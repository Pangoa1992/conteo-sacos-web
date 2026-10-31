"use client";

import { useEffect, useState } from "react";
import type { EstadoWhatsapp as Estado } from "@/lib/estado-whatsapp";

type Props = {
  recarga?: unknown; // cambia cuando el dashboard actualiza sus datos
};

const URL_PUBLICA: Record<Estado["urlPublica"], string> = {
  https: "configurada (HTTPS)",
  no_https: "configurada sin HTTPS: Twilio exige HTTPS",
  no_configurada: "no configurada",
};

function Fila({ ok, titulo, detalle }: { ok: boolean; titulo: string; detalle: string }) {
  return (
    <li className="fuente">
      <span className={`estado-punto ${ok ? "estado-ok" : "estado-desconocido"}`} aria-hidden="true" />
      <div className="fuente-info">
        <span className="fuente-nombre-texto">{titulo}</span>
        <span className="fuente-meta">{detalle}</span>
      </div>
    </li>
  );
}

/**
 * Estado de las consultas por WhatsApp (etapa 5). Solo lo ve el personal de
 * MACROMEC. Muestra indicadores sin datos sensibles (GET /api/whatsapp/estado):
 * nunca el token, los números ni la URL pública.
 */
export function EstadoWhatsapp({ recarga }: Props) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/estado", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) {
          setError(data.error || "No se pudo consultar el estado de WhatsApp.");
          return;
        }
        setEstado(data);
        setError(null);
      } catch {
        if (vigente) setError("No se pudo consultar el estado de WhatsApp.");
      }
    })();
    return () => {
      vigente = false;
    };
  }, [recarga]);

  const e = estado;
  const numeros = e ? `${e.numerosAutorizados} número${e.numerosAutorizados === 1 ? "" : "s"} autorizado${e.numerosAutorizados === 1 ? "" : "s"}` : "";

  return (
    <section className="tarjeta" id="whatsapp">
      <div className="tarjeta-head">
        <div>
          <h2>Consultas por WhatsApp</h2>
          <p className="tarjeta-sub">
            Estado de la configuración en este servidor. No se muestran el token, los números ni la dirección pública.
          </p>
        </div>
      </div>
      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      {!e && !error && <p className="vacio">Consultando el estado…</p>}
      {e && (
        <>
          {e.modoDemo && (
            <p className="aviso aviso-prueba">
              Modo DEMO activo: WhatsApp responde con los lotes de prueba de la demostración y cada respuesta va marcada
              «🧪 DEMO · datos de prueba». No son datos de producción.
            </p>
          )}
          <ul className="fuentes estado-whatsapp">
            <Fila ok={e.webhookHabilitado} titulo="Webhook de Twilio"
              detalle={e.webhookHabilitado ? "habilitado (con verificación de firma)" : "deshabilitado: falta configurar el token de Twilio"} />
            <Fila ok={e.urlPublica === "https"} titulo="URL pública" detalle={URL_PUBLICA[e.urlPublica]} />
            <Fila ok={e.numerosAutorizados > 0} titulo="Números autorizados"
              detalle={e.numerosAutorizados > 0
                ? numeros + (e.entradasNoValidas > 0 ? ` · ${e.entradasNoValidas} entrada${e.entradasNoValidas === 1 ? "" : "s"} no válida${e.entradasNoValidas === 1 ? "" : "s"} (se ignora${e.entradasNoValidas === 1 ? "" : "n"})` : "")
                : "ninguno: nadie recibe información" + (e.entradasNoValidas > 0 ? ` (${e.entradasNoValidas} entrada${e.entradasNoValidas === 1 ? "" : "s"} no válida${e.entradasNoValidas === 1 ? "" : "s"})` : "")} />
            <Fila ok={e.hayConteosReales === true || e.modoDemo} titulo="Datos para responder"
              detalle={e.modoDemo ? "lotes de prueba de la demostración (modo DEMO)"
                : e.hayConteosReales === null ? "no se pudo consultar"
                : e.hayConteosReales ? "hay conteos reales" : "no hay conteos reales: WhatsApp responderá que no hay datos"} />
          </ul>
        </>
      )}
    </section>
  );
}
