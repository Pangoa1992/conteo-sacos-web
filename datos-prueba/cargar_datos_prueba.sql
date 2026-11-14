-- =====================================================================
-- DATOS DE PRUEBA · Sistema de Conteo de Sacos de Zanahoria (MACROMEC)
-- =====================================================================
-- Agrega 30 días de operación simulada (del 14/10/2026 al 13/11/2026) a una
-- base de datos de PRUEBA o DEMOSTRACIÓN:
--   · conteos (lotes) de 2 cámaras, origen «prueba_vision» → siempre marcados
--     como prueba en el panel y aceptados por el modo DEMO de WhatsApp;
--   · validación del personal (aprobado / observado / rechazado / pendiente)
--     con su historial en validaciones_conteo;
--   · reportes de 3 contratistas (la mayoría coincide; algunos con discrepancia);
--   · ventas parciales de sacos conformes a 4 compradores, 2 de ellas anuladas.
--
-- Es REPETIBLE: los lotes llevan id_externo «seed_AAAAMMDD_N»; si ya existen,
-- no se vuelve a cargar nada (ver la comprobación inicial). Los números salen
-- de setseed(0.21), así cada carga produce exactamente los mismos datos.
--
-- NUNCA ejecutarlo sobre la base de datos real: usar cargar_datos_prueba.sh,
-- que exige que la base esté marcada como «SOLO DATOS DE ...».
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM conteos WHERE id_externo LIKE 'seed\_%') THEN
    RAISE EXCEPTION 'Los datos de prueba ya están cargados en esta base (id_externo seed_*).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE rol = 'admin_macromec') THEN
    RAISE EXCEPTION 'No hay un usuario administrador para registrar validaciones y ventas.';
  END IF;
END $$;

SELECT setseed(0.21);

CREATE TEMP TABLE _admin AS
  SELECT id FROM usuarios WHERE rol = 'admin_macromec' ORDER BY id LIMIT 1;

-- ---------- 1. Lotes: 2 a 4 por día, entre las 07:00 y las 16:30 (hora de Lima = UTC-5) ----------
CREATE TEMP TABLE _lotes AS
WITH dias AS (
  SELECT d::date AS dia, row_number() OVER (ORDER BY d) AS n_dia
  FROM generate_series('2026-10-14'::date, '2026-11-13'::date, interval '1 day') d
  WHERE extract(isodow FROM d) <> 7          -- los domingos no se trabaja
),
lotes AS (
  SELECT dia, n_dia, k,
         (2 + floor(random() * 3))::int AS lotes_del_dia
  FROM dias, generate_series(1, 4) k
)
SELECT dia, n_dia, k,
       -- 07:00 + 2,5 h por lote ± 40 min, convertido a UTC (+5 h)
       (dia + time '12:00' + (k - 1) * interval '150 minutes' + (floor(random() * 80) - 40) * interval '1 minute')::timestamp AS contado_en,
       CASE WHEN random() < 0.55 THEN 'DEMO_camara_poza_1' ELSE 'DEMO_camara_poza_2' END AS camara,
       (60 + floor(random() * 81))::int AS sacos,                  -- 60 a 140 sacos
       round((86 + random() * 11)::numeric, 2) AS confianza,       -- 86 % a 97 %
       random() AS r_estado, random() AS r_clasif, random() AS r_reporte, random() AS r_dif
FROM lotes
WHERE k <= lotes_del_dia;

-- Estado de validación: los 2 últimos días quedan pendientes; antes, 78 % aprobado,
-- 12 % observado, 4 % rechazado y el resto pendiente.
ALTER TABLE _lotes ADD COLUMN estado text, ADD COLUMN conformes int, ADD COLUMN observados int, ADD COLUMN defectuosos int, ADD COLUMN id int;
UPDATE _lotes SET estado = CASE
  WHEN dia >= '2026-11-12' THEN 'pendiente'
  WHEN r_estado < 0.78 THEN 'aprobado'
  WHEN r_estado < 0.90 THEN 'observado'
  WHEN r_estado < 0.94 THEN 'rechazado'
  ELSE 'pendiente' END;
