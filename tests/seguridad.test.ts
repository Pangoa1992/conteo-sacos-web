import { afterEach, describe, expect, it } from "vitest";
import { autenticacionConfigurada, crearToken, verificarToken, type SesionUsuario } from "@/lib/auth";
import { compararPassword, hashearPassword } from "@/lib/password";
import { compararSecreto, extraerBearer } from "@/lib/seguridad";
import { motivoRechazoEntornoDemo, bdConfirmaDemo, VALOR_DEMO_WHATSAPP } from "@/lib/modo-demo-whatsapp";

const SECRETO = "s".repeat(48);
const ADMIN: SesionUsuario = { id: 1, nombre: "Admin", correo: "admin@macromec.local", rol: "admin_macromec" };
const original = process.env.JWT_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

describe("Sesión JWT (lib/auth)", () => {
  it("sin JWT_SECRET la autenticación queda deshabilitada (falla de forma segura)", async () => {
    delete process.env.JWT_SECRET;
    expect(autenticacionConfigurada()).toBe(false);
    await expect(crearToken(ADMIN)).rejects.toThrow();
    expect(await verificarToken("cualquier.cosa.firmada")).toBeNull();
  });

  it("rechaza un JWT_SECRET de menos de 32 caracteres", () => {
    process.env.JWT_SECRET = "corto";
    expect(autenticacionConfigurada()).toBe(false);
  });

  it("emite y verifica un token con los datos y el rol del usuario", async () => {
    process.env.JWT_SECRET = SECRETO;
    const token = await crearToken(ADMIN);
    expect(await verificarToken(token)).toEqual(ADMIN);
  });

  it("rechaza un token firmado con otra clave", async () => {
    process.env.JWT_SECRET = SECRETO;
    const token = await crearToken(ADMIN);
    process.env.JWT_SECRET = "x".repeat(48);
    expect(await verificarToken(token)).toBeNull();
  });

  it("rechaza un token alterado (escalada de rol)", async () => {
    process.env.JWT_SECRET = SECRETO;
    const token = await crearToken({ ...ADMIN, rol: "cliente" });
    const [cab, carga, firma] = token.split(".");
    const datos = JSON.parse(Buffer.from(carga, "base64url").toString());
    const alterada = Buffer.from(JSON.stringify({ ...datos, rol: "admin_macromec" })).toString("base64url");
    expect(await verificarToken(`${cab}.${alterada}.${firma}`)).toBeNull();
  });

  it("rechaza un token con un rol desconocido", async () => {
    process.env.JWT_SECRET = SECRETO;
    const token = await crearToken({ ...ADMIN, rol: "superusuario" as SesionUsuario["rol"] });
    expect(await verificarToken(token)).toBeNull();
  });
});

describe("Contraseñas (lib/password)", () => {
  it("guarda un hash bcrypt, nunca el texto plano, y lo verifica", async () => {
    const hash = await hashearPassword("Clave-Segura-2026");
    expect(hash).not.toContain("Clave-Segura-2026");
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await compararPassword("Clave-Segura-2026", hash)).toBe(true);
    expect(await compararPassword("clave-segura-2026", hash)).toBe(false);
  });
});

describe("Token del módulo de visión (lib/seguridad)", () => {
  it("compara secretos sin depender de la longitud", () => {
    expect(compararSecreto("token-correcto", "token-correcto")).toBe(true);
    expect(compararSecreto("token-incorrecto", "token-correcto")).toBe(false);
    expect(compararSecreto("", "token-correcto")).toBe(false);
  });

  it("extrae el token Bearer de la cabecera Authorization", () => {
    expect(extraerBearer("Bearer abc123")).toBe("abc123");
    expect(extraerBearer("bearer   abc123  ")).toBe("abc123");
    expect(extraerBearer(null)).toBe("");
  });
});

describe("Modo de demostración de WhatsApp (nunca en producción)", () => {
  const LOCAL = { MACROMEC_DEMO_WHATSAPP: VALOR_DEMO_WHATSAPP, DATABASE_URL: "postgresql://u:p@localhost:5433/conteo_sacos_demo" };

  it("solo se activa con la variable exacta y la base local de demostración", () => {
    expect(motivoRechazoEntornoDemo(LOCAL)).toBeNull();
    expect(motivoRechazoEntornoDemo({})).toBe("sin_variable");
    expect(motivoRechazoEntornoDemo({ ...LOCAL, MACROMEC_DEMO_WHATSAPP: "si" })).toBe("variable");
  });

  it("se rechaza en Vercel y con cualquier otra base de datos", () => {
    expect(motivoRechazoEntornoDemo({ ...LOCAL, VERCEL: "1" })).toBe("vercel");
    expect(motivoRechazoEntornoDemo({ ...LOCAL, DATABASE_URL: "postgresql://u:p@neon.tech/conteo_sacos_demo" })).toBe("url");
    expect(motivoRechazoEntornoDemo({ ...LOCAL, DATABASE_URL: "postgresql://u:p@localhost:5433/conteo_sacos" })).toBe("url");
    expect(motivoRechazoEntornoDemo({ ...LOCAL, DATABASE_URL: "postgresql://u:p@localhost:5433/conteo_sacos_demo?host=otro" })).toBe("url");
  });

  it("la base debe confirmar que es de demostración y que no tiene lotes reales", () => {
    const ok = { bd: "conteo_sacos_demo", comentario: "SOLO DATOS DE DEMOSTRACION (seed)", reales: 0 };
    expect(bdConfirmaDemo(ok)).toBe(true);
    expect(bdConfirmaDemo({ ...ok, reales: 1 })).toBe(false);
    expect(bdConfirmaDemo({ ...ok, comentario: null })).toBe(false);
    expect(bdConfirmaDemo(undefined)).toBe(false);
  });
});
