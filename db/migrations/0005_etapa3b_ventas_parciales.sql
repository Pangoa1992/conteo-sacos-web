CREATE TABLE IF NOT EXISTS "ventas_lote" (
	"id" serial PRIMARY KEY NOT NULL,
	"conteo_id" integer NOT NULL,
	"cantidad_sacos" integer NOT NULL,
	"precio_unitario" numeric(10, 2) NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"comprador" varchar(150),
	"registrada_por" integer NOT NULL,
	"registrada_en" timestamp DEFAULT now() NOT NULL,
	"anulada_en" timestamp,
	"anulada_por" integer,
	"motivo_anulacion" varchar(300)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_conteo_id_conteos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_registrada_por_usuarios_id_fk" FOREIGN KEY ("registrada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_anulada_por_usuarios_id_fk" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- ===== Escrito a mano (drizzle-kit 0.24 no genera CHECK, índices parciales ni triggers) =====
-- Mismas reglas que lib/ventas.ts. Un CHECK que da NULL se considera cumplido:
-- por eso se comprueba IS NOT NULL de forma explícita.
ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_cantidad_positiva" CHECK ("cantidad_sacos" > 0);--> statement-breakpoint
ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_precio_positivo" CHECK ("precio_unitario" > 0);--> statement-breakpoint
-- El importe es exactamente cantidad × precio (lo calcula el servidor; la BD lo comprueba).
ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_importe_calculado"
  CHECK ("importe" = "cantidad_sacos" * "precio_unitario");--> statement-breakpoint
ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_comprador_no_vacio"
  CHECK ("comprador" IS NULL OR length(btrim("comprador")) > 0);--> statement-breakpoint
-- Anulación: los tres datos o ninguno, y con motivo escrito.
ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_anulacion_completa"
  CHECK (("anulada_en" IS NULL AND "anulada_por" IS NULL AND "motivo_anulacion" IS NULL)
      OR ("anulada_en" IS NOT NULL AND "anulada_por" IS NOT NULL
          AND "motivo_anulacion" IS NOT NULL AND length(btrim("motivo_anulacion")) > 0));--> statement-breakpoint
-- Suma rápida de las ventas activas de un lote.
CREATE INDEX IF NOT EXISTS "ventas_lote_activas_por_conteo" ON "ventas_lote" ("conteo_id") WHERE "anulada_en" IS NULL;--> statement-breakpoint
-- Stock: una venta nueva solo sale de un lote aprobado y sin pasar sus sacos
-- conformes menos las ventas activas. FOR UPDATE bloquea el lote, así dos
-- ventas simultáneas del mismo lote se atienden una tras otra (la segunda ya
-- ve la primera) y nunca hay sobreventa, aunque se inserte por SQL directo.
CREATE OR REPLACE FUNCTION "ventas_lote_validar_stock"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lote record;
  vendidos integer;
BEGIN
  IF NEW."anulada_en" IS NOT NULL OR NEW."anulada_por" IS NOT NULL OR NEW."motivo_anulacion" IS NOT NULL THEN
    RAISE EXCEPTION 'venta: una venta nueva no puede registrarse anulada' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "estado_validacion", "sacos_conformes" INTO lote FROM "conteos" WHERE "id" = NEW."conteo_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venta: el lote % no existe', NEW."conteo_id" USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF lote."estado_validacion" <> 'aprobado' OR lote."sacos_conformes" IS NULL THEN
    RAISE EXCEPTION 'venta: el lote % no está aprobado', NEW."conteo_id" USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum("cantidad_sacos"), 0) INTO vendidos FROM "ventas_lote"
    WHERE "conteo_id" = NEW."conteo_id" AND "anulada_en" IS NULL;
  IF vendidos + NEW."cantidad_sacos" > lote."sacos_conformes" THEN
    RAISE EXCEPTION 'venta: stock insuficiente en el lote %: disponibles %, solicitados %',
      NEW."conteo_id", lote."sacos_conformes" - vendidos, NEW."cantidad_sacos" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "ventas_lote_validar_stock" BEFORE INSERT ON "ventas_lote"
  FOR EACH ROW EXECUTE FUNCTION "ventas_lote_validar_stock"();--> statement-breakpoint
