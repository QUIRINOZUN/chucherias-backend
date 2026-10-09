-- productos gana "imagen_public_id" (2026-10-09): junto con imagen_url
-- (ya existía, sin usar hasta ahora), guarda el identificador que Cloudinary
-- necesita para poder BORRAR o REEMPLAZAR una foto sin dejar archivos
-- huérfanos en la cuenta — ver routes/catalogo.js (POST/DELETE
-- /api/productos/:id/imagen) y utils/cloudinary.js.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_public_id VARCHAR(255);
