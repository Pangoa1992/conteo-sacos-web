import { NextRequest, NextResponse } from "next/server";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { db } from "@/db";
import { conteos, reportesContratista, usuarios } from "@/db/schema";
import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { compararSecreto, extraerBearer } from "@/lib/seguridad";
import { usuarioDeSesion } from "@/lib/sesion-servidor";
import {
  ETIQUETA_ESTADO_VALIDACION,
  UMBRAL_DISCREPANCIA,
  ZONA_HORARIA_PLANTA,
  esOrigenPrueba,
  fechaHoyPlanta,
  hayDiscrepancia,
  type EstadoValidacion,
} from "@/lib/conteos";
import { construirCsv } from "@/lib/inventario";
import { leerFiltrosHistorial } from "@/lib/historial";
import { ORDEN_VIGENCIA_REPORTE, ordenVigenciaReporteSql } from "@/lib/reportes-contratista-servidor";

// Cantidad de conteos que devuelve GET (por defecto y máximo).
const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 200;

// El CSV del historial nunca se exporta parcial: si supera LIMITE_CSV responde 413 y pide acotar el filtro.
const LIMITE_CSV = 20000;
const SIN_CACHE = { "Cache-Control": "private, no-store" };
const ZONA = sql.raw(`'${ZONA_HORARIA_PLANTA}'`);
// Fecha original del conteo (contado_en; los antiguos usan creado_en) en hora de la planta.
const HORA_PLANTA = sql`((coalesce(c.contado_en, c.creado_en) at time zone 'UTC') at time zone ${ZONA})`;
const ES_PRUEBA = sql`(lower(c.origen) like 'prueba%')`;

// Longitud mínima aceptada para VISION_API_TOKEN.
const LONGITUD_MINIMA_TOKEN = 32;

// Margen para relojes desajustados y antigüedad máxima aceptada de contadoEn.
const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const ANTIGUEDAD_MAXIMA_MS = 30 * 24 * 3600_000;

// Esquema de validación de lo que envía el módulo de visión (Python).
// Cada envío es un lote terminado, identificado por idExterno.
const conteoInputSchema = z.object({
  idExterno: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "8-64 caracteres: letras, números, '-' o '_'"),
  cantidadSacos: z.number().int().nonnegative(),
  origen: z.enum(["vision_ip", "prueba_vision"]).default("vision_ip"),
  // Identificador de la cámara (p. ej. camara_poza_1), nunca la ruta de un video.
  fuenteCamara: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Identificador de cámara: letras, números, '-' o '_' (máx. 100)").nullish(),
  // null cuando el detector no pudo calcularla; no se inventa un valor.
  confianzaPromedio: z.number().min(0).max(100).nullish(),
  // Fecha real del conteo en el detector, ISO 8601 con zona (p. ej. ...Z).
  contadoEn: z.string().datetime({ offset: true }),
});

