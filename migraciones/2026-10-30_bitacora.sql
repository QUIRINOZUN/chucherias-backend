-- Bitácora de auditoría (2026-10-30): quién hizo qué y cuándo, para las
-- acciones de alto riesgo del sistema. Nace motivada directamente por
-- "Eliminar historial" (2026-10-29/30, ver CLAUDE.md): esos botones borran
-- datos de producción de forma permanente y, hasta ahora, nadie quedaba
-- registrado haciéndolo — el propio historial que se acaba de borrar es el
-- único rastro que existía.
--
-- DECISIÓN DE ALCANCE: NO es una bitácora de "cada clic" del sistema (eso
-- generaría demasiado ruido y poco valor) — solo registra ACCIONES DE ALTO
-- RIESGO ya identificadas: los 9 "Eliminar historial", inicios de sesión,
-- eliminar un usuario, cancelar una venta, un retiro de caja y eliminar una
-- venta especial. Cada una se registra desde el propio endpoint que ya la
-- ejecuta (ver utils/bitacora.js), nunca desde un middleware genérico que
-- intente adivinar qué fue "importante".
--
-- `detalle` es texto libre pensado para leerse (ej. "Eliminó el historial
-- de ventas del 01/10 al 15/10 — 23 registros"), no una estructura para
-- volver a parsear por código. `usuario_nombre` se congela en el momento
-- (igual que orden_detalle.precio_unitario con las ventas) para que la
-- bitácora siga siendo legible aunque esa cuenta se renombre o se elimine
-- después — por eso usuario_id es nullable y SIN FK: una bitácora de
-- auditoría nunca debe perder una fila ni bloquearse porque la cuenta que
-- hizo la acción ya no exista.
CREATE TABLE IF NOT EXISTS bitacora_acciones (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER,
    usuario_nombre  VARCHAR(100) NOT NULL,
    accion          VARCHAR(50) NOT NULL,
    detalle         TEXT,
    fecha           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora_acciones(fecha);
CREATE INDEX IF NOT EXISTS idx_bitacora_accion ON bitacora_acciones(accion);
