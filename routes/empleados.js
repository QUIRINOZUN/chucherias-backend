// =============================================================================
// routes/empleados.js — PERSONAL DEL NEGOCIO (Sprint 3, control de asistencias)
// =============================================================================
// Endpoints (prefijo /api/empleados), todos exigen sesión, solo
// administrador/encargado (mismo criterio que usuarios/insumos/proveedores).
//
//   GET   /          → lista de empleados (activos por default)
//   POST  /           → dar de alta un empleado
//   PATCH /:id        → editar nombre, puesto, usuario_id o fecha_ingreso
//   PATCH /:id/activo → activar / desactivar (nunca se borra, igual que usuarios)
//
// `empleados` es un dominio DISTINTO de `usuarios`: un empleado (alguien que
// cobra un sueldo y marca asistencia) no necesariamente tiene una cuenta para
// entrar al sistema (un repartidor, por ejemplo). `usuario_id` es opcional y
// solo liga al empleado con su cuenta cuando la tiene.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// GET /api/empleados?todos=1
// Por default solo los activos (para los selectores de "marcar asistencia" y
// de alta); ?todos=1 trae también a los desactivados (para la pantalla de
// gestión, donde hace falta poder reactivarlos).
router.get('/', async (req, res) => {
  const incluirInactivos = req.query.todos === '1';
  try {
    const resultado = await pool.query(
      `SELECT e.id, e.nombre, e.puesto, to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
              e.activo, e.usuario_id, u.usuario AS usuario_login
       FROM empleados e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
       ${incluirInactivos ? '' : 'WHERE e.activo = TRUE'}
       ORDER BY e.nombre`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los empleados.' });
  }
});

// POST /api/empleados
router.post('/', async (req, res) => {
  const { nombre, puesto, fecha_ingreso, usuario_id } = req.body;

  if (!nombre?.trim() || !puesto?.trim() || !fecha_ingreso) {
    return res
      .status(400)
      .json({ error: 'Nombre, puesto y fecha de ingreso son obligatorios.' });
  }

  try {
    // usuario_id es opcional, pero si se manda debe ser una cuenta real y
    // ningún otro empleado puede estar ligado a ella ya (UNIQUE en la tabla).
    if (usuario_id) {
      const cuenta = await pool.query('SELECT id FROM usuarios WHERE id = $1', [usuario_id]);
      if (cuenta.rows.length === 0) {
        return res.status(400).json({ error: 'La cuenta de usuario indicada no existe.' });
      }
      const yaLigado = await pool.query('SELECT id FROM empleados WHERE usuario_id = $1', [
        usuario_id,
      ]);
      if (yaLigado.rows.length > 0) {
        return res.status(409).json({ error: 'Esa cuenta ya está ligada a otro empleado.' });
      }
    }

    // fecha_ingreso se re-consulta con to_char() antes de responder (ver nota
    // en GET /) — RETURNING por sí solo entregaría un Date en UTC medianoche.
    const resultado = await pool.query(
      `INSERT INTO empleados (nombre, puesto, fecha_ingreso, usuario_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [nombre.trim(), puesto.trim(), fecha_ingreso, usuario_id || null]
    );
    const fila = await pool.query(
      `SELECT id, nombre, puesto, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, activo, usuario_id
       FROM empleados WHERE id = $1`,
      [resultado.rows[0].id]
    );
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el empleado.' });
  }
});

// PATCH /api/empleados/:id
// Edición parcial: cada campo que no llegue conserva su valor actual.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, puesto, fecha_ingreso, usuario_id } = req.body;

  try {
    const actual = await pool.query('SELECT * FROM empleados WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }
    const empleadoActual = actual.rows[0];

    const nuevoNombre = nombre?.trim() || empleadoActual.nombre;
    const nuevoPuesto = puesto?.trim() || empleadoActual.puesto;
    const nuevaFecha = fecha_ingreso || empleadoActual.fecha_ingreso;

    // usuario_id: undefined = no tocar; '' o null = quitar el vínculo; un id = fijarlo.
    let nuevoUsuarioId = empleadoActual.usuario_id;
    if (usuario_id !== undefined) {
      nuevoUsuarioId = usuario_id || null;
      if (nuevoUsuarioId) {
        const yaLigado = await pool.query(
          'SELECT id FROM empleados WHERE usuario_id = $1 AND id != $2',
          [nuevoUsuarioId, id]
        );
        if (yaLigado.rows.length > 0) {
          return res.status(409).json({ error: 'Esa cuenta ya está ligada a otro empleado.' });
        }
      }
    }

    await pool.query(
      `UPDATE empleados SET nombre = $1, puesto = $2, fecha_ingreso = $3, usuario_id = $4
       WHERE id = $5`,
      [nuevoNombre, nuevoPuesto, nuevaFecha, nuevoUsuarioId, id]
    );
    const fila = await pool.query(
      `SELECT id, nombre, puesto, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, activo, usuario_id
       FROM empleados WHERE id = $1`,
      [id]
    );
    res.json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el empleado.' });
  }
});

// PATCH /api/empleados/:id/activo
// Nunca se borra un empleado (su historial de asistencias quedaría huérfano):
// se desactiva, igual que las cuentas de usuarios.
router.patch('/:id/activo', async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;

  try {
    const resultado = await pool.query(
      'UPDATE empleados SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo',
      [activo, id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el empleado.' });
  }
});

module.exports = router;
