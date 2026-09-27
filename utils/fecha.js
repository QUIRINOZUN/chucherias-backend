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
// USADO POR: routes/ventas.js y routes/caja.js.
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

module.exports = { fechaHoyNegocio, diaNegocioSql, fechaValida };
