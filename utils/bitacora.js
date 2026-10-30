// =============================================================================
// utils/bitacora.js — REGISTRO DE ACCIONES DE ALTO RIESGO (2026-10-30)
// =============================================================================
// Un solo punto para escribir en bitacora_acciones (ver
// migraciones/2026-10-30_bitacora.sql) — nunca escribir directo en la tabla
// desde una ruta, para que todas las filas tengan la misma forma.
//
// `registrarAccion` es "mejor esfuerzo": si falla (ej. la tabla no existiera
// todavía en algún entorno), SOLO se registra en el log del servidor — nunca
// debe tumbar la acción real que se está auditando (cancelar una venta,
// eliminar historial, etc.). Por eso nunca se le hace `await` bloqueante
// dentro de una transacción ni se propaga su error hacia quien la llama.
//
// `ejecutor` es `pool` o un `client` de una transacción en curso — igual
// patrón que el resto del proyecto (ver routes/ventasEspeciales.js). Dentro
// de una transacción que podría hacer ROLLBACK, usar el `pool` global en vez
// del `client` de esa transacción, para que la fila de bitácora sobreviva
// aunque la acción se revierta por otro motivo (ej. un error a medio camino).
// =============================================================================
const pool = require('../db');

async function registrarAccion({ usuarioId, usuarioNombre, accion, detalle }) {
  try {
    await pool.query(
      `INSERT INTO bitacora_acciones (usuario_id, usuario_nombre, accion, detalle)
       VALUES ($1, $2, $3, $4)`,
      [usuarioId ?? null, usuarioNombre || 'Desconocido', accion, detalle || null],
    );
  } catch (error) {
    console.error('No se pudo registrar en la bitácora:', error.message);
  }
}

module.exports = { registrarAccion };
