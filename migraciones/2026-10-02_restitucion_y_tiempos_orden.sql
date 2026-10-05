-- =============================================================================
-- 2026-10-02_restitucion_y_tiempos_orden.sql
-- =============================================================================
-- Cubre dos requerimientos formales de Sprint 2 (RF-11 y RF-08):
--
--   RF-11: "Restituir automáticamente el inventario cuando se cancele una
--   venta que ya haya descontado insumos." Para eso, los movimientos de
--   inventario que genera una orden (la 'salida' al pasar a 'preparando' y,
--   si se cancela después, la 'entrada' de reversión) quedan ligados a esa
--   orden con `orden_id` — así se pueden identificar sin depender de leer el
--   texto de `motivo`, y GET /api/ventas puede contar cuántos insumos se
--   restituyeron en una cancelación.
--
--   RF-08: "Registrar el tiempo que permanece una orden en cada estado, para
--   su posterior consulta en reportes." `orden_estado_historial` guarda un
--   renglón por cada estado por el que pasa una orden, con su inicio y fin
--   (fin = NULL mientras sigue en ese estado): sin_preparar → preparando →
--   por_entregar → entregado/cancelada.
-- =============================================================================

ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS orden_id INTEGER REFERENCES ordenes(id);
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_orden ON movimientos_inventario(orden_id);

CREATE TABLE IF NOT EXISTS orden_estado_historial (
    id              SERIAL PRIMARY KEY,
    orden_id        INTEGER NOT NULL REFERENCES ordenes(id),
    estado          VARCHAR(20) NOT NULL,
    fecha_inicio    TIMESTAMP NOT NULL,
    fecha_fin       TIMESTAMP,
    responsable_id  INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_orden_estado_historial_orden ON orden_estado_historial(orden_id);