/**
 * GET /api/conteo
 * Devuelve los últimos conteos registrados, junto con el reporte del
 * contratista (si existe) y si hay discrepancia entre ambos, para que
 * el dashboard muestre la alerta correspondiente.
 *
 * Parámetro opcional ?limite=N (1–200, por defecto 20).
 * Cada conteo incluye esPrueba (origen "prueba*") para que el dashboard
 * nunca mezcle datos de prueba con producción real, y fechaConteo: la
 * fecha real del lote (contadoEn) o, si no la tiene, la de recepción. Si hay varios
 * reportes de contratista para un conteo, se usa el más reciente.
 * También incluye el estado de validación y el nombre de quien lo revisó.
 *
 * NOTA: si la base de datos no está configurada, se devuelven datos
 * simulados (mock) marcados con modoSimulado: true.
 *
 * ?formato=csv: TODO el historial con los filtros del panel (ver exportarCsv).
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("formato") === "csv") return exportarCsv(req);

  // El middleware solo comprueba la firma del token; aquí además que la cuenta siga activa.
  if (!(await usuarioDeSesion(req))) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      modoSimulado: true,
      conteos: MOCK_CONTEOS,
    });
  }

  const limiteParam = Number(req.nextUrl.searchParams.get("limite"));
  const limite = Number.isInteger(limiteParam) && limiteParam > 0
    ? Math.min(limiteParam, LIMITE_MAXIMO)
    : LIMITE_POR_DEFECTO;

  // Orden por fecha real del lote (contado_en); los registros antiguos sin
  // ella usan la fecha de recepción.
  const filas = await db
    .select({ conteo: conteos, validadoPorNombre: usuarios.nombre })
    .from(conteos)
    .leftJoin(usuarios, eq(conteos.validadoPor, usuarios.id))
    .orderBy(desc(sql`coalesce(${conteos.contadoEn}, ${conteos.creadoEn})`), desc(conteos.id))
    .limit(limite);
  const ultimos = filas.map((f) => ({ ...f.conteo, validadoPorNombre: f.validadoPorNombre }));

  // Una sola consulta para todos los reportes (antes: una por conteo).
  const reportes = ultimos.length
    ? await db
        .select()
        .from(reportesContratista)
        .where(inArray(reportesContratista.conteoId, ultimos.map((c) => c.id)))
        .orderBy(...ORDEN_VIGENCIA_REPORTE)
    : [];
  // El primero de cada lote en el orden de vigencia es su reporte vigente.
  const reportePorConteo = new Map<number | null, (typeof reportes)[number]>();
  for (const r of reportes) if (!reportePorConteo.has(r.conteoId)) reportePorConteo.set(r.conteoId, r);

  const conteosConAlerta = ultimos.map((c) => {
    const reporte = reportePorConteo.get(c.id);
    const discrepancia = reporte ? hayDiscrepancia(reporte.cantidadReportada, c.cantidadSacos) : false;

    return {
      ...c,
      fechaConteo: c.contadoEn ?? c.creadoEn,
      esPrueba: esOrigenPrueba(c.origen),
      reporteContratista: reporte
        ? { cantidadReportada: reporte.cantidadReportada, nombreContratista: reporte.nombreContratista }
        : null,
      discrepancia,
    };
  });

  return NextResponse.json({ modoSimulado: false, conteos: conteosConAlerta });
}

/**
 * POST /api/conteo
 * Endpoint que consume el módulo de Python (api_cliente.py) cada vez
 * que termina de procesar un lote de video y obtiene un conteo.
 *
 * Idempotente por idExterno:
 *   201 lote nuevo registrado.
 *   200 el mismo lote ya estaba registrado con los mismos datos (reintento).
 *   409 el idExterno ya existe con datos distintos (no se acepta).
 *   400 datos inválidos · 401 token · 503 error temporal (reintentar).
 *
 * Seguridad: exige SIEMPRE el token compartido (VISION_API_TOKEN) en el
 * header "Authorization: Bearer <token>", para que solo el módulo de
 * visión pueda escribir conteos. Si VISION_API_TOKEN no está configurado
 * en el servidor, se rechaza la operación (no se aceptan conteos sin
 * autenticar ni siquiera en desarrollo).
 */
