// =============================================================================
// utils/asistenciaAutomatica.js — AUTOSERVICIO DE ASISTENCIA (Sprint 3)
// =============================================================================
// Lo comparten routes/auth.js (entrada al iniciar sesión, salida al cerrar
// sesión) y routes/asistencias.js (POST /mi-entrada, PATCH /mi-salida — el
// botón del menú principal para cuando el personal no inicia/cierra sesión
// por turno, ej. un dispositivo de mostrador que se queda logueado todo el
// día). Ambos casos son "autoservicio": el propio empleado se marca su
// asistencia, a diferencia de lo que ya existía (routes/asistencias.js,
// POST /entrada y PATCH /:id/salida), que es SIEMPRE administrador/
// encargado marcando a OTRO empleado y nunca tiene esta restricción de
// horario — ya tiene autoridad para registrar lo que haga falta.
//
// Cada función devuelve `{ ok: true }` o `{ ok: false, motivo }` en vez de
// lanzar un error: quien llama decide qué hacer con eso (el login/logout lo
// ignora en silencio — nunca debe bloquear la sesión — mientras que el botón
// del menú sí le muestra un mensaje claro al empleado).
// =============================================================================
const {
  fechaHoyNegocio,
  horaAhoraNegocioSql,
  dentroDeVentanaAsistencia,
} = require('./fecha');

// Empleado ACTIVO ligado a esta cuenta, o null si no hay ninguno (cuenta sin
// ligar todavía, o administrador, que nunca tiene un empleado ligado).
async function empleadoLigado(pool, usuarioId) {
  const resultado = await pool.query(
    'SELECT id FROM empleados WHERE usuario_id = $1 AND activo = TRUE',
    [usuarioId]
  );
  return resultado.rows[0]?.id ?? null;
}

// Intenta marcar la entrada de HOY del empleado ligado a `usuarioId`.
// motivo posibles: 'sin_empleado' | 'fuera_de_horario' | 'ya_abierta'.
async function intentarRegistrarEntrada(pool, usuarioId) {
  const empleadoId = await empleadoLigado(pool, usuarioId);
  if (!empleadoId) {
    return { ok: false, motivo: 'sin_empleado' };
  }
  if (!dentroDeVentanaAsistencia('entrada')) {
    return { ok: false, motivo: 'fuera_de_horario' };
  }

  const hoy = fechaHoyNegocio();
  // No se permite una segunda entrada ABIERTA el mismo día (ej. se
  // reconectó tras el cierre por inactividad dentro del mismo turno).
  const abierta = await pool.query(
    'SELECT id FROM asistencias WHERE empleado_id = $1 AND fecha = $2::date AND hora_salida IS NULL',
    [empleadoId, hoy]
  );
  if (abierta.rows.length > 0) {
    return { ok: false, motivo: 'ya_abierta' };
  }

  await pool.query(
    `INSERT INTO asistencias (empleado_id, fecha, hora_entrada, registrado_por, observaciones)
     VALUES ($1, $2::date, ${horaAhoraNegocioSql()}, $3, $4)`,
    [empleadoId, hoy, usuarioId, 'Entrada automática (inicio de sesión)']
  );
  return { ok: true };
}

// Intenta marcar la salida de HOY del empleado ligado a `usuarioId`.
// motivo posibles: 'sin_empleado' | 'fuera_de_horario' | 'sin_entrada_abierta'.
async function intentarRegistrarSalida(pool, usuarioId) {
  const empleadoId = await empleadoLigado(pool, usuarioId);
  if (!empleadoId) {
    return { ok: false, motivo: 'sin_empleado' };
  }
  if (!dentroDeVentanaAsistencia('salida')) {
    return { ok: false, motivo: 'fuera_de_horario' };
  }

  const resultado = await pool.query(
    `UPDATE asistencias SET hora_salida = ${horaAhoraNegocioSql()}
     WHERE empleado_id = $1 AND fecha = $2::date AND hora_salida IS NULL
     RETURNING id`,
    [empleadoId, fechaHoyNegocio()]
  );
  if (resultado.rows.length === 0) {
    return { ok: false, motivo: 'sin_entrada_abierta' };
  }
  return { ok: true };
}

module.exports = { empleadoLigado, intentarRegistrarEntrada, intentarRegistrarSalida };
