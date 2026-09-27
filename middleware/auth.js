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

// Verifica que la petición traiga un token válido en el header:
// Authorization: Bearer <token>
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  // Sin header o con un formato distinto a "Bearer <token>": no hay sesión.
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No se proporcionó un token de autenticación.' });
  }

  // "Bearer abc123" → ["Bearer", "abc123"]; nos quedamos con el token.
  const token = authHeader.split(' ')[1];

  try {
    // jwt.verify comprueba la firma (con JWT_SECRET) y la fecha de expiración.
    // Si algo falla lanza una excepción y se responde 401.
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // El payload es lo que se firmó al hacer login. Queda disponible para el
    // resto de la ruta: req.usuario.id, .usuario, .nombre y .rol.
    req.usuario = payload; // { id, usuario, nombre, rol }
    next();
  } catch (error) {
    // El frontend interpreta este 401 como sesión vencida y cierra la sesión.
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

// Restringe una ruta a ciertos roles.
// Uso: requiereRol('administrador', 'encargado')
// Debe ir DESPUÉS de verificarToken, porque lee req.usuario.rol.
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

module.exports = { verificarToken, requiereRol };
