-- Órdenes de compra a proveedores (2026-11-16).
-- Una orden nace 'pendiente' (se pidió al proveedor) y pasa a 'recibida' cuando
-- llega la mercancía (ahí se registran las entradas de inventario y los costos)
-- o a 'cancelada'. Solo se crean tablas nuevas: no toca ninguna existente.
CREATE TABLE IF NOT EXISTS ordenes_compra (
    id               SERIAL PRIMARY KEY,
    proveedor_id     INTEGER REFERENCES proveedores(id),
    estado           VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente', 'recibida', 'cancelada')),
    nota             VARCHAR(255),
    creado_por       INTEGER NOT NULL REFERENCES usuarios(id),
    fecha_creacion   TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_recepcion  TIMESTAMP,
    recibido_por     INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS orden_compra_detalle (
    id                    SERIAL PRIMARY KEY,
    orden_compra_id       INTEGER NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    insumo_id             INTEGER NOT NULL REFERENCES insumos(id),
    cantidad_pedida       NUMERIC(12,2) NOT NULL CHECK (cantidad_pedida > 0),
    cantidad_recibida     NUMERIC(12,2),
    costo_total_recibido  NUMERIC(12,2),
    UNIQUE (orden_compra_id, insumo_id)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_estado ON ordenes_compra (estado);
