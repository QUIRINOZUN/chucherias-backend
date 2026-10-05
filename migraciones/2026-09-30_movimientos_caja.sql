-- Movimientos de efectivo en caja que NO son ventas: saldo inicial del
-- turno (apertura), efectivo que entra por fuera de una venta normal
-- (ingreso — ej. se cobra una orden que antes había quedado sin cobrar) y
-- retiros (solo administrador, para pagar proveedores o comprar insumos
-- en el día). El total que calcula /api/caja/resumen pasa a ser
-- ventas_efectivo + apertura + ingresos − retiros, no solo ventas.
--
-- Un retiro nace SIN confirmar (confirmado = FALSE): el POS hace polling de
-- GET /api/caja/retiros-pendientes y, cuando el cajero lo ve en pantalla y
-- confirma, PATCH /api/caja/movimientos/:id/confirmar lo marca y dispara el
-- comprobante imprimible. Apertura/ingreso los registra la misma persona
-- que está en el POS, así que nacen ya confirmados.
--
-- Ejecutar una sola vez en la consola SQL de Neon (base real).
CREATE TABLE IF NOT EXISTS movimientos_caja (
    id                  SERIAL PRIMARY KEY,
    tipo                VARCHAR(10) NOT NULL CHECK (tipo IN ('apertura', 'ingreso', 'retiro')),
    monto               NUMERIC(10,2) NOT NULL CHECK (monto > 0),
    motivo              VARCHAR(255),
    fecha               TIMESTAMP NOT NULL DEFAULT NOW(),
    responsable_id      INTEGER NOT NULL REFERENCES usuarios(id),
    confirmado          BOOLEAN NOT NULL DEFAULT FALSE,
    confirmado_por      INTEGER REFERENCES usuarios(id),
    fecha_confirmacion  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_fecha ON movimientos_caja(fecha);
