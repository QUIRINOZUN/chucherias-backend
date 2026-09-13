const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

// Todas las rutas de este archivo requieren estar autenticado.
router.use(verificarToken);

// GET /api/usuarios
// Lista los usuarios del sistema. Visible para administrador y encargado.
router.get('/', requiereRol('administrador', 'encargado'), async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.activo, u.fecha_creacion, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       ORDER BY u.nombre`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los usuarios.' });
  }
});

// POST /api/usuarios
// Crea un nuevo usuario. Solo el administrador puede dar de alta cuentas (RF-24).
router.post('/', requiereRol('administrador'), async (req, res) => {
  const { nombre, usuario, contrasena, rol_id } = req.body;

  if (!nombre || !usuario || !contrasena || !rol_id) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    const yaExiste = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (yaExiste.rows.length > 0) {
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
    }

    const contrasenaHash = await bcrypt.hash(contrasena, 10);

    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, usuario, contrasena_hash, rol_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, nombre, usuario, rol_id, activo, fecha_creacion`,
      [nombre, usuario, contrasenaHash, rol_id]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el usuario.' });
  }
});

// PATCH /api/usuarios/:id/activo
// Activa o desactiva una cuenta. Solo el administrador (RF-24).
router.patch('/:id/activo', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body; // true o false

  try {
    const resultado = await pool.query(
      `UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, usuario, activo`,
      [activo, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
  }
});

module.exports = router;