-- De una venta solo se registra su anulación, una vez; el resto no cambia.
-- Anular nunca aumenta lo vendido, así que no necesita revisar el stock.
CREATE OR REPLACE FUNCTION "ventas_lote_solo_anulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."anulada_en" IS NOT NULL THEN
    RAISE EXCEPTION 'venta: la venta % ya está anulada y no se modifica', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."conteo_id", NEW."cantidad_sacos", NEW."precio_unitario", NEW."importe", NEW."comprador",
      NEW."registrada_por", NEW."registrada_en")
     IS DISTINCT FROM
     (OLD."id", OLD."conteo_id", OLD."cantidad_sacos", OLD."precio_unitario", OLD."importe", OLD."comprador",
      OLD."registrada_por", OLD."registrada_en") THEN
    RAISE EXCEPTION 'venta: de una venta solo se registra su anulación' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "ventas_lote_solo_anulacion" BEFORE UPDATE ON "ventas_lote"
  FOR EACH ROW EXECUTE FUNCTION "ventas_lote_solo_anulacion"();--> statement-breakpoint
-- Las ventas no se borran nunca (tampoco con TRUNCATE): se anulan con motivo.
CREATE OR REPLACE FUNCTION "ventas_impedir_cambios"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ventas' THEN
    RAISE EXCEPTION 'venta: las ventas históricas (anteriores al control de validación) no se modifican'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RAISE EXCEPTION 'venta: las ventas no se borran, se anulan con un motivo' USING ERRCODE = 'integrity_constraint_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER "ventas_lote_sin_delete" BEFORE DELETE ON "ventas_lote"
  FOR EACH ROW EXECUTE FUNCTION "ventas_impedir_cambios"();--> statement-breakpoint
CREATE TRIGGER "ventas_lote_sin_truncate" BEFORE TRUNCATE ON "ventas_lote"
  FOR EACH STATEMENT EXECUTE FUNCTION "ventas_impedir_cambios"();--> statement-breakpoint
-- Ventas históricas: se conservan tal cual (sin altas, cambios ni borrados).
CREATE TRIGGER "ventas_historicas_congeladas" BEFORE INSERT OR UPDATE OR DELETE ON "ventas"
  FOR EACH ROW EXECUTE FUNCTION "ventas_impedir_cambios"();--> statement-breakpoint
CREATE TRIGGER "ventas_historicas_sin_truncate" BEFORE TRUNCATE ON "ventas"
  FOR EACH STATEMENT EXECUTE FUNCTION "ventas_impedir_cambios"();--> statement-breakpoint
-- Una nueva validación no puede dejar ventas activas en un lote que ya no
-- está aprobado o que tiene menos sacos conformes que los vendidos. El UPDATE
-- ya bloquea la fila del lote, igual que una venta en curso.
CREATE OR REPLACE FUNCTION "conteos_proteger_ventas"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  vendidos integer;
BEGIN
  SELECT coalesce(sum("cantidad_sacos"), 0) INTO vendidos FROM "ventas_lote"
    WHERE "conteo_id" = OLD."id" AND "anulada_en" IS NULL;
  IF vendidos > 0 AND (NEW."estado_validacion" <> 'aprobado' OR NEW."sacos_conformes" IS NULL OR NEW."sacos_conformes" < vendidos) THEN
    RAISE EXCEPTION 'venta: el lote % tiene % sacos vendidos en ventas activas; anule esas ventas antes de cambiar la validación',
      OLD."id", vendidos USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "conteos_proteger_ventas" BEFORE UPDATE OF "estado_validacion", "sacos_conformes", "cantidad_sacos" ON "conteos"
  FOR EACH ROW EXECUTE FUNCTION "conteos_proteger_ventas"();--> statement-breakpoint
COMMENT ON TABLE "ventas" IS 'Ventas históricas: registros anteriores al control de validación. Congeladas desde la migración 0005; no cuentan para el stock.';--> statement-breakpoint
COMMENT ON TABLE "ventas_lote" IS 'Ventas parciales de sacos conformes de lotes aprobados (etapa 3B). Stock = conformes - ventas activas.';