-- Clasificación manual: aprobado ≈ 93-100 % conformes; observado con más observados.
UPDATE _lotes SET
  defectuosos = CASE WHEN estado = 'aprobado' THEN floor(r_clasif * 3)::int ELSE (1 + floor(r_clasif * 4))::int END,
  observados  = CASE WHEN estado = 'aprobado' THEN floor(r_clasif * 5)::int ELSE (5 + floor(r_clasif * 8))::int END
WHERE estado IN ('aprobado', 'observado');
UPDATE _lotes SET conformes = sacos - observados - defectuosos WHERE estado IN ('aprobado', 'observado');

-- ---------- 2. Insertar los conteos ----------
WITH ins AS (
  INSERT INTO conteos (cantidad_sacos, origen, fuente_camara, confianza_promedio, id_externo, contado_en, creado_en,
                       estado_validacion, sacos_conformes, sacos_observados, sacos_defectuosos, validado_por, validado_en, observacion_validacion)
  SELECT l.sacos, 'prueba_vision', l.camara, l.confianza,
         'seed_' || to_char(l.dia, 'YYYYMMDD') || '_' || l.k,
         l.contado_en, l.contado_en + interval '2 minutes',
         l.estado, l.conformes, l.observados, l.defectuosos,
         CASE WHEN l.estado <> 'pendiente' THEN (SELECT id FROM _admin) END,
         CASE WHEN l.estado <> 'pendiente' THEN l.contado_en + interval '3 hours' END,
         CASE l.estado
           WHEN 'observado' THEN 'Sacos con zanahoria partida o mal lavada; se separan para revisión.'
           WHEN 'rechazado' THEN 'La cámara grabó con poca luz: el conteo no es confiable, se repite manualmente.'
         END
  FROM _lotes l
  ORDER BY l.contado_en
  RETURNING id, id_externo
)
UPDATE _lotes l SET id = ins.id FROM ins WHERE ins.id_externo = 'seed_' || to_char(l.dia, 'YYYYMMDD') || '_' || l.k;

-- Historial de validación (una revisión por lote revisado).
INSERT INTO validaciones_conteo (conteo_id, estado_anterior, estado, sacos_conformes, sacos_observados, sacos_defectuosos, observacion, usuario_id, creado_en)
SELECT l.id, 'pendiente', l.estado, l.conformes, l.observados, l.defectuosos,
       CASE l.estado
         WHEN 'observado' THEN 'Sacos con zanahoria partida o mal lavada; se separan para revisión.'
         WHEN 'rechazado' THEN 'La cámara grabó con poca luz: el conteo no es confiable, se repite manualmente.'
       END,
       (SELECT id FROM _admin), l.contado_en + interval '3 hours'
FROM _lotes l WHERE l.estado <> 'pendiente';

-- ---------- 3. Reportes del contratista (≈ 80 % de los lotes) ----------
-- 70 % coincide exacto, 20 % difiere en ±1-2 y 10 % en ±3-6 (discrepancia).
INSERT INTO reportes_contratista (cantidad_reportada, nombre_contratista, conteo_id, creado_en)
SELECT greatest(0, l.sacos + CASE
         WHEN l.r_dif < 0.70 THEN 0
         WHEN l.r_dif < 0.90 THEN (CASE WHEN l.r_dif < 0.80 THEN 1 ELSE -1 END) * (1 + floor(random() * 2))::int
         ELSE (CASE WHEN l.r_dif < 0.95 THEN 1 ELSE -1 END) * (3 + floor(random() * 4))::int END),
       (ARRAY['Contratista Quispe', 'Contratista Huamán', 'Contratista Rojas'])[1 + (l.n_dia % 3)],
       l.id, l.contado_en + interval '1 hour'
FROM _lotes l
WHERE l.r_reporte < 0.80 AND l.estado <> 'rechazado';

