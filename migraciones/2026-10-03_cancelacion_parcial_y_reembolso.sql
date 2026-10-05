-- =============================================================================
-- 2026-10-03_cancelacion_parcial_y_reembolso.sql
-- =============================================================================
-- Ajuste a las reglas de cancelación pedido por el usuario:
--   - Cancelar una orden ya no es todo-o-nada: se puede cancelar solo ALGUNOS
--     productos de la venta (orden_detalle.cancelado marca cuáles).
--   - Si la comanda ya estaba 'preparando' al cancelar, quien cancela elige
--     qué insumos de esos productos se RESCATAN (vuelven al inventario) y
--     cuáles ya son MERMA (se perdieron en la preparación) — antes se
--     restituía siempre el 100%.
--   - Si cancelar implica devolverle dinero al cliente, se registra como un
--     movimiento de caja 'reembolso' (mismo mecanismo que 'retiro': resta del
--     efectivo esperado), ligado a la orden que lo originó.
-- =============================================================================

ALTER TABLE orden_detalle ADD COLUMN IF NOT EXISTS cancelado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orden_detalle ADD COLUMN IF NOT EXISTS fecha_cancelacion TIMESTAMP;
-- El motivo escrito por quien cancela se guarda POR LÍNEA (no solo a nivel
-- venta): una cancelación parcial no siempre deja a la venta como 'cancelada'
-- (ventas.motivo_cancelacion solo se llena ahí), así que sin esto el motivo de
-- cancelar un producto específico se perdía.
ALTER TABLE orden_detalle ADD COLUMN IF NOT EXISTS motivo_cancelacion VARCHAR(255);

ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS orden_id INTEGER REFERENCES ordenes(id);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_orden ON movimientos_caja(orden_id);

ALTER TABLE movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_tipo_check;
ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_tipo_check
  CHECK (tipo IN ('apertura', 'ingreso', 'retiro', 'reembolso'));
