const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

// Todas las rutas de este archivo requieren estar autenticado.
router.use(verificarToken);

// GET /api/usuarios/roles
// Catálogo de roles disponibles, para el formulario de alta de usuarios.
// Solo el administrador da de alta usuarios, así que solo él lo necesita.
router.get('/roles', requiereRol('administrador'), async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los roles.' });
  }
});

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

// PATCH /api/usuarios/:id
// Edita nombre, usuario, contraseña y/o rol de una cuenta existente. Solo el
// administrador (RF-24). La contraseña es opcional: si no se manda, se deja
// la actual sin cambios (así no hay que reescribirla en cada edición).
router.patch('/:id', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { nombre, usuario, contrasena, rol_id } = req.body;

  try {
    const actual = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    const usuarioActual = actual.rows[0];

    const nuevoNombre = nombre?.trim() || usuarioActual.nombre;
    const nuevoUsuario = usuario?.trim() || usuarioActual.usuario;
    const nuevoRolId = rol_id || usuarioActual.rol_id;

    if (nuevoUsuario !== usuarioActual.usuario) {
      const yaExiste = await pool.query(
        'SELECT id FROM usuarios WHERE usuario = $1 AND id != $2',
        [nuevoUsuario, id]
      );
      if (yaExiste.rows.length > 0) {
        return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
      }
    }

    let nuevoHash = usuarioActual.contrasena_hash;
    if (contrasena) {
      if (contrasena.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      }
      nuevoHash = await bcrypt.hash(contrasena, 10);
    }

    const resultado = await pool.query(
      `UPDATE usuarios SET nombre = $1, usuario = $2, rol_id = $3, contrasena_hash = $4
       WHERE id = $5
       RETURNING id, nombre, usuario, rol_id, activo, fecha_creacion`,
      [nuevoNombre, nuevoUsuario, nuevoRolId, nuevoHash, id]
    );

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
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