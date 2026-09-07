import "./globals.css";

export const metadata = {
  title: "Conteo de Sacos — MACROMEC",
  description: "Dashboard de conteo automatizado de sacos mediante visión computacional",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
