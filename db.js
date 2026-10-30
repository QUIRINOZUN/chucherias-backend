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
const { Pool, types } = require('pg');

// BUG REAL ENCONTRADO Y CORREGIDO (2026-10-30): por default, `pg` interpreta
// una columna TIMESTAMP WITHOUT TIME ZONE (OID 1114 — ventas.fecha, mermas.fecha,
// ordenes.fecha_creacion, movimientos_caja.fecha, etc.) usando la zona horaria
// LOCAL del proceso de Node, NO como UTC — aunque Neon de verdad guarda esos
// dígitos en UTC (confirmado leyendo el texto crudo de la columna) y el resto
// del backend asume justo eso (ver utils/fecha.js, diaNegocioSql/`AT TIME ZONE
// 'UTC'`). En una máquina de desarrollo con TZ=America/Mexico_City, esto hacía
// que CUALQUIER fecha/hora llegara al frontend adelantada 6 horas (se descubrió
// al investigar por qué Comandas mostraba "recién llegada" aunque ya llevara
// rato esperando — ver CLAUDE.md, "Comandas: dirección visual..."). En
// producción (Render) esto no se había notado porque el contenedor corre en
// UTC, donde "hora local" y "UTC" coinciden por casualidad — pero el bug
// seguía latente para cualquier otro entorno. Se corrige de raíz forzando a
// `pg` a parsear SIEMPRE estas columnas como UTC, sin importar en qué zona
// horaria corra el proceso de Node.
types.setTypeParser(1114, (texto) => new Date(`${texto}Z`));

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
