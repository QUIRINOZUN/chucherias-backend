-- RNF-02: "Toda operación crítica (ventas, cancelaciones, ajustes de
-- inventario, cambios de precio, modificación de recetas) debe quedar
-- registrada con el usuario y la fecha/hora en que se realizó." Ventas,
-- cancelaciones y ajustes de inventario ya lo tenían; cambios de precio
-- (variantes_producto) y modificación de recetas (recetas) no.
ALTER TABLE variantes_producto ADD COLUMN IF NOT EXISTS editado_por INTEGER REFERENCES usuarios(id);
ALTER TABLE variantes_producto ADD COLUMN IF NOT EXISTS fecha_edicion TIMESTAMP;

ALTER TABLE recetas ADD COLUMN IF NOT EXISTS editado_por INTEGER REFERENCES usuarios(id);
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS fecha_edicion TIMESTAMP;
