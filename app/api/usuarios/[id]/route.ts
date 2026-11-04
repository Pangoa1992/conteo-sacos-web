import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { cambioRevocaSesiones, editarUsuarioSchema, motivoRechazoCambio, primerError } from "@/lib/usuarios";
import { administradorDeSesion, COLUMNAS_PUBLICAS_USUARIO, idDeRuta } from "@/lib/usuarios-servidor";

/** Error de negocio que termina la transacción con una respuesta concreta. */
class Rechazo extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

/**
 * PATCH /api/usuarios/[id] — cambia el nombre, el rol o el estado (activo) de una cuenta.
 * Solo administrador. Reglas (lib/usuarios.ts):
 *   - nadie puede desactivarse ni cambiarse el rol a sí mismo;
 *   - siempre queda al menos un administrador activo (se comprueba con bloqueo, sin carreras);
 *   - cambiar el rol o el estado cierra las sesiones abiertas de esa cuenta.
 *   200 actualizado · 400 datos inválidos · 404 no existe · 409 regla incumplida
 */
export async function PATCH(req: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const { usuario, respuesta } = await administradorDeSesion(req);
  if (!usuario) return respuesta;

  const id = idDeRuta((await contexto.params).id);
  if (id === null) return NextResponse.json({ error: "Usuario no válido." }, { status: 400 });

  const parsed = editarUsuarioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: primerError(parsed.error) }, { status: 400 });
  const cambio = parsed.data;

  try {
    const actualizado = await db.transaction(async (tx) => {
      // Se bloquean los administradores activos (y la cuenta afectada) hasta terminar: dos cambios
      // simultáneos no pueden dejar el sistema sin administradores.
      const admins = await tx
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(and(eq(usuarios.rol, "admin_macromec"), eq(usuarios.activo, true)))
        .for("update");
      const [objetivo] = await tx
        .select({ id: usuarios.id, rol: usuarios.rol, activo: usuarios.activo })
        .from(usuarios)
        .where(eq(usuarios.id, id))
        .for("update");
      if (!objetivo) throw new Rechazo(404, "La cuenta no existe.");

      const motivo = motivoRechazoCambio(usuario.id, objetivo, cambio, admins.length);
      if (motivo) throw new Rechazo(409, motivo);

      const [fila] = await tx
        .update(usuarios)
        .set({
          ...(cambio.nombre !== undefined && { nombre: cambio.nombre }),
          ...(cambio.rol !== undefined && { rol: cambio.rol }),
          ...(cambio.activo !== undefined && { activo: cambio.activo }),
          ...(cambioRevocaSesiones(objetivo, cambio) && { sesionVersion: sql`${usuarios.sesionVersion} + 1` }),
        })
        .where(eq(usuarios.id, id))
        .returning(COLUMNAS_PUBLICAS_USUARIO);
      return fila;
    });

    console.info(`[usuarios] Cuenta ${id} modificada por el usuario ${usuario.id}: ${Object.keys(cambio).join(", ")}.`);
    return NextResponse.json({ usuario: actualizado });
  } catch (err) {
    if (err instanceof Rechazo) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[usuarios] Error al modificar:", mensajeErrorBD(err));
    return NextResponse.json({ error: "No se pudo modificar la cuenta." }, { status: 500 });
  }
}
