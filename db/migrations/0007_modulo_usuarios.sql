ALTER TABLE "usuarios" ADD COLUMN "activo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "sesion_version" integer DEFAULT 0 NOT NULL;