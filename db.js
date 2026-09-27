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

module.exports = pool;
