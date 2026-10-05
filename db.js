// =============================================================================
// db.js — CONEXIÓN A LA BASE DE DATOS (PostgreSQL alojado en Neon)
// =============================================================================
// Este archivo crea UN SOLO "pool" de conexiones y lo exporta. Todos los
// archivos de rutas hacen `require('../db')` y comparten ese mismo pool.
//
// ¿Por qué un pool? Abrir una conexión nueva por cada petición es lento y
// desperdicia el límite de conexiones del plan gratuito de Neon. El pool
// mantiene un grupo de conexiones abiertas y las presta según se necesitan.
//
// Dos formas de usarlo en el resto del backend:
//   - pool.query(sql, [params])  → una consulta suelta (la más común).
//   - pool.connect()             → toma UNA conexión exclusiva para armar una
//                                  transacción (BEGIN ... COMMIT/ROLLBACK),
//                                  como en registrar una venta. Siempre se
//                                  debe liberar con client.release().
// =============================================================================
const { Pool } = require('pg');

// Conexión reutilizable a PostgreSQL (Neon).
// Se importa este mismo "pool" desde cualquier archivo de rutas,
// en vez de crear una conexión nueva cada vez.
const pool = new Pool({
  // Cadena de conexión completa de Neon, guardada en .env (nunca en el código).
  connectionString: process.env.DATABASE_URL,
  // Neon exige SSL. `rejectUnauthorized: false` acepta su certificado sin
  // validar la cadena completa, lo que simplifica la conexión desde Render.
  ssl: { rejectUnauthorized: false },
});

// SIN esto, un cliente INACTIVO del pool cuya conexión Neon cierra (se
// "duerme" tras ~5 min sin uso — ver nota de planes gratuitos en CLAUDE.md)
// dispara un error no capturado que tumba TODO el proceso de Node, no solo
// esa conexión. `pg` exige este listener explícitamente para ese caso; sin
// él, el servidor se cae solo cada vez que pasa suficiente tiempo sin
// consultas y luego llega una nueva petición.
pool.on('error', (error) => {
  console.error('Error inesperado en una conexión inactiva del pool:', error.message);
});

module.exports = pool;
