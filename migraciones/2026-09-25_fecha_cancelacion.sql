-- RF-03: guardar el momento exacto en que se cancela una venta.
-- Ejecutar una sola vez en la consola SQL de Neon (base real).
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS fecha_cancelacion TIMESTAMP;
