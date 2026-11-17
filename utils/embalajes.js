// =============================================================================
// utils/embalajes.js — EMBALAJES Y DECORACIONES (2026-11-17)
// =============================================================================
// Un embalaje es un insumo más (misma existencia, entradas, mermas y costo) marcado con
// `insumos.embalaje_uso`: 'venta' (para llevar en ventas normales) o 'especial' (embalaje y
// decoración de las ventas especiales, con `embalaje_clase` 'embalaje' o 'decoracion').
// Las ventas guardan cuántos de cada uno se usaron (orden_embalajes / venta_especial_embalajes).
// Todo tolera que la migración 2026-11-17_embalajes.sql aún no se haya corrido.
// =============================================================================
const { tieneColumna } = require('./esquema');

async function embalajesDisponibles() {
  return tieneColumna('insumos', 'embalaje_uso');
}

// Valida y normaliza [{ insumo_id, cantidad }] contra el catálogo. `uso` es 'venta' o
// 'especial'. Suma duplicados. Lanza { status, mensaje } si algo no es válido. Una lista
// vacía o ausente devuelve [].
async function validarEmbalajes(ejecutor, lista, uso) {
  if (lista === undefined || lista === null) return [];
  if (!Array.isArray(lista)) throw { status: 400, mensaje: 'El embalaje debe ser una lista.' };
  if (lista.length === 0) return [];
  if (!(await embalajesDisponibles())) {
    throw { status: 503, mensaje: 'Los embalajes todavía no están habilitados en el servidor.' };
  }
  const acumulado = new Map();
  for (const e of lista) {
    const id = Number(e?.insumo_id);
    const cantidad = Number(e?.cantidad);
    if (!Number.isInteger(id) || !Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 500) {
      throw { status: 400, mensaje: 'Cada embalaje necesita una cantidad entera entre 1 y 500.' };
    }
    acumulado.set(id, (acumulado.get(id) ?? 0) + cantidad);
  }
  const ids = [...acumulado.keys()];
  const r = await ejecutor.query(`SELECT id FROM insumos WHERE id = ANY($1::int[]) AND embalaje_uso = $2`, [ids, uso]);
  if (r.rows.length !== ids.length) {
    throw { status: 400, mensaje: 'Hay un embalaje que no existe o no corresponde a este tipo de venta.' };
  }
  return ids.map((insumo_id) => ({ insumo_id, cantidad: acumulado.get(insumo_id) }));
}

module.exports = { embalajesDisponibles, validarEmbalajes };