-- ---------- 4. Ventas de sacos conformes (lotes aprobados) ----------
-- Cerca del 70 % de los lotes aprobados se venden: una o dos ventas por lote.
CREATE TEMP TABLE _ventas AS
SELECT l.id AS conteo_id, l.conformes, l.contado_en, v.n,
       (ARRAY['Mercado Modelo de Huancayo', 'Comercial Valle del Mantaro', 'Distribuidora Lima Norte', NULL])[1 + floor(random() * 4)::int] AS comprador,
       round((24 + floor(random() * 9) + CASE WHEN random() < 0.5 THEN 0.5 ELSE 0 END)::numeric, 2) AS precio,
       random() AS r_cant
FROM _lotes l
CROSS JOIN LATERAL generate_series(1, CASE WHEN random() < 0.35 THEN 2 ELSE 1 END) v(n)
WHERE l.estado = 'aprobado' AND l.r_clasif < 0.70;

-- Primera venta: 50-80 % del lote; segunda: hasta lo que quede (sin pasarse del stock).
INSERT INTO ventas_lote (conteo_id, cantidad_sacos, precio_unitario, importe, comprador, registrada_por, registrada_en, clave_idempotencia)
SELECT v.conteo_id, q.cant, v.precio, q.cant * v.precio, v.comprador, (SELECT id FROM _admin),
       v.contado_en + interval '1 day' * v.n + interval '2 hours',
       md5('seed-venta-' || v.conteo_id || '-' || v.n)::uuid
FROM _ventas v
CROSS JOIN LATERAL (SELECT CASE WHEN v.n = 1 THEN greatest(1, floor(v.conformes * (0.5 + v.r_cant * 0.3)))::int
                                ELSE greatest(1, floor((v.conformes - floor(v.conformes * 0.8)) * 0.9))::int END AS cant) q
ORDER BY v.conteo_id, v.n;

-- Dos ventas anuladas (error de precio y devolución), para ver el flujo completo.
UPDATE ventas_lote SET anulada_en = registrada_en + interval '30 minutes', anulada_por = (SELECT id FROM _admin),
       motivo_anulacion = 'Precio mal digitado; se registra nuevamente.'
WHERE id = (SELECT min(id) FROM ventas_lote WHERE comprador IS NOT NULL AND conteo_id IN (SELECT id FROM _lotes));
UPDATE ventas_lote SET anulada_en = registrada_en + interval '1 day', anulada_por = (SELECT id FROM _admin),
       motivo_anulacion = 'El comprador devolvió los sacos por retraso en la entrega.'
WHERE id = (SELECT max(id) FROM ventas_lote WHERE conteo_id IN (SELECT id FROM _lotes));

-- ---------- Resumen ----------
SELECT 'lotes cargados' AS dato, count(*)::text AS valor FROM _lotes
UNION ALL SELECT 'sacos detectados', sum(sacos)::text FROM _lotes
UNION ALL SELECT 'aprobados / observados / rechazados / pendientes',
  concat_ws(' / ', count(*) FILTER (WHERE estado = 'aprobado'), count(*) FILTER (WHERE estado = 'observado'),
            count(*) FILTER (WHERE estado = 'rechazado'), count(*) FILTER (WHERE estado = 'pendiente')) FROM _lotes
UNION ALL SELECT 'reportes del contratista', count(*)::text FROM reportes_contratista WHERE conteo_id IN (SELECT id FROM _lotes)
UNION ALL SELECT 'ventas (anuladas)', count(*) || ' (' || count(*) FILTER (WHERE anulada_en IS NOT NULL) || ')' FROM ventas_lote WHERE conteo_id IN (SELECT id FROM _lotes)
UNION ALL SELECT 'importe vendido activo (S/)', sum(importe) FILTER (WHERE anulada_en IS NULL)::text FROM ventas_lote WHERE conteo_id IN (SELECT id FROM _lotes);

COMMIT;
