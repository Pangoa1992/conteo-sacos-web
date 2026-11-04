import { describe, expect, it } from "vitest";
import {
  cambiarPasswordSchema,
  cambioRevocaSesiones,
  crearUsuarioSchema,
  editarUsuarioSchema,
  motivoRechazoCambio,
  normalizarCorreo,
  primerError,
  problemaPassword,
  sesionSigueVigente,
} from "@/lib/usuarios";

const ADMIN_1 = { id: 1, rol: "admin_macromec", activo: true };
const ADMIN_2 = { id: 2, rol: "admin_macromec", activo: true };
const CLIENTE = { id: 3, rol: "cliente", activo: true };

describe("Contraseñas nuevas (problemaPassword)", () => {
  it("acepta una contraseña razonable", () => {
    expect(problemaPassword("Zanahoria-Poza-7", "ana@macromec.com")).toBeNull();
  });

  it("exige al menos 10 caracteres", () => {
    expect(problemaPassword("Corta-1", "a@b.com")).toMatch(/al menos 10/);
  });

  it("rechaza más de 72 bytes (bcrypt ignoraría el resto)", () => {
    expect(problemaPassword("a1b2c3d4e5".repeat(8))).toMatch(/demasiado larga/);
    expect(problemaPassword("ñ".repeat(37))).toMatch(/demasiado larga/); // 74 bytes en UTF-8
  });

  it("rechaza espacios al principio o al final y contraseñas repetitivas", () => {
    expect(problemaPassword(" Zanahoria-7 ")).toMatch(/espacios/);
    expect(problemaPassword("aaaaaaaaaaaa")).toMatch(/repetitiva/);
  });

  it("rechaza el correo o su parte local como contraseña", () => {
    expect(problemaPassword("Admin.Planta@MACROMEC.com", "admin.planta@macromec.com")).toMatch(/correo/);
    expect(problemaPassword("admin.planta", "admin.planta@macromec.com")).toMatch(/correo/);
  });

  it("rechaza las contraseñas que fueron públicas", () => {
    expect(problemaPassword("macromec2026")).toMatch(/pública/);
    expect(problemaPassword("FABRICA2026")).toMatch(/pública/);
  });
});

describe("Datos de una cuenta nueva", () => {
  it("normaliza el correo a minúsculas y sin espacios", () => {
    expect(normalizarCorreo("  Ana.Torres@Fabrica.COM ")).toBe("ana.torres@fabrica.com");
    const r = crearUsuarioSchema.parse({ nombre: " Ana Torres ", correo: " Ana@Fabrica.com ", rol: "cliente", password: "x" });
    expect(r).toMatchObject({ nombre: "Ana Torres", correo: "ana@fabrica.com", rol: "cliente" });
  });

  it("rechaza un rol inexistente, un correo inválido o un nombre vacío", () => {
    const base = { nombre: "Ana", correo: "ana@fabrica.com", rol: "cliente", password: "x" };
    expect(crearUsuarioSchema.safeParse({ ...base, rol: "superusuario" }).success).toBe(false);
    expect(crearUsuarioSchema.safeParse({ ...base, correo: "no-es-correo" }).success).toBe(false);
    const sinNombre = crearUsuarioSchema.safeParse({ ...base, nombre: " " });
    expect(sinNombre.success).toBe(false);
    if (!sinNombre.success) expect(primerError(sinNombre.error)).toMatch(/nombre/);
  });

  it("al editar exige al menos un cambio y no admite campos desconocidos", () => {
    expect(editarUsuarioSchema.safeParse({}).success).toBe(false);
    expect(editarUsuarioSchema.safeParse({ activo: false }).success).toBe(true);
    expect(editarUsuarioSchema.safeParse({ passwordHash: "x" }).success).toBe(false);
    expect(editarUsuarioSchema.safeParse({ sesionVersion: 0 }).success).toBe(false);
    expect(cambiarPasswordSchema.safeParse({ actual: "", nueva: "x" }).success).toBe(false);
  });
});

describe("Reglas de administración (motivoRechazoCambio)", () => {
  it("nadie puede desactivarse ni cambiarse el rol a sí mismo", () => {
    expect(motivoRechazoCambio(1, ADMIN_1, { activo: false }, 2)).toMatch(/propia/);
    expect(motivoRechazoCambio(1, ADMIN_1, { rol: "cliente" }, 2)).toMatch(/propia|propio/);
  });

  it("sí puede cambiar su propio nombre o reenviar su mismo rol", () => {
    expect(motivoRechazoCambio(1, ADMIN_1, { rol: "admin_macromec" }, 1)).toBeNull();
  });

  it("siempre queda al menos un administrador activo", () => {
    expect(motivoRechazoCambio(1, ADMIN_2, { activo: false }, 1)).toMatch(/al menos un administrador/);
    expect(motivoRechazoCambio(1, ADMIN_2, { rol: "cliente" }, 1)).toMatch(/al menos un administrador/);
    expect(motivoRechazoCambio(1, ADMIN_2, { activo: false }, 2)).toBeNull();
  });

  it("desactivar o cambiar el rol de un cliente no depende de los administradores", () => {
    expect(motivoRechazoCambio(1, CLIENTE, { activo: false }, 1)).toBeNull();
    expect(motivoRechazoCambio(1, CLIENTE, { rol: "admin_macromec" }, 1)).toBeNull();
  });

  it("reactivar un administrador desactivado siempre se permite", () => {
    expect(motivoRechazoCambio(1, { id: 2, rol: "admin_macromec", activo: false }, { activo: true }, 1)).toBeNull();
  });
});

describe("Revocación de sesiones", () => {
  it("cambiar rol o estado cierra las sesiones; cambiar solo el nombre no", () => {
    expect(cambioRevocaSesiones(CLIENTE, { activo: false })).toBe(true);
    expect(cambioRevocaSesiones(CLIENTE, { rol: "admin_macromec" })).toBe(true);
    expect(cambioRevocaSesiones(CLIENTE, { rol: "cliente" })).toBe(false);
    expect(cambioRevocaSesiones(CLIENTE, {})).toBe(false);
  });

  it("un token vale solo si la cuenta está activa, con la misma versión y un rol conocido", () => {
    expect(sesionSigueVigente({ activo: true, sesionVersion: 2, rol: "cliente" }, 2)).toBe(true);
    expect(sesionSigueVigente({ activo: false, sesionVersion: 2, rol: "cliente" }, 2)).toBe(false);
    expect(sesionSigueVigente({ activo: true, sesionVersion: 3, rol: "cliente" }, 2)).toBe(false);
    expect(sesionSigueVigente({ activo: true, sesionVersion: 0, rol: "otro" }, 0)).toBe(false);
  });
});
