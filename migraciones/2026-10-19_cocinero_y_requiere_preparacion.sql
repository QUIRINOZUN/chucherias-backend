-- 2026-10-19: dos cambios de esquema pedidos juntos para el flujo de cocina.
--
-- 1) ordenes.cocinero_id — el organigrama real tiene 2 auxiliares de cocina,
--    cada uno trabajando una orden independiente "en proceso" (estado
--    'preparando'). Mismo patrón que ordenes.repartidor_id (FK a empleados,
--    nullable: sin fila = sin asignar todavía).
--
-- 2) productos.requiere_preparacion — hay productos que no pasan por cocina
--    (bebidas embotelladas, botanas de bolsa): sus órdenes deben poder saltar
--    directo a 'por_entregar' en vez de esperar en el tablero de cocina.
--    DEFAULT TRUE: todo el catálogo existente sigue necesitando preparación
--    hasta que alguien marque lo contrario desde Recetario → Menú.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS cocinero_id INTEGER REFERENCES empleados(id);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS requiere_preparacion BOOLEAN NOT NULL DEFAULT TRUE;
