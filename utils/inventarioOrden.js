// =============================================================================
// utils/inventarioOrden.js — INSUMOS DE UNA ORDEN (receta expandida)
// =============================================================================
// Un solo lugar para calcular "qué insumos, y cuánto de cada uno, lleva esta
// orden según su receta" — lo usan DOS flujos que antes duplicaban esta
// lógica por separado:
//   - routes/ordenes.js  → al pasar a 'preparando', para la SALIDA (descuento).
//   - routes/ventas.js   → al cancelar una venta ya descontada, para la
//                          ENTRADA de reversión (RF-11: restituir inventario).
//
// Es la receta fija (receta_insumos) de cada producto × la cantidad vendida,
// menos lo marcado "quitado" y más lo "elegido" (orden_detalle_insumos —
// Fase 2 del recetario). Un producto sin receta cargada todavía simplemente
// no aporta insumos (no es un error).
//
// `calcularInsumosDeOrden` calcula sobre TODAS las líneas activas de una
// orden; `calcularInsumosDeLineas` sobre un subconjunto explícito — lo usa
// la cancelación PARCIAL (cancelar solo algunos productos de una venta).
//
// Recalcular en vez de guardar una copia es a propósito: orden_detalle y
// orden_detalle_insumos no cambian después de registrada la venta, así que
// el resultado es el mismo sin importar cuándo se consulte — y así la
// restitución siempre refleja EXACTAMENTE lo que se descontó, sin arrastrar
// una copia que pudiera desincronizarse.
// =============================================================================

// Devuelve [{ insumo_id, cantidad }] de TODAS las líneas activas (no
// canceladas) de una orden — lo usa el descuento al pasar a 'preparando'.
async function calcularInsumosDeOrden(client, ordenId) {
  const lineas = await client.query(
    `SELECT id FROM orden_detalle WHERE orden_id = $1 AND cancelado = FALSE`,
    [ordenId]
  );
  return calcularInsumosDeLineas(client, lineas.rows.map((r) => r.id));
}

// Igual que calcularInsumosDeOrden, pero para un subconjunto EXPLÍCITO de
// renglones (orden_detalle.id) — lo usa la cancelación PARCIAL (RF-11 +
// selección rescate/merma): al cancelar solo algunos productos de una
// venta, aquí se calculan los insumos de SOLO esos productos, no de toda
// la orden.
// Devuelve [{ insumo_id, cantidad }], ya sumado por insumo (una receta puede
// repetir el mismo insumo en más de una línea si varios productos de la
// orden lo comparten).
async function calcularInsumosDeLineas(client, ordenDetalleIds) {
  if (ordenDetalleIds.length === 0) {
    return [];
  }

  const lineas = await client.query(
    `SELECT od.id, od.variante_id, od.cantidad FROM orden_detalle od WHERE od.id = ANY($1::int[])`,
    [ordenDetalleIds]
  );

  const acumulado = new Map(); // insumo_id -> cantidad total

  const sumar = (insumoId, cantidad) => {
    acumulado.set(insumoId, (acumulado.get(insumoId) ?? 0) + cantidad);
  };

  for (const linea of lineas.rows) {
    const receta = await client.query('SELECT id FROM recetas WHERE variante_id = $1', [linea.variante_id]);
    if (receta.rows.length === 0) {
      continue; // Producto todavía sin receta (Fase 2 pendiente) — no aporta insumos.
    }
    const recetaId = receta.rows[0].id;

    const quitados = await client.query(
      `SELECT insumo_id FROM orden_detalle_insumos WHERE orden_detalle_id = $1 AND tipo = 'quitado'`,
      [linea.id]
    );
    const idsQuitados = new Set(quitados.rows.map((r) => r.insumo_id));

    // Ingredientes fijos de la receta, salvo los que se quitaron en esta línea.
    const insumosReceta = await client.query(
      'SELECT insumo_id, cantidad FROM receta_insumos WHERE receta_id = $1',
      [recetaId]
    );
    for (const ri of insumosReceta.rows) {
      if (idsQuitados.has(ri.insumo_id)) {
        continue;
      }
      sumar(ri.insumo_id, Number(ri.cantidad) * linea.cantidad);
    }

    // Ingredientes "elegidos" (salsa/topping) — los llena el selector de
    // elección del POS (pos/producto-elecciones.ts).
    const elegidos = await client.query(
      `SELECT insumo_id, cantidad FROM orden_detalle_insumos WHERE orden_detalle_id = $1 AND tipo = 'elegido'`,
      [linea.id]
    );
    for (const el of elegidos.rows) {
      sumar(el.insumo_id, Number(el.cantidad) * linea.cantidad);
    }
  }

  return [...acumulado.entries()].map(([insumo_id, cantidad]) => ({ insumo_id, cantidad }));
}

// Inserta un movimiento en movimientos_inventario por cada insumo calculado.
async function registrarMovimientosInventario(client, insumos, { tipo, responsableId, motivo, ordenId }) {
  for (const { insumo_id, cantidad } of insumos) {
    await client.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, responsable_id, motivo, orden_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [insumo_id, tipo, cantidad, responsableId, motivo, ordenId]
    );
  }
}

module.exports = { calcularInsumosDeOrden, calcularInsumosDeLineas, registrarMovimientosInventario };