export async function POST(req: NextRequest) {
  const tokenEsperado = process.env.VISION_API_TOKEN;

  if (!tokenEsperado || tokenEsperado.length < LONGITUD_MINIMA_TOKEN) {
    console.error("[conteo] VISION_API_TOKEN no configurado o demasiado corto: registro de conteos deshabilitado.");
    return NextResponse.json({ error: "Registro de conteos no disponible" }, { status: 503 });
  }

  const tokenRecibido = extraerBearer(req.headers.get("authorization"));
  if (!tokenRecibido || !compararSecreto(tokenRecibido, tokenEsperado)) {
    return NextResponse.json({ error: "Token inválido o faltante" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = conteoInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const contadoEn = new Date(parsed.data.contadoEn);
  const ahora = Date.now();
  if (contadoEn.getTime() > ahora + TOLERANCIA_FUTURO_MS || contadoEn.getTime() < ahora - ANTIGUEDAD_MAXIMA_MS) {
    return NextResponse.json(
      { error: "Datos inválidos", detalles: { fieldErrors: { contadoEn: ["Fecha fuera del rango aceptado (futura o de hace más de 30 días)"] } } },
      { status: 400 }
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { modoSimulado: true, recibido: parsed.data },
      { status: 201 }
    );
  }

  // numeric(5,2): se redondea aquí para que lo guardado y lo comparado
  // en un reintento sean exactamente el mismo valor.
  const valores = {
    idExterno: parsed.data.idExterno,
    cantidadSacos: parsed.data.cantidadSacos,
    origen: parsed.data.origen,
    fuenteCamara: parsed.data.fuenteCamara ?? null,
    confianzaPromedio: parsed.data.confianzaPromedio == null ? null : parsed.data.confianzaPromedio.toFixed(2),
    contadoEn,
  };

  try {
    // La restricción UNIQUE de id_externo hace la idempotencia en PostgreSQL:
    // ante dos envíos simultáneos del mismo lote solo uno inserta y el otro
    // espera a que termine y no inserta nada.
    const [nuevo] = await db.insert(conteos).values(valores)
      .onConflictDoNothing({ target: conteos.idExterno })
      .returning();
    if (nuevo) {
      return NextResponse.json(nuevo, { status: 201 });
    }

    const [existente] = await db.select().from(conteos).where(eq(conteos.idExterno, valores.idExterno)).limit(1);
    if (!existente) {
      // No debería ocurrir (UNIQUE no se borra); se trata como error temporal.
      throw new Error("conflicto de id_externo sin registro existente");
    }

    const camposDistintos = camposDiferentes(existente, valores);
    if (camposDistintos.length > 0) {
      return NextResponse.json(
        { error: "id_externo ya registrado con datos distintos", idExterno: valores.idExterno, camposDistintos },
        { status: 409 }
      );
    }
    return NextResponse.json({ ...existente, duplicado: true }, { status: 200 });
  } catch (err) {
    console.error("[conteo] Error de base de datos al registrar el conteo:", mensajeErrorBD(err));
    return NextResponse.json({ error: "Base de datos no disponible temporalmente" }, { status: 503 });
  }
}

type FilaCsv = {
  id: number;
  fecha: string;
  hora: string;
  cantidadSacos: number;
  esPrueba: boolean;
  fuenteCamara: string | null;
  confianza: number | null;
  cantidadReportada: number | null;
  discrepancia: boolean;
  estadoValidacion: EstadoValidacion;
  conformes: number | null;
  observados: number | null;
  defectuosos: number | null;
  validadoPor: string | null;
  validadoEn: string | null;
  observacion: string | null;
};

/**
 * GET /api/conteo?formato=csv (cualquier sesión, como el historial en pantalla)
 * Historial COMPLETO con los mismos filtros del panel: tipo (real | prueba | todos),
 * camara (texto contenido), desde/hasta (fecha original del conteo, hora de Lima),
 * discrepancias=1 y validacion. El reporte vigente de cada lote es el más reciente.
 * Fechas en hora de Lima; celdas protegidas contra fórmulas (construirCsv).
 *
 *   200 CSV · 400 filtros inválidos · 401 sin sesión · 413 más de LIMITE_CSV lotes · 503 sin BD
 */
async function exportarCsv(req: NextRequest) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE });

  const leidos = leerFiltrosHistorial(req.nextUrl.searchParams);
  if ("errores" in leidos) {
    return NextResponse.json({ error: "Filtros inválidos", detalles: leidos.errores }, { status: 400, headers: SIN_CACHE });
  }
  const f = leidos.filtros;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Base de datos no configurada: no hay historial que exportar." }, { status: 503, headers: SIN_CACHE });
  }

  const DISCREPANCIA = sql`coalesce(abs(v.cantidad_reportada - c.cantidad_sacos) > ${UMBRAL_DISCREPANCIA}, false)`;
  const cs: SQL[] = [sql`true`];
  if (f.tipo === "real") cs.push(sql`not ${ES_PRUEBA}`);
  if (f.tipo === "prueba") cs.push(ES_PRUEBA);
  // strpos (no LIKE): el texto buscado no tiene comodines.
  if (f.camara) cs.push(sql`strpos(lower(coalesce(c.fuente_camara, '')), lower(${f.camara})) > 0`);
  if (f.desde) cs.push(sql`${HORA_PLANTA}::date >= ${f.desde}::date`);
  if (f.hasta) cs.push(sql`${HORA_PLANTA}::date <= ${f.hasta}::date`);
  if (f.soloDiscrepancias) cs.push(DISCREPANCIA);
  if (f.validacion) cs.push(sql`c.estado_validacion = ${f.validacion}`);

  // limite + 1 filas: si llega la fila extra, el filtro supera el límite.
  const filas = [...(await db.execute<FilaCsv>(sql`
    with vigentes as (
      select distinct on (r.conteo_id) r.conteo_id, r.cantidad_reportada
      from reportes_contratista r
      where r.conteo_id is not null
      order by r.conteo_id, ${ordenVigenciaReporteSql("r")}
    )
    select c.id, to_char(${HORA_PLANTA}, 'DD/MM/YYYY') as fecha, to_char(${HORA_PLANTA}, 'HH24:MI:SS') as hora,
      c.cantidad_sacos as "cantidadSacos", ${ES_PRUEBA} as "esPrueba", c.fuente_camara as "fuenteCamara",
      c.confianza_promedio::float8 as confianza, v.cantidad_reportada as "cantidadReportada", ${DISCREPANCIA} as discrepancia,
      c.estado_validacion as "estadoValidacion", c.sacos_conformes as conformes, c.sacos_observados as observados,
      c.sacos_defectuosos as defectuosos, u.nombre as "validadoPor",
      to_char((c.validado_en at time zone 'UTC') at time zone ${ZONA}, 'DD/MM/YYYY HH24:MI:SS') as "validadoEn",
      c.observacion_validacion as observacion
    from conteos c
      left join vigentes v on v.conteo_id = c.id
      left join usuarios u on u.id = c.validado_por
    where ${sql.join(cs, sql` and `)}
    order by coalesce(c.contado_en, c.creado_en) desc, c.id desc
    limit ${LIMITE_CSV + 1}`))];

  if (filas.length > LIMITE_CSV) {
    return NextResponse.json(
      { error: `El filtro incluye más de ${LIMITE_CSV.toLocaleString("es-PE")} lotes: acote las fechas para exportar el CSV completo.`, limite: LIMITE_CSV },
      { status: 413, headers: SIN_CACHE }
    );
  }

  const cuerpo = construirCsv([
    ["ID", "Fecha (hora Lima)", "Hora (hora Lima)", "Sacos", "Tipo", "Camara/Origen", "Confianza (%)", "Contratista reporto",
      "Discrepancia", "Validacion", "Conformes (manual)", "Observados (manual)", "Defectuosos (manual)", "Validado por",
      "Fecha validacion (hora Lima)", "Observacion"],
    ...filas.map((c) => [c.id, c.fecha, c.hora, c.cantidadSacos, c.esPrueba ? "PRUEBA" : "Real", c.fuenteCamara, c.confianza,
      c.cantidadReportada, c.discrepancia ? "Si" : "No", ETIQUETA_ESTADO_VALIDACION[c.estadoValidacion] ?? c.estadoValidacion,
      c.conformes, c.observados, c.defectuosos, c.validadoPor, c.validadoEn, c.observacion]),
  ]);
  return new NextResponse(cuerpo, {
    headers: {
      ...SIN_CACHE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="conteo-sacos-${f.tipo}-${fechaHoyPlanta()}.csv"`,
      // Filas de datos exportadas (siempre todas las del filtro).
      "X-Total-Filas": String(filas.length),
    },
  });
}

/** Campos en los que el registro guardado difiere del reenvío del mismo lote. */
function camposDiferentes(
  existente: typeof conteos.$inferSelect,
  recibido: { cantidadSacos: number; origen: string; fuenteCamara: string | null; confianzaPromedio: string | null; contadoEn: Date }
): string[] {
  const distintos: string[] = [];
  const confianzaGuardada = existente.confianzaPromedio == null ? null : Number(existente.confianzaPromedio).toFixed(2);
  if (existente.cantidadSacos !== recibido.cantidadSacos) distintos.push("cantidadSacos");
  if (existente.origen !== recibido.origen) distintos.push("origen");
  if ((existente.fuenteCamara ?? null) !== recibido.fuenteCamara) distintos.push("fuenteCamara");
  if (confianzaGuardada !== recibido.confianzaPromedio) distintos.push("confianzaPromedio");
  if (existente.contadoEn?.getTime() !== recibido.contadoEn.getTime()) distintos.push("contadoEn");
  return distintos;
}

// Datos de ejemplo para poder ver el dashboard funcionando
// mientras no se conecta la cámara real ni la base de datos.
const MOCK_CONTEOS = [
  { id: 1, cantidadSacos: 118, fuenteCamara: "camara_poza_1", confianzaPromedio: 96.4, creadoEn: new Date().toISOString(), reporteContratista: { cantidadReportada: 120, nombreContratista: "Juan Pérez" }, discrepancia: true },
  { id: 2, cantidadSacos: 104, fuenteCamara: "camara_poza_1", confianzaPromedio: 94.1, creadoEn: new Date(Date.now() - 3600_000).toISOString(), reporteContratista: null, discrepancia: false },
  { id: 3, cantidadSacos: 97, fuenteCamara: "camara_poza_1", confianzaPromedio: 95.8, creadoEn: new Date(Date.now() - 7200_000).toISOString(), reporteContratista: { cantidadReportada: 97, nombreContratista: "Juan Pérez" }, discrepancia: false },
];