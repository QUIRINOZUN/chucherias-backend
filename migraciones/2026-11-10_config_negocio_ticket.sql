-- Datos del establecimiento que se imprimen en los tickets (editables por el administrador).
ALTER TABLE config_negocio
  ADD COLUMN IF NOT EXISTS nombre          VARCHAR(80),
  ADD COLUMN IF NOT EXISTS titular         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS rfc             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS direccion       VARCHAR(200),
  ADD COLUMN IF NOT EXISTS telefono        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS horario         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS leyenda         VARCHAR(160),
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS logo_public_id  TEXT;

UPDATE config_negocio SET
  nombre    = COALESCE(nombre, 'Chucherías Mix'),
  titular   = COALESCE(titular, 'Reyna Ximena Morales Berumen'),
  direccion = COALESCE(direccion, 'Av. 5 de Mayo #400, Francisco I. Madero, Durango'),
  telefono  = COALESCE(telefono, '677 883 1025'),
  horario   = COALESCE(horario, 'Martes a domingo, 2:00 pm a 9:30 pm'),
  leyenda   = COALESCE(leyenda, 'Ticket de venta. No es comprobante fiscal.')
WHERE id = 1;
