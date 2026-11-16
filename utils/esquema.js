// =============================================================================
// utils/esquema.js — ¿YA EXISTE ESTA COLUMNA/TABLA EN LA BASE? (2026-11-16)
// =============================================================================
// El código se despliega (Render) antes de que alguien corra la migración SQL en
// Neon. Con esto, una función nueva puede preguntar si su columna ya existe y,
// si no, comportarse como antes en vez de fallar con un error 500. Una columna
// que SÍ existe se recuerda para siempre; una que no, se vuelve a preguntar a
// los 30 s (para notar la migración sin reiniciar el servidor).
// =============================================================================
const pool = require('../db');

const TTL_NO_MS = 30 * 1000;
const cache = new Map(); // "tabla.columna" → { existe, ts }

async function tieneColumna(tabla, columna) {
  const llave = `${tabla}.${columna}`;
  const guardado = cache.get(llave);
  if (guardado && (guardado.existe || Date.now() - guardado.ts < TTL_NO_MS)) {
    return guardado.existe;
  }
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [tabla, columna],
  );
  const existe = r.rows.length > 0;
  cache.set(llave, { existe, ts: Date.now() });
  return existe;
}

async function tieneTabla(tabla) {
  const llave = `tabla:${tabla}`;
  const guardado = cache.get(llave);
  if (guardado && (guardado.existe || Date.now() - guardado.ts < TTL_NO_MS)) {
    return guardado.existe;
  }
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
    [tabla],
  );
  const existe = r.rows.length > 0;
  cache.set(llave, { existe, ts: Date.now() });
  return existe;
}

module.exports = { tieneColumna, tieneTabla };
