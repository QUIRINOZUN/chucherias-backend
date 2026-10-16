-- Foto de referencia "así debe quedar" por receta (2026-10-12), junto al
-- tutorial de pasos — vive en `recetas` (no en `productos`, esa es la foto
-- del platillo para el menú/POS; esta es para quien lo PREPARA, puede ser
-- distinta por variante incluso del mismo producto). Mismo patrón que
-- productos.imagen_url/imagen_public_id: el public_id hace falta para poder
-- borrar/reemplazar sin dejar archivos huérfanos en Cloudinary.
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255);
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS imagen_public_id VARCHAR(255);
