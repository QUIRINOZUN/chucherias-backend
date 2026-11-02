-- =============================================================================
-- 2026-10-31_lealtad_config.sql — Programa de lealtad configurable
-- =============================================================================
-- Antes, el ciclo de 10 visitas, los escalones (visita 5 = 5%, visita 10 =
-- 15%) y el monto mínimo de compra ($100) estaban hardcodeados en
-- routes/ventas.js. El usuario pidió poder editar todo esto sin tocar código
-- (ciclo + escalones + mínimo). Ver CLAUDE.md para la decisión completa.
--
-- lealtad_config: fila única (singleton, forzado con el CHECK id = 1) con el
-- largo del ciclo y el monto mínimo de compra que cuenta como visita.
--
-- lealtad_escalones: cada "premio" del ciclo (en qué número de visita y qué
-- porcentaje de descuento). El valor en visita_numero = ciclo_visitas sigue
-- siendo el que REINICIA el contador a 0 (ver routes/ventas.js), sin
-- importar si tiene o no un descuento propio asociado.
-- =============================================================================

CREATE TABLE lealtad_config (
    id                   SMALLINT PRIMARY KEY DEFAULT 1,
    ciclo_visitas        INTEGER NOT NULL DEFAULT 10 CHECK (ciclo_visitas > 0),
    monto_minimo_compra  NUMERIC(10,2) NOT NULL DEFAULT 100 CHECK (monto_minimo_compra >= 0),
    editado_por          INTEGER REFERENCES usuarios(id),
    fecha_edicion        TIMESTAMP,
    CONSTRAINT lealtad_config_singleton CHECK (id = 1)
);

INSERT INTO lealtad_config (id, ciclo_visitas, monto_minimo_compra)
VALUES (1, 10, 100);

CREATE TABLE lealtad_escalones (
    id                    SERIAL PRIMARY KEY,
    visita_numero         INTEGER NOT NULL UNIQUE CHECK (visita_numero > 0),
    porcentaje_descuento  NUMERIC(5,2) NOT NULL CHECK (porcentaje_descuento > 0 AND porcentaje_descuento <= 100),
    descripcion           VARCHAR(200),
    editado_por           INTEGER REFERENCES usuarios(id),
    fecha_edicion         TIMESTAMP
);

-- Mismos 2 escalones que ya operaban en el código, para que esta migración
-- no cambie el comportamiento real del negocio el día que se corre.
INSERT INTO lealtad_escalones (visita_numero, porcentaje_descuento, descripcion) VALUES
  (5, 5, '5% por llegar a 5 visitas del ciclo'),
  (10, 15, '15% por completar el ciclo de 10 visitas');
