-- RF-23: para poder revertir una visita/descuento de lealtad al cancelar la
-- venta que la generó (ver routes/ventas.js), hace falta saber EXACTAMENTE
-- qué número de visita del ciclo fue, sin tener que parsear el texto de
-- `descripcion` ("Visita #N del ciclo"). Solo se llena en filas
-- tipo_evento = 'visita'.
ALTER TABLE lealtad_historial ADD COLUMN IF NOT EXISTS visita_numero INTEGER;
