CREATE TABLE "mensajes_whatsapp" (
	"id" serial PRIMARY KEY NOT NULL,
	"recibido_en" timestamp DEFAULT now() NOT NULL,
	"remitente" varchar(40) NOT NULL,
	"contacto" varchar(60),
	"tipo" varchar(20) NOT NULL,
	"resultado" varchar(20) NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"sacos" integer,
	"confianza_promedio" numeric(5, 2),
	"foto_sha256" char(64),
	"foto_ancho" integer,
	"foto_alto" integer,
	"conteo_id" integer,
	"revisado_por" integer,
	"revisado_en" timestamp,
	"descartada" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensajes_whatsapp_foto" (
	"mensaje_id" integer PRIMARY KEY NOT NULL,
	"imagen" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mensajes_whatsapp" ADD CONSTRAINT "mensajes_whatsapp_conteo_id_conteos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_whatsapp" ADD CONSTRAINT "mensajes_whatsapp_revisado_por_usuarios_id_fk" FOREIGN KEY ("revisado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_whatsapp_foto" ADD CONSTRAINT "mensajes_whatsapp_foto_mensaje_id_mensajes_whatsapp_id_fk" FOREIGN KEY ("mensaje_id") REFERENCES "public"."mensajes_whatsapp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_whatsapp" ADD CONSTRAINT "mensajes_whatsapp_resultado_check" CHECK ("resultado" IN ('respondido', 'rechazado', 'error'));--> statement-breakpoint
ALTER TABLE "mensajes_whatsapp" ADD CONSTRAINT "mensajes_whatsapp_sacos_check" CHECK ("sacos" IS NULL OR "sacos" >= 0);--> statement-breakpoint
ALTER TABLE "mensajes_whatsapp" ADD CONSTRAINT "mensajes_whatsapp_revision_check" CHECK (NOT ("descartada" AND "conteo_id" IS NOT NULL) AND (("conteo_id" IS NULL AND NOT "descartada") = ("revisado_por" IS NULL)));--> statement-breakpoint
CREATE UNIQUE INDEX "mensajes_whatsapp_conteo_unico" ON "mensajes_whatsapp" ("conteo_id") WHERE "conteo_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mensajes_whatsapp_recibido_idx" ON "mensajes_whatsapp" ("recibido_en" DESC);
