-- Checklist de apertura/cierre (entrevista con la titular, "Preguntas de
-- cierre y priorización" #12: "aunque parece sencillo, es clave para la
-- operación diaria"). `checklist_items` es el catálogo (editable desde la
-- app, administrador/encargado); `checklist_marcas` es qué se marcó ya HOY
-- de ese catálogo — sin fila = todavía no se hizo.
CREATE TABLE IF NOT EXISTS checklist_items (
    id          SERIAL PRIMARY KEY,
    tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('apertura', 'cierre')),
    descripcion VARCHAR(150) NOT NULL,
    orden       INTEGER NOT NULL DEFAULT 0,
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS checklist_marcas (
    id            SERIAL PRIMARY KEY,
    item_id       INTEGER NOT NULL REFERENCES checklist_items(id),
    fecha         DATE NOT NULL,
    marcado_por   INTEGER NOT NULL REFERENCES usuarios(id),
    fecha_marcado TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (item_id, fecha)
);

-- Catálogo inicial, tal como lo describió la titular en la entrevista
-- ("Horarios y operación diaria", preguntas 6 y 7) — editable después desde
-- la app, no es una lista fija.
INSERT INTO checklist_items (tipo, descripcion, orden) VALUES
    ('apertura', 'Encender las luces', 1),
    ('apertura', 'Poner el gas', 2),
    ('apertura', 'Abrir el establecimiento', 3),
    ('apertura', 'Alistar el área de preparación y la vitrina', 4),
    ('apertura', 'Revisar el inventario del día', 5),
    ('cierre', 'Apagar y cortar el gas', 1),
    ('cierre', 'Hacer limpieza general', 2),
    ('cierre', 'Sacar la basura y los desperdicios', 3),
    ('cierre', 'Hacer el corte de caja', 4),
    ('cierre', 'Apagar las luces', 5)
ON CONFLICT DO NOTHING;
