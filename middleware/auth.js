// =============================================================================
// middleware/auth.js — AUTENTICACIÓN Y AUTORIZACIÓN POR ROL
// =============================================================================
// Un "middleware" de Express es una función que se ejecuta ANTES del código de
// la ruta y decide si la petición continúa (next()) o se corta con un error.
//
// Aquí viven las dos barreras de seguridad del backend:
//   1. verificarToken  → ¿quién eres? Exige un JWT válido (401 si no).
//   2. requiereRol(..) → ¿puedes hacer esto? Exige un rol permitido (403 si no).
//
// Se usan siempre en ese orden. Ejemplo típico en un archivo de rutas:
//   router.use(verificarToken);                       // todas las rutas: sesión
//   router.get('/', requiereRol('administrador'), …)  // esta ruta: solo admin
//
// IMPORTANTE: esta es la protección REAL del sistema. Los permisos que el
// frontend aplica (menús ocultos, rolGuard) mejoran la experiencia, pero solo
// estas funciones impiden de verdad que alguien llame a la API directamente.
// =============================================================================
const jwt = require('jsonwebtoken');
const pool = require('../db');

// Verifica que la petición traiga un token válido en el header:
// Authorization: Bearer <token>
// Un JWT dura 8 h, pero la cuenta puede desactivarse, borrarse o cambiar de rol
// en ese lapso. Sin revisar la base, un token viejo seguiría dando acceso (y
// con el rol anterior). Se consulta el estado actual de la cuenta y se guarda
// 30 s en memoria para no pegarle a la base en cada petición.
const TTL_CUENTA_MS = 30 * 1000;
const cacheCuentas = new Map();

async function estadoDeCuenta(id) {
  const ahora = Date.now();
  const guardado = cacheCuentas.get(id);
  if (guardado && ahora - guardado.ts < TTL_CUENTA_MS) {
    return guardado.cuenta;
  }
  const resultado = await pool.query(
    'SELECT u.activo, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1',
    [id],
  );
  const cuenta = resultado.rows[0] || null;
  cacheCuentas.set(id, { cuenta, ts: ahora });
  return cuenta;
}

async function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No se proporcionó un token de autenticación.' });
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }

  try {
    const cuenta = await estadoDeCuenta(payload.id);
    if (!cuenta || !cuenta.activo) {
      return res.status(401).json({ error: 'La cuenta ya no está activa. Inicia sesión de nuevo.' });
    }
    // El rol vigente en la base manda sobre el que traía el token.
    req.usuario = { ...payload, rol: cuenta.rol };
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al verificar la sesión.' });
  }
}

function requiereRol(...rolesPermitidos) {
  // Devuelve el middleware ya "configurado" con la lista de roles permitidos.
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado.' });
    }
    // 403 = estás autenticado, pero tu rol no tiene permiso para esto.
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
    }
    next();
  };
}

// Para que una desactivación o un cambio de rol surta efecto de inmediato en
// este mismo proceso, sin esperar a que caduque el caché de 30 s.
function invalidarCuenta(id) {
  cacheCuentas.delete(Number(id));
}

module.exports = { verificarToken, requiereRol, invalidarCuenta };
