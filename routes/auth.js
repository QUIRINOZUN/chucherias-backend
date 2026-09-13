const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
// Recibe usuario y contraseña, devuelve un token si son correctos.
router.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;

  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  try {
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.contrasena_hash, u.activo, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       WHERE u.usuario = $1`,
      [usuario]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const usuarioEncontrado = resultado.rows[0];

    if (!usuarioEncontrado.activo) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada.' });
    }

    const contrasenaValida = await bcrypt.compare(contrasena, usuarioEncontrado.contrasena_hash);
    if (!contrasenaValida) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const payload = {
      id: usuarioEncontrado.id,
      usuario: usuarioEncontrado.usuario,
      nombre: usuarioEncontrado.nombre,
      rol: usuarioEncontrado.rol,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

    res.json({ token, usuario: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// GET /api/auth/me
// Devuelve los datos del usuario actualmente autenticado (según su token).
router.get('/me', verificarToken, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;