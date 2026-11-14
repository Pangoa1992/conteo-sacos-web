CREATE TABLE "respaldos" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL,
	"registros" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "respaldos" ADD CONSTRAINT "respaldos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;