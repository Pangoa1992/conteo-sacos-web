export const metadata = {
  title: "Conteo de Sacos — MACROMEC",
  description: "Dashboard de conteo automatizado de sacos mediante visión computacional",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f5f7fa" }}>
        {children}
      </body>
    </html>
  );
}
