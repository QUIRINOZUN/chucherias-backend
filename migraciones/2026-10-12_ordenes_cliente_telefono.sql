-- Teléfono del cliente para órdenes a domicilio (2026-10-12), junto a
-- cliente_nombre/cliente_direccion (ver 2026-10-11_ordenes_cliente_domicilio.sql).
-- Mismo criterio: vive en `ordenes`, NULL en órdenes presenciales.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS cliente_telefono VARCHAR(20);
