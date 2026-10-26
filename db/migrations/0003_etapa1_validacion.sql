CREATE TABLE IF NOT EXISTS "validaciones_conteo" (
	"id" serial PRIMARY KEY NOT NULL,
	"conteo_id" integer NOT NULL,
	"estado_anterior" varchar(20) NOT NULL,
	"estado" varchar(20) NOT NULL,
	"sacos_conformes" integer,
	"sacos_observados" integer,
	"sacos_defectuosos" integer,
	"observacion" varchar(500),
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "estado_validacion" varchar(20) DEFAULT 'pendiente' NOT NULL;--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "sacos_conformes" integer;--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "sacos_observados" integer;--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "sacos_defectuosos" integer;--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "validado_por" integer;--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "validado_en" timestamp;--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "observacion_validacion" varchar(500);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validaciones_conteo" ADD CONSTRAINT "validaciones_conteo_conteo_id_conteos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validaciones_conteo" ADD CONSTRAINT "validaciones_conteo_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conteos" ADD CONSTRAINT "conteos_validado_por_usuarios_id_fk" FOREIGN KEY ("validado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Restricciones escritas a mano (drizzle-kit 0.24 no genera CHECK). Repiten en
-- PostgreSQL las reglas de lib/conteos.ts (erroresValidacion), para que ningún
-- camino deje un conteo incoherente. Un CHECK que da NULL se considera cumplido,
-- por eso se comprueba IS NOT NULL de forma explícita. Los conteos existentes
-- quedan "pendiente" y sin clasificación (NULL), así que cumplen todas.
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_estado_validacion_valido"
  CHECK ("estado_validacion" IN ('pendiente', 'aprobado', 'observado', 'rechazado'));--> statement-breakpoint
-- Clasificación: las tres cantidades o ninguna, nunca negativas, y suman el total del conteo.
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_clasificacion_completa"
  CHECK (("sacos_conformes" IS NULL AND "sacos_observados" IS NULL AND "sacos_defectuosos" IS NULL)
      OR ("sacos_conformes" IS NOT NULL AND "sacos_observados" IS NOT NULL AND "sacos_defectuosos" IS NOT NULL
          AND "sacos_conformes" >= 0 AND "sacos_observados" >= 0 AND "sacos_defectuosos" >= 0));--> statement-breakpoint
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_clasificacion_suma_total"
  CHECK ("sacos_conformes" IS NULL
      OR "sacos_conformes" + "sacos_observados" + "sacos_defectuosos" = "cantidad_sacos");--> statement-breakpoint
-- Pendiente = nadie lo revisó: sin revisor, fecha, clasificación ni observación.
-- Cualquier otro estado exige revisor y fecha.
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_validacion_revisor"
  CHECK (("estado_validacion" = 'pendiente' AND "validado_por" IS NULL AND "validado_en" IS NULL
          AND "sacos_conformes" IS NULL AND "observacion_validacion" IS NULL)
      OR ("estado_validacion" <> 'pendiente' AND "validado_por" IS NOT NULL AND "validado_en" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_aprobado_clasificado"
  CHECK ("estado_validacion" <> 'aprobado' OR "sacos_conformes" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_rechazado_sin_clasificacion"
  CHECK ("estado_validacion" <> 'rechazado' OR "sacos_conformes" IS NULL);--> statement-breakpoint
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_motivo_observado_rechazado"
  CHECK ("estado_validacion" NOT IN ('observado', 'rechazado') OR length(btrim(coalesce("observacion_validacion", ''))) > 0);--> statement-breakpoint
-- Historial: mismos estados (sin volver a pendiente) y clasificación completa o ausente.
ALTER TABLE "validaciones_conteo" ADD CONSTRAINT "validaciones_conteo_estado_valido"
  CHECK ("estado" IN ('aprobado', 'observado', 'rechazado')
     AND "estado_anterior" IN ('pendiente', 'aprobado', 'observado', 'rechazado'));--> statement-breakpoint
ALTER TABLE "validaciones_conteo" ADD CONSTRAINT "validaciones_conteo_clasificacion_completa"
  CHECK (("sacos_conformes" IS NULL AND "sacos_observados" IS NULL AND "sacos_defectuosos" IS NULL)
      OR ("sacos_conformes" IS NOT NULL AND "sacos_observados" IS NOT NULL AND "sacos_defectuosos" IS NOT NULL
          AND "sacos_conformes" >= 0 AND "sacos_observados" >= 0 AND "sacos_defectuosos" >= 0));
