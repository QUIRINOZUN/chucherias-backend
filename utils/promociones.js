// =============================================================================
// utils/promociones.js — PROMOCIONES VIGENTES Y PRECIO CON PROMOCIÓN (2026-11-16)
// =============================================================================
// La promoción vigente se convierte en el PRECIO de la variante: el POS la
// muestra y el servidor la vuelve a calcular al cobrar (nunca se confía en un
// precio del cliente). Si varias promociones aplican a una misma variante, gana
// la que más descuenta (no se acumulan). Todo en hora de Durango.
// Si la tabla `promociones` todavía no existe (migración sin correr), no hay
// promociones y todo sigue exactamente como antes.
// =============================================================================
const { ZONA_NEGOCIO } = require('./fecha');
const { tieneTabla } = require('./esquema');

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { dia: 0-6, fecha: 'AAAA-MM-DD', minutos: minutos desde medianoche } en la zona del negocio.
function ahoraNegocio(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(fecha);
  const g = (tipo) => partes.find((p) => p.type === tipo).value;
  return {
    dia: DIAS[g('weekday')],
    fecha: `${g('year')}-${g('month')}-${g('day')}`,
    minutos: Number(g('hour')) * 60 + Number(g('minute')),
  };
}

function minutosDeTiempo(texto) {
  const [h, m] = String(texto).split(':').map(Number);
  return h * 60 + m;
}

// ¿Está vigente esta promoción en este momento? (función pura, probada aparte)
function estaVigente(promo, ahora) {
  if (!promo.activo) return false;
  if (promo.fecha_inicio && ahora.fecha < promo.fecha_inicio) return false;
  if (promo.fecha_fin && ahora.fecha > promo.fecha_fin) return false;
  if (promo.dias_semana && promo.dias_semana.length > 0 && !promo.dias_semana.includes(ahora.dia)) return false;
  if (promo.hora_inicio && promo.hora_fin) {
    if (ahora.minutos < minutosDeTiempo(promo.hora_inicio) || ahora.minutos >= minutosDeTiempo(promo.hora_fin)) {
      return false;
    }
  }
  return true;
}

const COLUMNAS = `id, nombre, tipo, valor::float8 AS valor, alcance, alcance_id, dias_semana, hora_inicio, hora_fin,
  to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin, activo`;

// Promociones activas Y vigentes ahora. `ejecutor` es el pool o un client de transacción.
async function promocionesVigentes(ejecutor, ahora = ahoraNegocio()) {
  if (!(await tieneTabla('promociones'))) return [];
  const r = await ejecutor.query(`SELECT ${COLUMNAS} FROM promociones WHERE activo = TRUE`);
  return r.rows.filter((p) => estaVigente(p, ahora));
}

function coincideAlcance(promo, ctx) {
  switch (promo.alcance) {
    case 'todo':
      return true;
    case 'categoria':
      return promo.alcance_id === ctx.categoriaId;
    case 'producto':
      return promo.alcance_id === ctx.productoId;
    case 'variante':
      return promo.alcance_id === ctx.varianteId;
    default:
      return false;
  }
}

// Precio de UNA unidad tras aplicar la mejor promoción que le corresponda.
// ctx = { varianteId, productoId, categoriaId }. Devuelve { precio, descuento, promocion }.
function precioConPromocion(precioLista, ctx, promos) {
  let mejor = null;
  let mejorDescuento = 0;
  for (const p of promos) {
    if (!coincideAlcance(p, ctx)) continue;
    const bruto = p.tipo === 'porcentaje' ? (precioLista * p.valor) / 100 : p.valor;
    const descuento = Math.min(Math.round(bruto * 100) / 100, precioLista);
    if (descuento > mejorDescuento) {
      mejorDescuento = descuento;
      mejor = p;
    }
  }
  return {
    precio: Math.round((precioLista - mejorDescuento) * 100) / 100,
    descuento: mejorDescuento,
    promocion: mejor ? mejor.nombre : null,
  };
}

module.exports = { ahoraNegocio, estaVigente, promocionesVigentes, precioConPromocion, COLUMNAS };
