// =============================================================================
// utils/fecha.js — "EL DÍA" DEL NEGOCIO (zona horaria de Durango)
// =============================================================================
// PROBLEMA QUE RESUELVE
// Neon guarda todas las horas en UTC. El negocio opera de 2:00 pm a 9:30 pm
// hora local, es decir de 20:00 a 03:30 UTC (cruza la medianoche UTC). Si se
// agrupara por fecha UTC, cada jornada se partiría en dos días y un corte de
// caja hecho al cierre quedaría fechado al día siguiente.
//
// REGLA
// Todo lo que dependa de "el día" (resumen de caja, corte, ventas de hoy) debe
// pasar por este archivo, nunca usar `fecha::date` directamente en SQL.
//
// USADO POR: routes/ventas.js, routes/caja.js y routes/asistencias.js.
// =============================================================================

// El negocio (Durango) opera de 2:00 pm a 9:30 pm hora local, que en UTC es
// de 20:00 a 03:30 del día siguiente. Neon guarda las horas en UTC, así que
// agrupar por fecha UTC partiría cada jornada en dos y fecharía un corte de
// cierre al día siguiente. Todo lo que dependa de "el día" del negocio debe
// pasar por aquí.
const ZONA_NEGOCIO = 'America/Mexico_City';

// Fecha de hoy (YYYY-MM-DD) en la zona del negocio.
// El formato 'en-CA' (inglés de Canadá) produce justo AAAA-MM-DD.
function fechaHoyNegocio() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_NEGOCIO });
}

// Expresión SQL que convierte una columna `timestamp` (guardada en UTC) al
// día calendario del negocio. `columna` siempre es un literal del código,
// nunca entrada del usuario.
// Ejemplo de uso: WHERE ${diaNegocioSql('v.fecha')} = $1
// (primero se declara que el timestamp está en UTC y luego se convierte a la
// zona del negocio antes de quedarse solo con la fecha).
function diaNegocioSql(columna) {
  return `((${columna} AT TIME ZONE 'UTC') AT TIME ZONE '${ZONA_NEGOCIO}')::date`;
}

// Expresión SQL que da la HORA actual (sin fecha) en la zona del negocio.
// Para columnas TIME (ej. asistencias.hora_entrada/hora_salida), que no
// guardan zona horaria — hay que convertir el reloj de Neon (UTC) antes de
// quedarse solo con la hora, igual que diaNegocioSql hace con la fecha.
function horaAhoraNegocioSql() {
  return `(NOW() AT TIME ZONE '${ZONA_NEGOCIO}')::time`;
}

// Hora actual (HH:MM) en la zona del negocio — para comparar contra las
// ventanas de autoservicio de abajo. 'en-GB' con hour12:false da 24 horas.
function horaActualNegocio() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: ZONA_NEGOCIO,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Ventanas de horario para el AUTOSERVICIO de asistencia (marcar la propia
// entrada/salida por login/logout o por el botón del menú principal —
// NUNCA para lo que registra un administrador/encargado a mano, que no
// tiene esta restricción porque ya tiene autoridad para eso). Es el
// guardrail simple contra marcar una llegada antes de que el negocio abra:
// el negocio opera de 14:00 a 21:30 (ver nota de horario arriba). Ajustar
// aquí si el horario real del negocio cambia.
const VENTANA_ENTRADA = { desde: '13:00', hasta: '21:30' }; // 1h antes de abrir, hasta el cierre
const VENTANA_SALIDA = { desde: '14:00', hasta: '23:00' }; // desde que abre, hasta 1.5h después del cierre

// true si la hora actual del negocio cae dentro de la ventana de ese tipo.
// Comparación de texto "HH:MM" funciona igual que numérica para horas válidas.
function dentroDeVentanaAsistencia(tipo) {
  const ventana = tipo === 'entrada' ? VENTANA_ENTRADA : VENTANA_SALIDA;
  const ahora = horaActualNegocio();
  return ahora >= ventana.desde && ahora <= ventana.hasta;
}

// true si `texto` es una fecha real en formato YYYY-MM-DD (rechaza 2026-13-45).
// Se usa para validar cualquier fecha que llegue por query string o body
// antes de mandarla a la base de datos.
function fechaValida(texto) {
  // 1) Debe ser texto con la forma exacta AAAA-MM-DD.
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return false;
  }
  // 2) Debe existir en el calendario: se construye la fecha y se comprueba que
  //    al volver a escribirla dé el mismo texto (2026-02-31 se corregiría a
  //    2026-03-03 y por eso se rechaza).
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

module.exports = {
  fechaHoyNegocio,
  diaNegocioSql,
  horaAhoraNegocioSql,
  fechaValida,
  dentroDeVentanaAsistencia,
  VENTANA_ENTRADA,
  VENTANA_SALIDA,
};
