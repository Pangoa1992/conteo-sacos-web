CREATE TABLE IF NOT EXISTS "conteos" (
	"id" serial PRIMARY KEY NOT NULL,
	"cantidad_sacos" integer NOT NULL,
	"origen" varchar(50) DEFAULT 'vision_ip' NOT NULL,
	"fuente_camara" varchar(100),
	"confianza_promedio" numeric(5, 2),
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reportes_contratista" (
	"id" serial PRIMARY KEY NOT NULL,
	"cantidad_reportada" integer NOT NULL,
	"nombre_contratista" varchar(150),
	"conteo_id" integer,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" varchar(150) NOT NULL,
	"correo" varchar(150) NOT NULL,
	"rol" varchar(30) DEFAULT 'cliente' NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_correo_unique" UNIQUE("correo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ventas" (
	"id" serial PRIMARY KEY NOT NULL,
	"conteo_id" integer NOT NULL,
	"precio_por_saco" numeric(10, 2),
	"total_venta" numeric(10, 2),
	"confirmada" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reportes_contratista" ADD CONSTRAINT "reportes_contratista_conteo_id_conteos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas" ADD CONSTRAINT "ventas_conteo_id_conteos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
