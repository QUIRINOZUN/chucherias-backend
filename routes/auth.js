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
//
// 2026-10-11: se retiró el autoservicio de asistencia (entrada/salida
// automática al iniciar/cerrar sesión, más el botón "Marcar mi entrada/
// salida" del dashboard) a petición del usuario — ver utils/
// asistenciaAutomatica.js (eliminado) y routes/asistencias.js. Registrar la
// asistencia vuelve a ser exclusivo de administrador/encargado, como en la
// primera versión de Sprint 3.
// =============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { verificarToken, invalidarCuenta } = require('../middleware/auth');
const { errorContrasena } = require('../utils/validar');
const { registrarAccion } = require('../utils/bitacora');
const { generarSecreto, verificarCodigo, uriOtpauth } = require('../utils/totp');

// Columnas de seguridad de cuenta (migración 2026-11-16). Si la migración aún
// no se corrió en la base, se asume "sin 2FA y sin cambio obligatorio" en vez
// de romper el login (error 42703 = columna inexistente).
async function leerSeguridad(id) {
  try {
    const r = await pool.query(
      'SELECT debe_cambiar_contrasena, totp_activo, totp_secreto FROM usuarios WHERE id = $1',
      [id],
    );
    return r.rows[0] || { debe_cambiar_contrasena: false, totp_activo: false, totp_secreto: null };
  } catch (error) {
    if (error.code === '42703') return { debe_cambiar_contrasena: false, totp_activo: false, totp_secreto: null };
    throw error;
  }
}

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);

// Límite de intentos de login: 10 intentos por IP cada 15 minutos. Es la
// única ruta pública del sistema (no exige sesión previa), así que es el
// único punto donde alguien podría probar fuerza bruta contra una cuenta
// conocida sin ninguna fricción. 10/15min es holgado para un empleado real
// que se equivoca de contraseña, pero corta cualquier automatización.
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.',
  },
});

// Contador PROPIO para activar/desactivar el 2FA: así no se gasta el presupuesto
// de intentos de inicio de sesión (todo el personal comparte la misma IP del
// negocio). Más holgado: son acciones con sesión ya iniciada.
const limitador2fa = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});

