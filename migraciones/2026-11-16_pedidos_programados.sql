-- Pedidos programados (2026-11-16): una orden puede llevar la hora para la que se
-- pidió (recoger o entregar más tarde). Se guarda en UTC, igual que el resto de
-- las fechas del sistema. NULL = pedido normal, para ahora.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS programada_para TIMESTAMP;
