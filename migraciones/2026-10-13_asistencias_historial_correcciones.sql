-- RF-19: evidencia automática al corregir un registro de asistencia.
-- Antes, PATCH /api/asistencias/:id no dejaba ningún rastro de quién
-- corrigió, cuándo, ni qué valor tenía antes — la única "evidencia" era lo
-- que alguien escribiera a mano en observaciones (opcional). Una fila por
-- cada corrección (no solo la última) para un historial completo.
CREATE TABLE IF NOT EXISTS asistencias_historial_correcciones (
  id SERIAL PRIMARY KEY,
  asistencia_id INTEGER NOT NULL REFERENCES asistencias(id) ON DELETE CASCADE,
  corregido_por INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_correccion TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_anterior DATE NOT NULL,
  hora_entrada_anterior TIME,
  hora_salida_anterior TIME,
  observaciones_anteriores TEXT
);

CREATE INDEX IF NOT EXISTS idx_historial_correcciones_asistencia
  ON asistencias_historial_correcciones (asistencia_id);
