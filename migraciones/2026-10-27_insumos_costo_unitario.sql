-- Costeo y rentabilidad (2026-10-27): costo de una unidad de este insumo (en
-- su propia unidad_medida, ej. costo por gramo de queso) — para calcular el
-- costo real de una receta y el margen de cada producto. NULL = todavía sin
-- capturar (estado inicial de los 149 insumos reales); mientras no se
-- capture, ese insumo simplemente no entra al cálculo de costo/margen, igual
-- criterio que ya usa costo_extra.
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(10,2);