// POST /api/auth/login
// Recibe usuario y contraseña, devuelve un token si son correctos.
// Esta es la ÚNICA ruta de la API que no exige token (no puede: es la que lo entrega).
router.post('/login', limitadorLogin, async (req, res) => {
  const { usuario, contrasena, codigo } = req.body;

  // Validación básica: ambos campos son obligatorios.
  if (typeof usuario !== 'string' || typeof contrasena !== 'string' || !usuario || !contrasena) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  try {
    // Trae al usuario con el nombre de su rol (JOIN con la tabla roles).
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.contrasena_hash, u.activo, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       WHERE u.usuario = $1`,
      [usuario],
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

    // Verificación en dos pasos (si la cuenta la activó): tras validar la
    // contraseña se exige el código de 6 dígitos de la app autenticadora.
    // Sin código → 200 { requiere_codigo: true } para que el login lo pida.
    const seguridad = await leerSeguridad(usuarioEncontrado.id);
    if (seguridad.totp_activo) {
      if (codigo === undefined || codigo === null || codigo === '') {
        return res.json({ requiere_codigo: true });
      }
      if (!verificarCodigo(seguridad.totp_secreto, String(codigo))) {
        return res.status(401).json({ error: 'El código de verificación no es correcto.' });
      }
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
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '8h',
    });

    // Bitácora (2026-10-30): quién inició sesión y cuándo — mejor esfuerzo,
    // nunca bloquea ni arriesga el login si falla (ver utils/bitacora.js).
    registrarAccion({
      usuarioId: usuarioEncontrado.id,
      usuarioNombre: usuarioEncontrado.nombre,
      accion: 'inicio_sesion',
      detalle: `Rol: ${usuarioEncontrado.rol}`,
    });

    res.json({
      token,
      usuario: payload,
      debe_cambiar_contrasena: !!seguridad.debe_cambiar_contrasena,
      totp_activo: !!seguridad.totp_activo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// GET /api/auth/me
// Devuelve los datos del usuario actualmente autenticado (según su token).
router.get('/me', verificarToken, async (req, res) => {
  try {
    const seg = await leerSeguridad(req.usuario.id);
    res.json({
      usuario: req.usuario,
      debe_cambiar_contrasena: !!seg.debe_cambiar_contrasena,
      totp_activo: !!seg.totp_activo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar la cuenta.' });
  }
});

// PATCH /api/auth/contrasena
// Cada persona cambia SU PROPIA contraseña (cualquier rol): exige la actual,
// así que alguien con la sesión abierta en un equipo ajeno no puede
// cambiarla sin conocerla. Mismo límite de intentos que el login, porque
// también sirve para probar contraseñas actuales.
router.patch('/contrasena', verificarToken, limitadorLogin, async (req, res) => {
  const { contrasena_actual: actual, contrasena_nueva: nueva } = req.body;

  if (typeof actual !== 'string' || typeof nueva !== 'string' || !actual || !nueva) {
    return res.status(400).json({ error: 'Debes indicar la contraseña actual y la nueva.' });
  }
  const errorClave = errorContrasena(nueva, req.usuario.usuario);
  if (errorClave) {
    return res.status(400).json({ error: errorClave });
  }
  if (actual === nueva) {
    return res.status(400).json({ error: 'La contraseña nueva debe ser distinta de la actual.' });
  }

  try {
    const fila = await pool.query('SELECT contrasena_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (fila.rows.length === 0) {
      return res.status(404).json({ error: 'Cuenta no encontrada.' });
    }
    if (!(await bcrypt.compare(actual, fila.rows[0].contrasena_hash))) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }
    const hash = await bcrypt.hash(nueva, 10);
    await pool.query('UPDATE usuarios SET contrasena_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
    // Ya eligió contraseña propia: se quita el cambio obligatorio (si la columna existe).
    await pool
      .query('UPDATE usuarios SET debe_cambiar_contrasena = FALSE WHERE id = $1', [req.usuario.id])
      .catch((e) => {
        if (e.code !== '42703') throw e;
      });
    invalidarCuenta(req.usuario.id);

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'cambio_contrasena',
      detalle: 'Cambió su propia contraseña.',
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al cambiar la contraseña.' });
  }
});

// ---- Verificación en dos pasos (cualquier rol, sobre su propia cuenta) ----

// POST /api/auth/2fa/preparar — genera un secreto nuevo (aún inactivo) y lo
// devuelve junto con la URI para el QR. No cambia nada hasta /activar.
router.post('/2fa/preparar', verificarToken, async (req, res) => {
  try {
    const seg = await leerSeguridad(req.usuario.id);
    if (seg.totp_activo) {
      return res.status(409).json({ error: 'La verificación en dos pasos ya está activada.' });
    }
    const secreto = generarSecreto();
    await pool.query('UPDATE usuarios SET totp_secreto = $1, totp_activo = FALSE WHERE id = $2', [
      secreto,
      req.usuario.id,
    ]);
    res.json({ secreto, uri: uriOtpauth(secreto, req.usuario.usuario) });
  } catch (error) {
    if (error.code === '42703') {
      return res.status(503).json({ error: 'Esta función todavía no está habilitada en el servidor.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al preparar la verificación en dos pasos.' });
  }
});

// POST /api/auth/2fa/activar { codigo } — comprueba que la app ya genera
// códigos válidos con ese secreto y entonces la activa.
router.post('/2fa/activar', verificarToken, limitador2fa, async (req, res) => {
  try {
    const seg = await leerSeguridad(req.usuario.id);
    if (!seg.totp_secreto) {
      return res.status(400).json({ error: 'Primero genera el código QR.' });
    }
    if (!verificarCodigo(seg.totp_secreto, String(req.body.codigo ?? ''))) {
      return res.status(400).json({ error: 'El código no es correcto. Revisa la hora de tu teléfono.' });
    }
    await pool.query('UPDATE usuarios SET totp_activo = TRUE WHERE id = $1', [req.usuario.id]);
    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'cambio_contrasena',
      detalle: 'Activó la verificación en dos pasos.',
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al activar la verificación en dos pasos.' });
  }
});

// POST /api/auth/2fa/desactivar { contrasena, codigo } — exige contraseña Y
// código vigente, para que quien use una sesión abierta ajena no pueda apagarla.
router.post('/2fa/desactivar', verificarToken, limitador2fa, async (req, res) => {
  const { contrasena, codigo } = req.body;
  try {
    const fila = await pool.query('SELECT contrasena_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    const seg = await leerSeguridad(req.usuario.id);
    if (!seg.totp_activo) {
      return res.status(400).json({ error: 'La verificación en dos pasos no está activada.' });
    }
    if (typeof contrasena !== 'string' || !(await bcrypt.compare(contrasena, fila.rows[0].contrasena_hash))) {
      return res.status(401).json({ error: 'La contraseña no es correcta.' });
    }
    if (!verificarCodigo(seg.totp_secreto, String(codigo ?? ''))) {
      return res.status(401).json({ error: 'El código no es correcto.' });
    }
    await pool.query('UPDATE usuarios SET totp_activo = FALSE, totp_secreto = NULL WHERE id = $1', [req.usuario.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al desactivar la verificación en dos pasos.' });
  }
});

module.exports = router;
