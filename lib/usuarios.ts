import { z } from "zod";

/**
 * Reglas del módulo de usuarios (sin base de datos: se prueban en tests/usuarios.test.ts).
 * Las rutas /api/usuarios y /api/auth/cambiar-password las aplican en el servidor.
 */

export const ROLES = ["admin_macromec", "cliente"] as const;
export type Rol = (typeof ROLES)[number];

export const ETIQUETA_ROL: Record<Rol, string> = {
  admin_macromec: "Personal de planta (administrador)",
  cliente: "Cliente (dueño de fábrica)",
};

export const LONGITUD_MINIMA_PASSWORD = 10;
// bcrypt solo usa los primeros 72 bytes: una contraseña más larga se aceptaría con cualquier final.
export const BYTES_MAXIMOS_PASSWORD = 72;
export const LONGITUD_MAXIMA_NOMBRE = 150;
export const LONGITUD_MAXIMA_CORREO = 150;

// Contraseñas que estuvieron publicadas (pantalla de login antigua e historial de GitHub).
const PASSWORDS_PUBLICAS = ["macromec2026", "fabrica2026"];

/** Correo en minúsculas y sin espacios alrededor: así no hay dos cuentas que solo difieran en mayúsculas. */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

/** Motivo por el que una contraseña nueva no se acepta, o null si es válida. */
export function problemaPassword(password: string, correo?: string): string | null {
  if (password.length < LONGITUD_MINIMA_PASSWORD) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres.`;
  }
  if (new TextEncoder().encode(password).length > BYTES_MAXIMOS_PASSWORD) {
    return `La contraseña es demasiado larga (máximo ${BYTES_MAXIMOS_PASSWORD} caracteres sin tildes).`;
  }
  if (password.trim() !== password) {
    return "La contraseña no puede empezar ni terminar con espacios.";
  }
  if (new Set(password).size < 4) {
    return "La contraseña es demasiado repetitiva: use al menos 4 caracteres distintos.";
  }
  const minuscula = password.toLowerCase();
  if (correo && (minuscula === normalizarCorreo(correo) || minuscula === normalizarCorreo(correo).split("@")[0])) {
    return "La contraseña no puede ser el correo.";
  }
  if (PASSWORDS_PUBLICAS.includes(minuscula)) {
    return "Esa contraseña fue pública: elija otra.";
  }
  return null;
}

const nombreSchema = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres.")
  .max(LONGITUD_MAXIMA_NOMBRE, `El nombre admite como máximo ${LONGITUD_MAXIMA_NOMBRE} caracteres.`);

const correoSchema = z
  .string()
  .trim()
  .max(LONGITUD_MAXIMA_CORREO, `El correo admite como máximo ${LONGITUD_MAXIMA_CORREO} caracteres.`)
  .email("Correo no válido.")
  .transform(normalizarCorreo);

// El límite real lo aplica problemaPassword; aquí solo se evita procesar textos enormes.
const passwordSchema = z.string().max(500, "La contraseña es demasiado larga.");

export const crearUsuarioSchema = z.object({
  nombre: nombreSchema,
  correo: correoSchema,
  rol: z.enum(ROLES, { message: "Rol no válido." }),
  password: passwordSchema,
});

export const editarUsuarioSchema = z
  .object({
    nombre: nombreSchema.optional(),
    rol: z.enum(ROLES, { message: "Rol no válido." }).optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.nombre !== undefined || d.rol !== undefined || d.activo !== undefined, "No hay cambios.");

export const restablecerPasswordSchema = z.object({ password: passwordSchema }).strict();

export const cambiarPasswordSchema = z.object({ actual: z.string().min(1).max(500), nueva: passwordSchema }).strict();

/** Primer mensaje de error de una validación zod, para mostrarlo tal cual. */
export function primerError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos inválidos.";
  if (issue.code === "unrecognized_keys") return "Datos inválidos.";
  return issue.message;
}

/** La sesión del token sigue valiendo: cuenta activa, misma versión de sesión y rol conocido. */
export function sesionSigueVigente(cuenta: { activo: boolean; sesionVersion: number; rol: string }, versionToken: number): boolean {
  return cuenta.activo && cuenta.sesionVersion === versionToken && (ROLES as readonly string[]).includes(cuenta.rol);
}

type Cuenta = { id: number; rol: string; activo: boolean };
type Cambio = { rol?: Rol; activo?: boolean };

/** El cambio deja a la cuenta sin poder administrar (la desactiva o le quita el rol de administrador). */
function quitaAdministrador(objetivo: Cuenta, cambio: Cambio): boolean {
  const esAdminActivo = objetivo.rol === "admin_macromec" && objetivo.activo;
  return esAdminActivo && (cambio.activo === false || (cambio.rol !== undefined && cambio.rol !== "admin_macromec"));
}

/**
 * Motivo por el que el administrador `actorId` no puede aplicar `cambio` a `objetivo`, o null.
 * `adminsActivos` = administradores activos ANTES del cambio (leídos con bloqueo en la transacción).
 */
export function motivoRechazoCambio(actorId: number, objetivo: Cuenta, cambio: Cambio, adminsActivos: number): string | null {
  if (objetivo.id === actorId && (cambio.activo === false || (cambio.rol !== undefined && cambio.rol !== objetivo.rol))) {
    return "No puede desactivar su propia cuenta ni cambiar su propio rol.";
  }
  if (quitaAdministrador(objetivo, cambio) && adminsActivos <= 1) {
    return "Debe quedar al menos un administrador activo.";
  }
  return null;
}

/** El cambio debe cerrar las sesiones abiertas de la cuenta (rol o estado distintos). */
export function cambioRevocaSesiones(objetivo: Cuenta, cambio: Cambio): boolean {
  return (cambio.rol !== undefined && cambio.rol !== objetivo.rol) || (cambio.activo !== undefined && cambio.activo !== objetivo.activo);
}
