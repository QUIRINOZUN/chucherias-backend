-- Tres mejoras a la merma que se registra al cancelar una venta
-- (ver PATCH /api/ventas/:id/cancelar):
--   1. valor_unitario: congela el precio de la variante en el momento de la
--      merma (igual que orden_detalle.precio_unitario), para poder saber
--      cuántos PESOS se perdieron, no solo cuántas piezas.
--   2. estado_orden_previo: el estado que tenía la orden justo antes de
--      cancelarse ('sin_preparar'/'preparando'/'por_entregar'/'entregado'),
--      como columna filtrable/agrupable — antes solo vivía dentro del texto
--      de `motivo`.
--   3. Índices para cuando la tabla crezca y existan reportes que agrupen
--      por orden o por fecha.
-- Ejecutar una sola vez en la consola SQL de Neon (base real).
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC(10,2);
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS estado_orden_previo VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_mermas_orden ON mermas(orden_id);
CREATE INDEX IF NOT EXISTS idx_mermas_fecha ON mermas(fecha);
