-- Ventas sin internet (2026-11-16): cada venta que sale del POS lleva una clave
-- unica generada en el navegador. Si el POS no recibe respuesta (se cayo el
-- internet justo al cobrar) y reintenta, el servidor reconoce la clave y
-- devuelve la venta que ya registro en vez de crear una duplicada.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS clave_idempotencia VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ordenes_clave_idempotencia
    ON ordenes (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
