import { desc, eq, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { db } from "@/db";
import { respaldos, usuarios } from "@/db/schema";
import { mensajeErrorBD } from "./errores-bd";
import { COLUMNAS_PROHIBIDAS, TABLAS_RESPALDO, csvRespaldo, sha256, textoLeeme, type Manifiesto } from "./respaldo";

// Solo servidor.

/** Lee todas las tablas del respaldo y arma el ZIP. Una sola transacción de lectura: datos coherentes entre tablas. */
export async function generarRespaldo(generadoPor: string, ahora = new Date()) {
  const lecturas = await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    const salida: { tabla: (typeof TABLAS_RESPALDO)[number]; filas: (string | null)[][] }[] = [];
    for (const tabla of TABLAS_RESPALDO) {
      if (tabla.columnas.some((c) => COLUMNAS_PROHIBIDAS.includes(c))) throw new Error(`Columna prohibida en ${tabla.nombre}`);
      // Nombres fijos de TABLAS_RESPALDO (no vienen del usuario): cada columna en texto, tal como la guarda PostgreSQL.
      const columnas = tabla.columnas.map((c) => `"${c}"::text as "${c}"`).join(", ");
      const filas = await tx.execute<Record<string, string | null>>(sql.raw(`select ${columnas} from "${tabla.nombre}" order by "id"`));
      salida.push({ tabla, filas: Array.from(filas, (f) => tabla.columnas.map((c) => f[c] ?? null)) });
    }
    return salida;
  });

  const archivos: Record<string, Uint8Array> = {};
  const manifiesto: Manifiesto = { sistema: "MACROMEC - Sistema de Conteo de Sacos de Zanahoria", generado: ahora.toISOString(), generadoPor, archivos: [], totalRegistros: 0 };
  for (const { tabla, filas } of lecturas) {
    const archivo = `${tabla.nombre}.csv`;
    const datos = strToU8(csvRespaldo(tabla.columnas, filas));
    archivos[archivo] = datos;
    manifiesto.archivos.push({ archivo, tabla: tabla.nombre, descripcion: tabla.descripcion, registros: filas.length, sha256: sha256(datos) });
    manifiesto.totalRegistros += filas.length;
  }
  archivos["manifiesto.json"] = strToU8(JSON.stringify(manifiesto, null, 2));
  archivos["LEEME.txt"] = strToU8(textoLeeme(manifiesto));
  const zip = zipSync(archivos, { level: 6, mtime: ahora });
  return { zip, manifiesto, huella: sha256(zip) };
}

/** Anota la descarga. Si la tabla aún no existe (migración 0009 pendiente), no impide descargar. */
export async function registrarRespaldo(usuarioId: number, registros: number, bytes: number, huella: string): Promise<boolean> {
  try {
    await db.insert(respaldos).values({ usuarioId, registros, bytes, sha256: huella });
    return true;
  } catch (err) {
    console.error("[respaldo] No se pudo anotar la descarga (¿falta la migración 0009?):", mensajeErrorBD(err));
    return false;
  }
}

/** Últimas descargas (null si la tabla aún no existe). */
export async function historialRespaldos(limite = 10) {
  try {
    return await db
      .select({ id: respaldos.id, creadoEn: respaldos.creadoEn, registros: respaldos.registros, bytes: respaldos.bytes, sha256: respaldos.sha256, usuario: usuarios.nombre })
      .from(respaldos)
      .innerJoin(usuarios, eq(usuarios.id, respaldos.usuarioId))
      .orderBy(desc(respaldos.id))
      .limit(limite);
  } catch (err) {
    console.error("[respaldo] No se pudo leer el historial (¿falta la migración 0009?):", mensajeErrorBD(err));
    return null;
  }
}

/** Cantidad de registros por tabla (para mostrar qué se va a respaldar). */
export async function conteoPorTabla() {
  const partes = TABLAS_RESPALDO.map((t) => `select '${t.nombre}' as tabla, count(*)::int as registros from "${t.nombre}"`).join(" union all ");
  const filas = await db.execute<{ tabla: string; registros: number }>(sql.raw(partes));
  return TABLAS_RESPALDO.map((t) => ({
    tabla: t.nombre,
    descripcion: t.descripcion,
    registros: Array.from(filas).find((f) => f.tabla === t.nombre)?.registros ?? 0,
  }));
}
