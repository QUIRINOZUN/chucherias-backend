-- =============================================================================
-- 2026-10-31_insumo_compras.sql — Historial de costo por compra de insumo
-- =============================================================================
-- insumos.costo_unitario (2026-10-27) ya guarda el costo ACTUAL de un
-- insumo, pero sobrescribe el valor anterior cada vez — no quedaba ningún
-- registro de "cuánto pagué cada vez que compré esto". El usuario pidió
-- poder consultar ese historial (decisión de alcance: actualizar el costo
-- vigente + guardar historial de consulta, NO promedio ponderado — ver
-- CLAUDE.md).
--
-- Cada fila es una compra real: se crea desde POST /api/insumos/:id/entrada
-- cuando esa entrada trae un costo_unitario, y esa misma entrada actualiza
-- insumos.costo_unitario al valor nuevo. `movimiento_id` liga la compra con
-- su fila de movimientos_inventario (tipo 'entrada'), para poder cruzarlas
-- si hace falta, sin ser una FK obligatoria (una compra histórica podría
-- quedar sin su movimiento si este se llegara a borrar por "Eliminar
-- historial" de Inventario).
-- =============================================================================

CREATE TABLE insumo_compras (
    id              SERIAL PRIMARY KEY,
    insumo_id       INTEGER NOT NULL REFERENCES insumos(id),
    costo_unitario  NUMERIC(10,2) NOT NULL CHECK (costo_unitario > 0),
    cantidad        NUMERIC(12,3),
    proveedor_id    INTEGER REFERENCES proveedores(id),
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    registrado_por  INTEGER NOT NULL REFERENCES usuarios(id),
    movimiento_id   INTEGER REFERENCES movimientos_inventario(id) ON DELETE SET NULL,
    nota            VARCHAR(200)
);

CREATE INDEX idx_insumo_compras_insumo ON insumo_compras (insumo_id, fecha DESC);
