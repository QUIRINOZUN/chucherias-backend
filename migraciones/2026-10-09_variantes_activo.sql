-- variantes_producto gana "activo" (2026-10-09): hasta ahora solo el
-- PRODUCTO completo se podía desactivar (ocultando TODAS sus variantes del
-- punto de venta); esto permite deshabilitar una sola presentación (ej. "Paquete
-- #3" agotado) sin tocar las demás variantes del mismo producto. Mismo
-- patrón que productos.activo/empleados.activo/usuarios.activo: nunca se
-- borra lo que ya se vendió, se desactiva.
ALTER TABLE variantes_producto ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
