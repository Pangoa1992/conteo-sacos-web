import { pgTable, serial, integer, varchar, timestamp, boolean, numeric } from "drizzle-orm/pg-core";

/**
 * Cada registro representa un conteo enviado por el módulo de visión
 * computarizada (Python) al finalizar el procesamiento de un lote/poza.
 */
export const conteos = pgTable("conteos", {
  id: serial("id").primaryKey(),
  cantidadSacos: integer("cantidad_sacos").notNull(),
  origen: varchar("origen", { length: 50 }).notNull().default("vision_ip"), // vision_ip | manual
  fuenteCamara: varchar("fuente_camara", { length: 100 }), // identificador de la cámara IP
  confianzaPromedio: numeric("confianza_promedio", { precision: 5, scale: 2 }), // % de confianza del modelo
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
  rol: varchar("rol", { length: 30 }).notNull().default("cliente"), // admin_macromec | cliente
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});
