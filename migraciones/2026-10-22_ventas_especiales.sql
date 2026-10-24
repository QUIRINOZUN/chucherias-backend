-- Nuevo módulo "Ventas especiales": agendar y cotizar pedidos grandes
-- (desayunos, comidas, sorpresas especiales) usando el menú completo, con
-- anticipación. A propósito NO es una venta real todavía — no toca caja,
-- inventario ni el tablero de comandas; es solo una cotización con fecha
-- agendada. Si el evento se concreta, se cobra como cualquier venta normal
-- desde el POS el día del evento (fuera de alcance de este módulo, ver
-- CLAUDE.md).
CREATE TABLE ventas_especiales (
    id                   SERIAL PRIMARY KEY,
    cliente_nombre       VARCHAR(150) NOT NULL,
    cliente_telefono     VARCHAR(20),
    cliente_direccion    VARCHAR(255),
    tipo                 VARCHAR(20) NOT NULL DEFAULT 'otro'
                         CHECK (tipo IN ('desayuno','comida','sorpresa','otro')),
    fecha_evento         DATE NOT NULL,
    hora_evento          TIME,
    estado               VARCHAR(20) NOT NULL DEFAULT 'cotizada'
                         CHECK (estado IN ('cotizada','confirmada','entregada','cancelada')),
    notas                VARCHAR(500),
    -- Suma de venta_especial_detalle, recalculada por el servidor en cada
    -- creación/edición de items — nunca se confía en un total del cliente
    -- (mismo criterio que ventas.total).
    subtotal             NUMERIC(10,2) NOT NULL DEFAULT 0,
    creado_por           INTEGER NOT NULL REFERENCES usuarios(id),
    fecha_creacion       TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_actualizacion  TIMESTAMP
);

-- Un renglón por producto cotizado. precio_unitario se congela del precio
-- real de variantes_producto al cotizar/editar (igual que
-- orden_detalle.precio_unitario) — el precio NUNCA viene del cliente.
CREATE TABLE venta_especial_detalle (
    id                   SERIAL PRIMARY KEY,
    venta_especial_id    INTEGER NOT NULL REFERENCES ventas_especiales(id),
    variante_id          INTEGER NOT NULL REFERENCES variantes_producto(id),
    cantidad             INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    precio_unitario      NUMERIC(10,2) NOT NULL,
    notas                VARCHAR(255)
);
