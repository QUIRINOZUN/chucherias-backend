-- RF-16: extras con costo en una elección (ej. "cacahuate diferente +$5" en
-- Pepihuates/Picamix). El modelo de grupo de elección nunca tuvo un campo de
-- precio; el servidor YA resuelve cada insumo elegido por NOMBRE (ver
-- routes/ventas.js), así que el cargo se define aquí, a nivel insumo, y el
-- servidor lo suma al total SIN confiar en ningún precio que mande el
-- cliente — nunca se agrega un concepto nuevo de "precio por elección" en el
-- frontend, solo se consulta este campo del insumo ya resuelto.
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS costo_extra NUMERIC(10,2);

-- Congela el cargo aplicado en el momento de la venta (igual que
-- orden_detalle.precio_unitario) — si el costo_extra del insumo cambia
-- después, esta venta conserva lo que realmente se cobró.
ALTER TABLE orden_detalle_insumos ADD COLUMN IF NOT EXISTS costo_extra_aplicado NUMERIC(10,2);
