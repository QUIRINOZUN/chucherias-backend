// =============================================================================
// routes/auth.js — INICIO DE SESIÓN (Sprint 1)
// =============================================================================
// Endpoints (prefijo /api/auth):
//   POST /login → recibe usuario y contraseña; si son correctos devuelve un JWT.
//   GET  /me    → devuelve el usuario dueño del token (requiere sesión).
//
// FLUJO DE LOGIN
//   1. El frontend envía { usuario, contrasena }.
//   2. Se busca el usuario en la BD junto con el nombre de su rol.
//   3. Se rechaza si no existe (401), está desactivado (403) o la contraseña no
//      coincide con el hash guardado (401).
//   4. Si todo es correcto se firma un JWT de 8 horas con { id, usuario,
//      nombre, rol }. El frontend lo guarda y lo manda en cada petición
//      posterior (header Authorization: Bearer <token>).
//
// SEGURIDAD
//   - Las contraseñas NUNCA se guardan en claro: solo el hash bcrypt.
//   - Para usuario inexistente y contraseña incorrecta se devuelve el MISMO
//     mensaje, así nadie puede averiguar qué usuarios existen.
// =============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
// Recibe usuario y contraseña, devuelve un token si son correctos.
// Esta es la ÚNICA ruta de la API que no exige token (no puede: es la que lo entrega).
router.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;

  // Validación básica: ambos campos son obligatorios.
  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  try {
    // Trae al usuario con el nombre de su rol (JOIN con la tabla roles).
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.contrasena_hash, u.activo, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       WHERE u.usuario = $1`,
      [usuario]
    );

    // Usuario inexistente: mismo mensaje que contraseña incorrecta (ver arriba).
    if (resultado.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const usuarioEncontrado = resultado.rows[0];

    // Una cuenta desactivada por el administrador no puede entrar aunque
    // la contraseña sea correcta (RF-24).
    if (!usuarioEncontrado.activo) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada.' });
    }

    // bcrypt compara la contraseña escrita contra el hash guardado.
    const contrasenaValida = await bcrypt.compare(contrasena, usuarioEncontrado.contrasena_hash);
    if (!contrasenaValida) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    // Datos que viajan DENTRO del token (y que el middleware verificarToken
    // expondrá luego como req.usuario). Nunca incluye la contraseña ni su hash.
    const payload = {
      id: usuarioEncontrado.id,
      usuario: usuarioEncontrado.usuario,
      nombre: usuarioEncontrado.nombre,
      rol: usuarioEncontrado.rol,
    };

    // El token vence a las 8 horas (más que una jornada completa del negocio).
    // El frontend además cierra la sesión por inactividad (RNF-01).
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
