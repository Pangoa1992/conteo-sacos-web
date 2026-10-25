ALTER TABLE "conteos" ADD COLUMN "id_externo" varchar(64);--> statement-breakpoint
ALTER TABLE "conteos" ADD COLUMN "contado_en" timestamp;--> statement-breakpoint
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_id_externo_unique" UNIQUE("id_externo");