/** @type {import('next').NextConfig} */
const nextConfig = {
  // Optimizador de imágenes DESACTIVADO: la app no usa next/image y, con
  // unoptimized, /_next/image responde 404 sin procesar nada. Mitiga los avisos
  // de Next.js sobre ese endpoint (RCE con AVIF/SVG, DoS, caché en disco sin
  // límite, remotePatterns) mientras no se actualice a la versión mayor 15/16.
  images: { unoptimized: true },
  // No anunciar «X-Powered-By: Next.js».
  poweredByHeader: false,
  // Cabeceras de seguridad en todas las respuestas (auditoría del 21/11/2026):
  //  - el panel no se puede incrustar en otra página (clickjacking);
  //  - el navegador no adivina tipos de archivo;
  //  - no se envía la dirección completa a otros sitios;
  //  - la página no puede usar cámara (salvo la propia, para «Tomar foto»), micrófono ni ubicación.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
