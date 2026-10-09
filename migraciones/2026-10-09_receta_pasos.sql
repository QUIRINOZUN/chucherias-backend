-- receta_pasos (2026-10-09): tutorial de elaboración, para que un auxiliar de
-- cocina nuevo que no conoce un platillo pueda prepararlo igual. Es una tabla
-- nueva, hermana de receta_insumos (misma FK a recetas.id), en vez de una sola
-- columna de texto largo: cada renglón es UN paso numerado, para poder
-- reordenar/agregar/quitar pasos sueltos sin reescribir todo el tutorial cada
-- vez (igual razón por la que los insumos de una receta son filas, no una
-- lista en una sola columna).
CREATE TABLE IF NOT EXISTS receta_pasos (
    id           SERIAL PRIMARY KEY,
    receta_id    INTEGER NOT NULL REFERENCES recetas(id),
    numero_paso  INTEGER NOT NULL,
    descripcion  TEXT NOT NULL,
    UNIQUE (receta_id, numero_paso)
);
