// El negocio (Durango) opera de 2:00 pm a 9:30 pm hora local, que en UTC es
// de 20:00 a 03:30 del día siguiente. Neon guarda las horas en UTC, así que
// agrupar por fecha UTC partiría cada jornada en dos y fecharía un corte de
// cierre al día siguiente. Todo lo que dependa de "el día" del negocio debe
// pasar por aquí.
const ZONA_NEGOCIO = 'America/Mexico_City';

// Fecha de hoy (YYYY-MM-DD) en la zona del negocio.
function fechaHoyNegocio() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_NEGOCIO });
}

// Expresión SQL que convierte una columna `timestamp` (guardada en UTC) al
// día calendario del negocio. `columna` siempre es un literal del código,
// nunca entrada del usuario.
function diaNegocioSql(columna) {
  return `((${columna} AT TIME ZONE 'UTC') AT TIME ZONE '${ZONA_NEGOCIO}')::date`;
}

// true si `texto` es una fecha real en formato YYYY-MM-DD (rechaza 2026-13-45).
function fechaValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return false;
  }
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

module.exports = { fechaHoyNegocio, diaNegocioSql, fechaValida };
