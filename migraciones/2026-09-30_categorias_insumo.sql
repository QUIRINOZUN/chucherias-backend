-- Categorías de INSUMOS (inventario) — dominio separado de `categorias`
-- (que es el de productos del menú): agrupar 138 insumos en una sola lista
-- plana era difícil de navegar en la pantalla de Inventario, así que se
-- categorizan igual que ya se agrupaban por comentarios en
-- scripts/seed-insumos.js (proteínas, panes, lácteos, etc.).
--
-- Ejecutar una sola vez en la consola SQL de Neon (base real), y después
-- correr scripts/seed-categorias-insumo.js para poblar las categorías y
-- asignarlas a los insumos existentes.
CREATE TABLE IF NOT EXISTS categorias_insumo (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(60) NOT NULL UNIQUE
);

ALTER TABLE insumos ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias_insumo(id);
