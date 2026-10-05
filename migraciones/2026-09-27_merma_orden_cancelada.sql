-- Al cancelar una venta, ahora se registra la merma de lo que ya no se pudo
-- vender (una fila en mermas por cada producto de la orden, sin importar en
-- qué estado estaba la comanda). Para poder rastrear de qué orden vino cada
-- merma (reportes futuros, o simplemente auditar), se agrega orden_id.
-- Ejecutar una sola vez en la consola SQL de Neon (base real).
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS orden_id INTEGER REFERENCES ordenes(id);
