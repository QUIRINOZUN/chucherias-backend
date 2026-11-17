-- Embalajes y decoraciones (2026-11-17)
-- Un embalaje es un insumo más (misma existencia, entradas, mermas y costo) marcado con su uso:
--   'venta'    → embalaje para llevar de las ventas normales (charolas, cajas de pizza...)
--   'especial' → embalaje y decoración de las ventas especiales
-- Para los de uso 'especial', embalaje_clase distingue 'embalaje' de 'decoracion'.
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS embalaje_uso VARCHAR(20)
  CHECK (embalaje_uso IN ('venta', 'especial'));
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS embalaje_clase VARCHAR(20)
  CHECK (embalaje_clase IN ('embalaje', 'decoracion'));

-- Embalaje elegido en una venta (a nivel de la orden, no de cada producto).
CREATE TABLE IF NOT EXISTS orden_embalajes (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  cantidad NUMERIC(10, 2) NOT NULL CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS idx_orden_embalajes_orden ON orden_embalajes (orden_id);

-- Embalaje y decoración de una venta especial. Se descuenta del inventario al marcarla "entregada".
CREATE TABLE IF NOT EXISTS venta_especial_embalajes (
  id SERIAL PRIMARY KEY,
  venta_especial_id INTEGER NOT NULL REFERENCES ventas_especiales(id) ON DELETE CASCADE,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  cantidad NUMERIC(10, 2) NOT NULL CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS idx_vee_venta ON venta_especial_embalajes (venta_especial_id);
ALTER TABLE ventas_especiales ADD COLUMN IF NOT EXISTS embalaje_descontado BOOLEAN NOT NULL DEFAULT FALSE;
