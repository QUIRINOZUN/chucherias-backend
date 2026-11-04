// =============================================================================
// scripts/respaldo.js — Exporta TODAS las tablas de la base a archivos JSON
// =============================================================================
// Copia de seguridad "de emergencia" que se puede sacar desde esta misma
// computadora, sin necesitar pg_dump. Útil antes de iniciar la prueba piloto,
// antes de una limpieza de datos o antes de un cambio grande.
//
// Uso (desde chucherias-backend):   npm run respaldo
//
// Deja una carpeta nueva en  CHUCHERIAS/respaldos/AAAA-MM-DD_HHMMSS/  (FUERA de
// los repositorios de git: nunca se sube a GitHub, contiene datos reales).
// Solo LEE la base; no modifica nada.
//
// El respaldo semanal AUTOMÁTICO (pg_dump cifrado) vive en
// .github/workflows/respaldo-semanal.yml; este script es el complemento manual
// y no sustituye a ese: JSON sirve para consultar o rescatar datos, pg_dump
// sirve para restaurar la base completa.
// =============================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function respaldar() {
  const ahora = new Date();
  const sello = ahora
    .toISOString()
    .replace(/[:T]/g, (c) => (c === 'T' ? '_' : ''))
    .slice(0, 17);
  // chucherias-backend/scripts -> subir dos niveles = carpeta CHUCHERIAS
  const carpeta = path.join(__dirname, '..', '..', 'respaldos', sello);
  fs.mkdirSync(carpeta, { recursive: true });

  const tablas = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );

  const resumen = {};
  for (const { table_name: tabla } of tablas.rows) {
    // El nombre sale del catálogo de la propia base, no de entrada externa.
    const filas = await pool.query(`SELECT * FROM "${tabla}"`);
    fs.writeFileSync(path.join(carpeta, `${tabla}.json`), JSON.stringify(filas.rows, null, 2));
    resumen[tabla] = filas.rows.length;
  }

  fs.writeFileSync(
    path.join(carpeta, '_resumen.json'),
    JSON.stringify({ generado: ahora.toISOString(), tablas: resumen }, null, 2),
  );

  const totalFilas = Object.values(resumen).reduce((a, b) => a + b, 0);
  console.log(`Respaldo listo: ${tablas.rows.length} tablas, ${totalFilas} filas.`);
  console.log(`Carpeta: ${carpeta}`);
}

respaldar()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('No se pudo sacar el respaldo:', error.message);
    process.exit(1);
  });
