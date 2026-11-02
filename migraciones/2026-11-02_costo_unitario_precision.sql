-- =============================================================================
-- 2026-11-02_costo_unitario_precision.sql — Más decimales en el costo unitario
-- =============================================================================
-- insumos.costo_unitario era NUMERIC(10,2): para insumos que se compran por
-- kg/L y se guardan por g/ml, el costo por unidad base casi siempre es menor
-- a un centavo (50 kg por $60 = $0.0012/g) y se redondeaba a 0 o con hasta
-- 29% de error (25 kg por $350 = 0.014 -> 0.01). Costeo y Rentabilidad
-- usan este costo, así que el error se arrastraba a todas las recetas.
--
-- Ensanchar la precisión no pierde ningún dato existente (NUMERIC(10,2) cabe
-- dentro de NUMERIC(14,6)).
-- =============================================================================

ALTER TABLE insumos ALTER COLUMN costo_unitario TYPE NUMERIC(14,6);
ALTER TABLE insumo_compras ALTER COLUMN costo_unitario TYPE NUMERIC(14,6);
