-- Fase 2 del recetario: conecta el "Quitar ingredientes" que ya existe en el
-- POS (pos/producto-ingredientes.ts) con insumos reales, para que al quitar
-- tocino/cebolla/etc. ese insumo NO se descuente del inventario.
--
-- Una fila por cada ingrediente quitado de un renglón de la venta. (La
-- "elección" de sabor/salsa/topping -tipo 'elegido'- queda contemplada en el
-- diseño de la tabla pero todavía no se llena desde ningún lado: el
-- selector de elección en el POS sigue pendiente.)
--
-- Ejecutar una sola vez en la consola SQL de Neon (base real).
CREATE TABLE IF NOT EXISTS orden_detalle_insumos (
    id                SERIAL PRIMARY KEY,
    orden_detalle_id  INTEGER NOT NULL REFERENCES orden_detalle(id),
    insumo_id         INTEGER NOT NULL REFERENCES insumos(id),
    tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('quitado', 'elegido')),
    -- Solo aplica a 'elegido' (cuánto de ese insumo lleva la elección);
    -- 'quitado' es una exclusión binaria, no necesita cantidad.
    cantidad          NUMERIC(10,2),
    unidad_medida     VARCHAR(20)
);
CREATE INDEX IF NOT EXISTS idx_orden_detalle_insumos_detalle ON orden_detalle_insumos(orden_detalle_id);
