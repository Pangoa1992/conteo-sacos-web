import { pgTable, serial, integer, varchar, timestamp, boolean, numeric, char, customType } from "drizzle-orm/pg-core";

// drizzle-orm 0.33 no trae bytea; postgres-js lo entrega como Buffer.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Cada registro representa un lote de producción terminado, enviado por el
 * módulo de visión computarizada (Python) al finalizar su procesamiento.
 */
export const conteos = pgTable("conteos", {
  id: serial("id").primaryKey(),
  cantidadSacos: integer("cantidad_sacos").notNull(),
  origen: varchar("origen", { length: 50 }).notNull().default("vision_ip"), // vision_ip | prueba_vision | manual
  fuenteCamara: varchar("fuente_camara", { length: 100 }), // identificador de la cámara IP
  confianzaPromedio: numeric("confianza_promedio", { precision: 5, scale: 2 }), // % de confianza del modelo
  // Identificador del lote generado por el detector; UNIQUE garantiza en
  // PostgreSQL que un reintento no duplique el conteo. NULL en registros antiguos.
  idExterno: varchar("id_externo", { length: 64 }).unique(),
  // Fecha real del conteo en el detector (UTC). creadoEn es la fecha de recepción.
  contadoEn: timestamp("contado_en"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),

  // ---- Validación por el personal (etapa 1, ampliación del prototipo) ----
  // Estado vigente; el detalle de cada revisión queda en validaciones_conteo.
  // pendiente | aprobado | observado | rechazado
  estadoValidacion: varchar("estado_validacion", { length: 20 }).notNull().default("pendiente"),
  // Clasificación MANUAL por estado físico. NULL = sin clasificar (nunca se
  // inventa). Si existe, las tres suman exactamente cantidadSacos.
  sacosConformes: integer("sacos_conformes"),
  sacosObservados: integer("sacos_observados"),
  sacosDefectuosos: integer("sacos_defectuosos"),
  validadoPor: integer("validado_por").references(() => usuarios.id),
  validadoEn: timestamp("validado_en"),
  observacionValidacion: varchar("observacion_validacion", { length: 500 }),
  // Las reglas entre estas columnas son restricciones CHECK escritas a mano en
  // la migración 0003 (drizzle-kit 0.24 no las genera).
});

/**
 * Historial de validaciones: una fila por cada revisión de un conteo (solo se
 * agrega, nunca se modifica), para saber quién cambió el estado, cuándo y por qué.
 */
export const validacionesConteo = pgTable("validaciones_conteo", {
  id: serial("id").primaryKey(),
  conteoId: integer("conteo_id").references(() => conteos.id).notNull(),
  estadoAnterior: varchar("estado_anterior", { length: 20 }).notNull(),
  estado: varchar("estado", { length: 20 }).notNull(),
  sacosConformes: integer("sacos_conformes"),
  sacosObservados: integer("sacos_observados"),
  sacosDefectuosos: integer("sacos_defectuosos"),
  observacion: varchar("observacion", { length: 500 }),
  usuarioId: integer("usuario_id").references(() => usuarios.id).notNull(),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

/**
 * Reporte manual del contratista (para poder compararlo contra el conteo
 * automático y detectar discrepancias — módulo de alertas, Fase 2).
 */
export const reportesContratista = pgTable("reportes_contratista", {
  id: serial("id").primaryKey(),
  cantidadReportada: integer("cantidad_reportada").notNull(),
  nombreContratista: varchar("nombre_contratista", { length: 150 }),
  conteoId: integer("conteo_id").references(() => conteos.id),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

/**
 * Registro de venta / facturación asociado a un conteo confirmado.
 */
export const ventas = pgTable("ventas", {
  id: serial("id").primaryKey(),
  conteoId: integer("conteo_id").references(() => conteos.id).notNull(),
  precioPorSaco: numeric("precio_por_saco", { precision: 10, scale: 2 }),
  totalVenta: numeric("total_venta", { precision: 10, scale: 2 }),
  confirmada: boolean("confirmada").notNull().default(false),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

/**
 * Usuarios del sistema (personal MACROMEC / dueño de la fábrica).
 * La distinción de rol habilita la Fase 2 (JWT + permisos diferenciados).
 */
export const usuarios = pgTable("usuarios", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre", { length: 150 }).notNull(),
  correo: varchar("correo", { length: 150 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  rol: varchar("rol", { length: 30 }).notNull().default("cliente"), // admin_macromec | cliente
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

/**
 * Evidencias fotográficas de un conteo (etapa 2, ampliación del prototipo).
 * Solo metadatos: los bytes están en evidencias_contenido para que los
 * listados nunca carguen imágenes. Nunca se borran: se anulan con motivo.
 * Una foto es solo evidencia: no cambia la cantidad contada por la IA.
 */
export const evidencias = pgTable("evidencias", {
  id: serial("id").primaryKey(),
  conteoId: integer("conteo_id").references(() => conteos.id).notNull(),
  descripcion: varchar("descripcion", { length: 200 }),
  // SHA-256 (hex) de la imagen guardada, para comprobar que no cambió.
  sha256: char("sha256", { length: 64 }).notNull(),
  mime: varchar("mime", { length: 30 }).notNull().default("image/jpeg"),
  bytes: integer("bytes").notNull(),
  ancho: integer("ancho").notNull(),
  alto: integer("alto").notNull(),
  bytesMiniatura: integer("bytes_miniatura").notNull(),
  // Fecha de la foto según el celular (no verificable); subidoEn la pone el servidor.
  tomadaEn: timestamp("tomada_en"),
  subidoPor: integer("subido_por").references(() => usuarios.id).notNull(),
  subidoEn: timestamp("subido_en").notNull().defaultNow(),
  anuladaEn: timestamp("anulada_en"),
  anuladaPor: integer("anulada_por").references(() => usuarios.id),
  motivoAnulacion: varchar("motivo_anulacion", { length: 300 }),
  // Restricciones CHECK, índice único parcial y triggers que impiden borrar
  // o alterar evidencias: escritos a mano en la migración 0004.
});

export const evidenciasContenido = pgTable("evidencias_contenido", {
  evidenciaId: integer("evidencia_id").primaryKey().references(() => evidencias.id),
  imagen: bytea("imagen").notNull(),
  miniatura: bytea("miniatura").notNull(),
});
