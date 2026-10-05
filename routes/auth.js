// =============================================================================
// routes/auth.js — INICIO DE SESIÓN (Sprint 1)
// =============================================================================
// Endpoints (prefijo /api/auth):
//   POST /login  → recibe usuario y contraseña; si son correctos devuelve un JWT.
//   POST /logout → cierra el turno de asistencia abierto de hoy (si aplica).
//   GET  /me     → devuelve el usuario dueño del token (requiere sesión).
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
//
// ASISTENCIA AUTOMÁTICA (Sprint 3, decisión del usuario): cada cuenta —salvo
// administrador— se asume ligada a un empleado (`empleados.usuario_id`).
// Iniciar sesión marca su ENTRADA; cerrar sesión marca su SALIDA, vía
// utils/asistenciaAutomatica.js (compartido con el botón de autoservicio de
// routes/asistencias.js). El único que sigue siendo manual es el
// repartidor, que no tiene cuenta (su horario varía) — a ese lo registra el
// encargado a mano desde Asistencias. Ninguna de las dos operaciones
// bloquea el login/logout si falla o si está fuera de la ventana horaria
// permitida: son "mejor esfuerzo", nunca una condición para poder entrar o
// salir del sistema (solo deciden si se guarda un registro, no si el login
// en sí funciona).
// =============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');
const { intentarRegistrarEntrada, intentarRegistrarSalida } = require('../utils/asistenciaAutomatica');

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

    // Asistencia automática (ver nota al inicio del archivo): nunca debe
    // impedir el login. Si no se marcó (sin empleado ligado, fuera de
    // horario, o ya tenía una entrada abierta) simplemente no pasa nada —
    // el `motivo` no se usa aquí, solo importa en el botón de autoservicio.
    if (usuarioEncontrado.rol !== 'administrador') {
      try {
        await intentarRegistrarEntrada(pool, usuarioEncontrado.id);
      } catch (errorAsistencia) {
        console.error('No se pudo registrar la asistencia automática:', errorAsistencia.message);
      }
    }

    res.json({ token, usuario: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// POST /api/auth/logout
// El frontend la llama justo antes de borrar el token (core/auth.ts). Cierra
// el turno de asistencia que haya quedado abierto hoy, si aplica. Siempre
// responde 200: el cierre de sesión del frontend no depende de esto.
router.post('/logout', verificarToken, async (req, res) => {
  try {
    await intentarRegistrarSalida(pool, req.usuario.id);
  } catch (error) {
    console.error('No se pudo registrar la salida automática:', error.message);
  }
  res.json({ ok: true });
});

// GET /api/auth/me
// Devuelve los datos del usuario actualmente autenticado (según su token).
router.get('/me', verificarToken, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
