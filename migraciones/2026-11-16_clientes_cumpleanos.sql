-- Cumpleaños de clientes de lealtad (2026-11-16): fecha de nacimiento opcional,
-- para avisar quién cumple años este mes. Solo se usa el día y el mes.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
