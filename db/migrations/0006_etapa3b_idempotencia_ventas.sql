ALTER TABLE "ventas_lote" ADD COLUMN "clave_idempotencia" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ventas_lote" ADD CONSTRAINT "ventas_lote_clave_idempotencia_unique" UNIQUE("clave_idempotencia");--> statement-breakpoint
-- ===== Escrito a mano =====
-- NOT NULL sin valor por defecto: ventas_lote está vacía en todos los entornos
-- donde se aplica (se crea en la 0005). Si tuviera filas, la migración se
-- detendría aquí en vez de inventar claves para ventas ya registradas.
-- La clave de idempotencia también es inmutable: se agrega a la lista de
-- columnas que no cambian (solo se registra la anulación).
CREATE OR REPLACE FUNCTION "ventas_lote_solo_anulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."anulada_en" IS NOT NULL THEN
    RAISE EXCEPTION 'venta: la venta % ya está anulada y no se modifica', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."conteo_id", NEW."cantidad_sacos", NEW."precio_unitario", NEW."importe", NEW."comprador",
      NEW."registrada_por", NEW."registrada_en", NEW."clave_idempotencia")
     IS DISTINCT FROM
     (OLD."id", OLD."conteo_id", OLD."cantidad_sacos", OLD."precio_unitario", OLD."importe", OLD."comprador",
      OLD."registrada_por", OLD."registrada_en", OLD."clave_idempotencia") THEN
    RAISE EXCEPTION 'venta: de una venta solo se registra su anulación' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
