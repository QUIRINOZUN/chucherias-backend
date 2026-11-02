-- =============================================================================
-- 2026-11-02_cortes_diferencia_por_metodo.sql — Diferencia del corte por método
-- =============================================================================
-- cortes_caja.diferencia era UNA sola cifra (contado total − sistema total):
-- si sobraban $50 en efectivo y faltaban $50 en transferencia, daba 0 y el
-- corte aparecía cuadrado, ocultando un descuadre real. Ahora también se
-- guarda la diferencia de cada método por separado. Nullable: los cortes
-- anteriores a esta migración no la tienen y se siguen mostrando como antes.
-- =============================================================================

ALTER TABLE cortes_caja ADD COLUMN IF NOT EXISTS diferencia_efectivo NUMERIC(10,2);
ALTER TABLE cortes_caja ADD COLUMN IF NOT EXISTS diferencia_transferencia NUMERIC(10,2);
