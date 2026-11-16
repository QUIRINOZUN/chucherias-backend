-- Propinas (2026-11-16): lo que el cliente deja ademas del total de la venta.
-- Se guarda aparte: NO es ingreso del negocio (no entra a ventas.total ni a los
-- reportes de ventas), pero si es dinero que entra al cajon (efectivo) o a la
-- cuenta (transferencia), asi que Caja lo suma al esperado de cada metodo.
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS propina NUMERIC(10,2) NOT NULL DEFAULT 0;
