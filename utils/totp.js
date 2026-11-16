// =============================================================================
// utils/totp.js — CÓDIGOS DE UN SOLO USO (TOTP, RFC 6238) SIN DEPENDENCIAS
// =============================================================================
// Compatible con Google Authenticator, Microsoft Authenticator, Authy, etc.
// El secreto se comparte una sola vez (QR o clave escrita) y a partir de ahí
// la app del teléfono y el servidor calculan el mismo código de 6 dígitos
// cada 30 segundos. Se acepta ±1 ventana (30 s) por si los relojes difieren.
// =============================================================================
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32 (RFC 4648)

function generarSecreto(bytes = 20) {
  const aleatorio = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of aleatorio) bits += b.toString(2).padStart(8, '0');
  let secreto = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) secreto += ALFABETO[parseInt(bits.slice(i, i + 5), 2)];
  return secreto;
}

function decodificarBase32(texto) {
  let bits = '';
  for (const c of texto.replace(/=+$/, '').toUpperCase()) {
    const i = ALFABETO.indexOf(c);
    if (i === -1) throw new Error('Secreto inválido');
    bits += i.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codigoPara(secreto, contador) {
  const clave = decodificarBase32(secreto);
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = crypto.createHmac('sha1', clave).update(mensaje).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const numero =
    ((hmac[desplazamiento] & 0x7f) << 24) |
    (hmac[desplazamiento + 1] << 16) |
    (hmac[desplazamiento + 2] << 8) |
    hmac[desplazamiento + 3];
  return String(numero % 1_000_000).padStart(6, '0');
}

// true si `codigo` es el vigente (o el anterior/siguiente) para ese secreto.
function verificarCodigo(secreto, codigo, ahoraMs = Date.now()) {
  if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo.trim())) return false;
  const paso = Math.floor(ahoraMs / 1000 / 30);
  const buscado = Buffer.from(codigo.trim());
  for (const delta of [-1, 0, 1]) {
    const candidato = Buffer.from(codigoPara(secreto, paso + delta));
    if (crypto.timingSafeEqual(candidato, buscado)) return true;
  }
  return false;
}

// URI que leen las apps autenticadoras (el frontend la convierte en QR).
function uriOtpauth(secreto, cuenta, emisor = 'Chucherias Mix') {
  return `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&digits=6&period=30`;
}

module.exports = { generarSecreto, verificarCodigo, uriOtpauth, codigoPara };
