-- Promociones con vigencia (2026-11-16): descuentos por porcentaje o monto fijo
-- sobre todo el menu, una categoria, un producto o una variante, opcionalmente
-- solo ciertos dias de la semana, en cierto horario y/o entre dos fechas.
-- La promocion vigente se convierte en el PRECIO de la variante (el servidor lo
-- recalcula al cobrar), asi totales, lealtad y reportes siguen igual.
CREATE TABLE IF NOT EXISTS promociones (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(80) NOT NULL,
    tipo           VARCHAR(12) NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
    valor          NUMERIC(10,2) NOT NULL CHECK (valor > 0),
    alcance        VARCHAR(12) NOT NULL DEFAULT 'todo'
                   CHECK (alcance IN ('todo', 'categoria', 'producto', 'variante')),
    alcance_id     INTEGER,
    -- 0 = domingo ... 6 = sabado (hora de Durango). NULL = todos los dias.
    dias_semana    SMALLINT[],
    hora_inicio    TIME,
    hora_fin       TIME,
    fecha_inicio   DATE,
    fecha_fin      DATE,
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por     INTEGER REFERENCES usuarios(id),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (tipo <> 'porcentaje' OR valor <= 100),
    CHECK ((alcance = 'todo' AND alcance_id IS NULL) OR (alcance <> 'todo' AND alcance_id IS NOT NULL))
);
