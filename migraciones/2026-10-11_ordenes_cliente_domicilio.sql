-- Nombre y dirección del cliente para órdenes a domicilio (2026-10-11). Viven
-- en `ordenes` (no en `clientes`, que es de un dominio distinto —el programa
-- de lealtad, sin implementar todavía— y una dirección puede variar de un
-- pedido a otro aunque sea el mismo cliente). NULL en órdenes presenciales.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(150);
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS cliente_direccion VARCHAR(255);
