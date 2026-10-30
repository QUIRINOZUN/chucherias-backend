// =============================================================================
// routes/bitacora.js — CONSULTA DE LA BITÁCORA DE AUDITORÍA (2026-10-30)
// =============================================================================
// Endpoint (prefijo /api/bitacora), solo administrador — es información de
// supervisión del sistema, no una acción de mostrador:
//   GET /?desde=&hasta=&usuario_id=&accion=
//     → historial de acciones de alto riesgo, filtros opcionales y
//       combinables (sin filtros, los últimos 200 — ver LIMIT abajo, nunca
//       "todo" sin tope: a diferencia de mermas/ventas, esta tabla puede
//       crecer con cada inicio de sesión del día a día).
//
// Quién escribe aquí: ver utils/bitacora.js y las 12 llamadas a
// registrarAccion() repartidas en routes/auth.js, routes/ventas.js,
// routes/caja.js, routes/gastos.js, routes/insumos.js, routes/mermas.js,
// routes/asistencias.js, routes/checklist.js, routes/clientes.js,
// routes/ventasEspeciales.js (x2) y routes/usuarios.js. Esta pantalla es
// SOLO de lectura — nunca se escribe una fila desde aquí.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { diaNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol('administrador'));

const ACCIONES_VALIDAS = [
  'inicio_sesion',
  'eliminar_historial',
  'eliminar_usuario',
  'cancelar_venta',
  'retiro_caja',
  'eliminar_venta_especial',
];

function idValido(id) {
  return /^\d+$/.test(id);
}

// GET /api/bitacora?desde=&hasta=&usuario_id=&accion=
router.get('/', async (req, res) => {
  const { desde, hasta, usuario_id: usuarioId, accion } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (usuarioId && !idValido(usuarioId)) {
    return res.status(400).json({ error: 'El id de usuario debe ser numérico.' });
  }
  if (accion && !ACCIONES_VALIDAS.includes(accion)) {
    return res.status(400).json({
      error: `La acción debe ser una de: ${ACCIONES_VALIDAS.join(', ')}.`,
    });
  }

  try {
    const resultado = await pool.query(
      `SELECT id, usuario_id, usuario_nombre, accion, detalle, fecha
       FROM bitacora_acciones
       WHERE ($1::date IS NULL OR ${diaNegocioSql('fecha')} >= $1::date)
         AND ($2::date IS NULL OR ${diaNegocioSql('fecha')} <= $2::date)
         AND ($3::int IS NULL OR usuario_id = $3::int)
         AND ($4::text IS NULL OR accion = $4::text)
       ORDER BY fecha DESC
       LIMIT 200`,
      [desde || null, hasta || null, usuarioId || null, accion || null],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener la bitácora.' });
  }
});

module.exports = router;
