CREATE TABLE IF NOT EXISTS "evidencias" (
	"id" serial PRIMARY KEY NOT NULL,
	"conteo_id" integer NOT NULL,
	"descripcion" varchar(200),
	"sha256" char(64) NOT NULL,
	"mime" varchar(30) DEFAULT 'image/jpeg' NOT NULL,
	"bytes" integer NOT NULL,
	"ancho" integer NOT NULL,
	"alto" integer NOT NULL,
	"bytes_miniatura" integer NOT NULL,
	"tomada_en" timestamp,
	"subido_por" integer NOT NULL,
	"subido_en" timestamp DEFAULT now() NOT NULL,
	"anulada_en" timestamp,
	"anulada_por" integer,
	"motivo_anulacion" varchar(300)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidencias_contenido" (
	"evidencia_id" integer PRIMARY KEY NOT NULL,
	"imagen" "bytea" NOT NULL,
	"miniatura" "bytea" NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_conteo_id_conteos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_subido_por_usuarios_id_fk" FOREIGN KEY ("subido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_anulada_por_usuarios_id_fk" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidencias_contenido" ADD CONSTRAINT "evidencias_contenido_evidencia_id_evidencias_id_fk" FOREIGN KEY ("evidencia_id") REFERENCES "public"."evidencias"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- ===== Escrito a mano (drizzle-kit 0.24 no genera CHECK, índices parciales ni triggers) =====
-- Mismos límites que lib/evidencias.ts. Un CHECK que da NULL se considera
-- cumplido: por eso se comprueba IS NOT NULL de forma explícita.
ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_formato"
  CHECK ("mime" = 'image/jpeg' AND "sha256" ~ '^[0-9a-f]{64}$'
     AND "bytes" BETWEEN 1 AND 1572864 AND "bytes_miniatura" BETWEEN 1 AND 65536
     AND "ancho" BETWEEN 1 AND 1600 AND "alto" BETWEEN 1 AND 1600);--> statement-breakpoint
-- Anulación: los tres datos o ninguno, y con motivo escrito.
ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_anulacion_completa"
  CHECK (("anulada_en" IS NULL AND "anulada_por" IS NULL AND "motivo_anulacion" IS NULL)
      OR ("anulada_en" IS NOT NULL AND "anulada_por" IS NOT NULL
          AND length(btrim(coalesce("motivo_anulacion", ''))) > 0));--> statement-breakpoint
ALTER TABLE "evidencias_contenido" ADD CONSTRAINT "evidencias_contenido_tamano"
  CHECK (octet_length("imagen") BETWEEN 1 AND 1572864 AND octet_length("miniatura") BETWEEN 1 AND 65536);--> statement-breakpoint
-- La misma foto no se registra dos veces como evidencia activa del mismo conteo.
CREATE UNIQUE INDEX "evidencias_activas_sin_duplicado" ON "evidencias" ("conteo_id", "sha256") WHERE "anulada_en" IS NULL;--> statement-breakpoint
CREATE INDEX "evidencias_conteo_idx" ON "evidencias" ("conteo_id");--> statement-breakpoint
-- Las evidencias no se borran nunca (tampoco con TRUNCATE).
CREATE OR REPLACE FUNCTION "evidencias_impedir_borrado"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las evidencias no se borran: se anulan con un motivo (tabla %)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER "evidencias_sin_delete" BEFORE DELETE ON "evidencias"
  FOR EACH ROW EXECUTE FUNCTION "evidencias_impedir_borrado"();--> statement-breakpoint
CREATE TRIGGER "evidencias_sin_truncate" BEFORE TRUNCATE ON "evidencias"
  FOR EACH STATEMENT EXECUTE FUNCTION "evidencias_impedir_borrado"();--> statement-breakpoint
CREATE TRIGGER "evidencias_contenido_sin_delete" BEFORE DELETE ON "evidencias_contenido"
  FOR EACH ROW EXECUTE FUNCTION "evidencias_impedir_borrado"();--> statement-breakpoint
CREATE TRIGGER "evidencias_contenido_sin_truncate" BEFORE TRUNCATE ON "evidencias_contenido"
  FOR EACH STATEMENT EXECUTE FUNCTION "evidencias_impedir_borrado"();--> statement-breakpoint
-- La imagen guardada es inmutable.
CREATE OR REPLACE FUNCTION "evidencias_contenido_inmutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El contenido de una evidencia no se modifica' USING ERRCODE = 'integrity_constraint_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER "evidencias_contenido_sin_update" BEFORE UPDATE ON "evidencias_contenido"
  FOR EACH ROW EXECUTE FUNCTION "evidencias_contenido_inmutable"();--> statement-breakpoint
-- De una evidencia solo se puede registrar su anulación, una vez; el resto no cambia.
CREATE OR REPLACE FUNCTION "evidencias_solo_anulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."anulada_en" IS NOT NULL THEN
    RAISE EXCEPTION 'La evidencia % ya está anulada y no se modifica', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."conteo_id", NEW."descripcion", NEW."sha256", NEW."mime", NEW."bytes", NEW."ancho", NEW."alto",
      NEW."bytes_miniatura", NEW."tomada_en", NEW."subido_por", NEW."subido_en")
     IS DISTINCT FROM
     (OLD."id", OLD."conteo_id", OLD."descripcion", OLD."sha256", OLD."mime", OLD."bytes", OLD."ancho", OLD."alto",
      OLD."bytes_miniatura", OLD."tomada_en", OLD."subido_por", OLD."subido_en") THEN
    RAISE EXCEPTION 'De una evidencia solo se registra su anulación' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "evidencias_solo_anulacion" BEFORE UPDATE ON "evidencias"
  FOR EACH ROW EXECUTE FUNCTION "evidencias_solo_anulacion"();--> statement-breakpoint
-- Máximo 10 evidencias activas por conteo (la API además bloquea el conteo con FOR UPDATE).
CREATE OR REPLACE FUNCTION "evidencias_maximo_activas"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "evidencias" WHERE "conteo_id" = NEW."conteo_id" AND "anulada_en" IS NULL) >= 10 THEN
    RAISE EXCEPTION 'El conteo % ya tiene 10 evidencias activas', NEW."conteo_id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "evidencias_maximo_activas" BEFORE INSERT ON "evidencias"
  FOR EACH ROW EXECUTE FUNCTION "evidencias_maximo_activas"();
