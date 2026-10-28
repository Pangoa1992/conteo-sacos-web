/** @type {import('next').NextConfig} */
const nextConfig = {
  // Optimizador de imágenes DESACTIVADO: la app no usa next/image y, con
  // unoptimized, /_next/image responde 404 sin procesar nada. Mitiga los avisos
  // de Next 14 sobre ese endpoint (RCE con AVIF/SVG, DoS, caché en disco sin
  // límite, remotePatterns) mientras no se actualice a la versión mayor 15/16.
  images: { unoptimized: true },
  // No anunciar «X-Powered-By: Next.js».
  poweredByHeader: false,
};

export default nextConfig;
