// =============================================================================
// utils/validar.js — VALIDACIONES COMPARTIDAS DE ENTRADA
// =============================================================================
// Lo que llega por body/query nunca se asume bien formado: estas funciones
// dan un 400 claro en vez de dejar que la base rechace el dato con un 500.
// =============================================================================

// "HH:MM" o "HH:MM:SS", 00:00 a 23:59.
function horaValida(texto) {
  return typeof texto === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(texto);
}

// Entero positivo (acepta "12" o 12). Sirve para ids que llegan en el body.
function enteroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 && n < 2147483647;
}

// Contraseñas que se usan primero en cualquier ataque de diccionario.
const CONTRASENAS_COMUNES = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'contrasena',
  'contrasena1',
  'chucherias',
  'chucherias1',
  'chucherias123',
  'chucheriasmix',
  'qwerty123',
  'abc12345',
  'admin123',
  '11111111',
  '00000000',
]);

// Devuelve un mensaje de error, o null si la contraseña es aceptable:
// mínimo 8 caracteres, con al menos una letra y un número, y fuera de la
// lista de contraseñas comunes ni igual al usuario.
function errorContrasena(contrasena, usuario) {
  if (typeof contrasena !== 'string' || contrasena.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (contrasena.length > 72) {
    return 'La contraseña no puede pasar de 72 caracteres.';
  }
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(contrasena) || !/\d/.test(contrasena)) {
    return 'La contraseña debe llevar al menos una letra y un número.';
  }
  if (
    CONTRASENAS_COMUNES.has(contrasena.toLowerCase()) ||
    (usuario && contrasena.toLowerCase() === String(usuario).toLowerCase())
  ) {
    return 'Esa contraseña es demasiado fácil de adivinar. Elige otra.';
  }
  return null;
}

module.exports = { horaValida, enteroPositivo, errorContrasena };
