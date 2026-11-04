import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import { ZONA_HORARIA_PLANTA, type EstadoValidacion } from "@/lib/conteos";
import { TIPOS_DATO, esFechaValida, type TipoDato } from "@/lib/inventario";
import { ordenVigenciaReporteSql } from "@/lib/reportes-contratista-servidor";

export const dynamic = "force-dynamic";

const POR_PAGINA = 20;
const PAGINA_MAXIMA = 10000;
const LONGITUD_MAXIMA_BUSQUEDA = 100;
const SIN_CACHE = { "Cache-Control": "private, no-store" };

const ZONA = sql.raw(`'${ZONA_HORARIA_PLANTA}'`);
const FECHA_CONTEO = sql`coalesce(c.contado_en, c.creado_en)`;
const HORA_PLANTA = sql`((${FECHA_CONTEO} at time zone 'UTC') at time zone ${ZONA})`;
const ES_PRUEBA = sql`(lower(c.origen) like 'prueba%')`;

type LoteEncontrado = {
  id: number;
  cantidadSacos: number;
  fechaConteo: string;
  esPrueba: boolean;
  estadoValidacion: EstadoValidacion;
  origen: string;
  fuenteCamara: string | null;
  reporteVigente: { cantidadReportada: number; nombreContratista: string | null } | null;
};

/**
 * GET /api/reportes-contratista/lotes
 * Busca lotes para registrar un reporte del contratista, aunque sean antiguos
 * (el formulario solo trae los más recientes). Solo admin_macromec, que es quien
 * registra. Paginado en el servidor: nunca se envían todos los lotes.
 *
 *   q: número de lote (exacto, admite "#123") o parte del nombre de la cámara
 *   desde / hasta: fecha original del conteo (AAAA-MM-DD, hora de Lima)
 *   tipo: real | prueba | todos (por defecto real) · pagina: 0, 1, 2…
 *
 *   200 { lotes, pagina, porPagina, hayMas } · 400 · 401 · 403
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });
  if (usuario.rol !== "admin_macromec") return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE });

  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").trim();
  const desde = p.get("desde") || null;
  const hasta = p.get("hasta") || null;
  const tipo = (p.get("tipo") || "real") as TipoDato;
  const paginaTexto = p.get("pagina") || "0";

  const errores: string[] = [];
  if (q.length > LONGITUD_MAXIMA_BUSQUEDA) errores.push("Búsqueda demasiado larga.");
  if (desde && !esFechaValida(desde)) errores.push("«desde» debe ser una fecha AAAA-MM-DD.");
  if (hasta && !esFechaValida(hasta)) errores.push("«hasta» debe ser una fecha AAAA-MM-DD.");
  if (desde && hasta && esFechaValida(desde) && esFechaValida(hasta) && desde > hasta) errores.push("«desde» no puede ser posterior a «hasta».");
  if (!TIPOS_DATO.includes(tipo)) errores.push(`«tipo» debe ser ${TIPOS_DATO.join(", ")}.`);
  if (!/^\d{1,5}$/.test(paginaTexto) || Number(paginaTexto) > PAGINA_MAXIMA) errores.push("«pagina» debe ser un número de página válido.");
  if (errores.length) return NextResponse.json({ error: "Filtros inválidos", detalles: errores }, { status: 400, headers: SIN_CACHE });

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ modoSimulado: true, lotes: [], pagina: 0, porPagina: POR_PAGINA, hayMas: false }, { headers: SIN_CACHE });
  }

  const pagina = Number(paginaTexto);
  const cs: SQL[] = [sql`true`];
  if (tipo === "real") cs.push(sql`not ${ES_PRUEBA}`);
  if (tipo === "prueba") cs.push(ES_PRUEBA);
  if (desde) cs.push(sql`${HORA_PLANTA}::date >= ${desde}::date`);
  if (hasta) cs.push(sql`${HORA_PLANTA}::date <= ${hasta}::date`);
  const numero = q.match(/^#?(\d{1,9})$/);
  if (numero) cs.push(sql`c.id = ${Number(numero[1])}`);
  else if (q) cs.push(sql`c.fuente_camara ilike ${"%" + q.replace(/[\\%_]/g, (x) => "\\" + x) + "%"}`);

  const filas = [...(await db.execute<LoteEncontrado>(sql`
    select c.id, c.cantidad_sacos as "cantidadSacos",
      to_char(${FECHA_CONTEO}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "fechaConteo", ${ES_PRUEBA} as "esPrueba",
      c.estado_validacion as "estadoValidacion", c.origen, c.fuente_camara as "fuenteCamara",
      (select json_build_object('cantidadReportada', r.cantidad_reportada, 'nombreContratista', r.nombre_contratista)
         from reportes_contratista r where r.conteo_id = c.id order by ${ordenVigenciaReporteSql("r")} limit 1) as "reporteVigente"
    from conteos c
    where ${sql.join(cs, sql` and `)}
    order by ${FECHA_CONTEO} desc, c.id desc
    limit ${POR_PAGINA + 1} offset ${pagina * POR_PAGINA}`))];

  const hayMas = filas.length > POR_PAGINA;
  if (hayMas) filas.length = POR_PAGINA;
  return NextResponse.json({ modoSimulado: false, lotes: filas, pagina, porPagina: POR_PAGINA, hayMas }, { headers: SIN_CACHE });
}
