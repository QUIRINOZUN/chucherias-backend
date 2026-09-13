const { Pool } = require('pg');

// Conexión reutilizable a PostgreSQL (Neon).
// Se importa este mismo "pool" desde cualquier archivo de rutas,
// en vez de crear una conexión nueva cada vez.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;