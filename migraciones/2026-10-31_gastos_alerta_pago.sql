-- =============================================================================
-- 2026-10-31_gastos_alerta_pago.sql — Alertas de gastos recurrentes mensuales
-- =============================================================================
-- gastos.es_recurrente (2026-10-28) era solo una etiqueta informativa, sin
-- ningún mecanismo real de aviso. El usuario pidió una alerta cuando se
-- acerca la fecha de pago de un gasto recurrente (ej. la renta, el día 5 de
-- cada mes). Decisión de alcance: "día fijo del mes + aviso N días antes"
-- (ver CLAUDE.md) — ambas columnas solo tienen sentido cuando
-- es_recurrente = TRUE, pero se dejan sueltas (sin CHECK cruzado) para no
-- complicar la validación; el backend (routes/gastos.js) es quien decide
-- cuándo pedirlas.
-- =============================================================================

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS dia_pago_mes INTEGER CHECK (dia_pago_mes BETWEEN 1 AND 31);

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS dias_aviso_previo INTEGER NOT NULL DEFAULT 3 CHECK (dias_aviso_previo >= 0);
