// =============================================================================
// routes/ventas.js — REGISTRO, CONSULTA Y CANCELACIÓN DE VENTAS
// =============================================================================
// Endpoints (prefijo /api/ventas), todos exigen sesión:
//   POST  /                → registrar una venta (administrador, encargado, cajero)
//   GET   /?fecha=…        → ventas de un día del negocio      (administrador, encargado)
//   PATCH /:id/cancelar    → cancelar una venta (RF-03)        (administrador, encargado)
//
// CONCEPTOS CLAVE
//   Una venta se guarda en TRES tablas que siempre se escriben juntas:
//     ordenes        → el pedido (número, tipo de entrega, estado de la comanda)
//     orden_detalle  → cada producto del pedido, con su precio congelado
//     ventas         → el cobro (subtotal, total, método de pago, cajero)
//   Por eso registrar una venta es una TRANSACCIÓN: o se guardan las tres, o
//   no se guarda ninguna (ROLLBACK).
//
//   REGLA DE ORO: el precio NUNCA viene del cliente. El frontend solo manda
//   qué variante se vendió y cuántas; el precio se lee de variantes_producto
//   en el servidor. Así nadie puede alterar un precio desde el navegador.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaHoyNegocio, diaNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);

// Genera un número de orden único y legible: ORD-<fecha>-<sufijo aleatorio>
// Ejemplo: ORD-20260926-4821. (Pendiente menor: la fecha usa UTC, así que
// después de las 6:00 pm locales puede llevar la fecha del día siguiente;
// no afecta la lógica de ventas ni de caja.)
function generarNumeroOrden() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sufijo = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${fecha}-${sufijo}`;
}

// POST /api/ventas
// Registra una venta del punto de venta en una sola transacción:
// orden + orden_detalle + venta. Los precios NUNCA se toman del cliente,
// siempre se leen de variantes_producto en el servidor.
//
// Cuerpo esperado:
//   { metodo_pago: 'efectivo'|'transferencia',
//     tipo_entrega?: 'presencial'|'domicilio',            (por defecto presencial)
//     items: [{ variante_id, cantidad, notas? }],
//     cliente_id? }                                       (reservado para lealtad)
// Respuesta 201: { orden, venta }.
router.post('/', requiereRol('administrador', 'encargado', 'cajero'), async (req, res) => {
  const { items, metodo_pago, cliente_id } = req.body;
  const tipo_entrega = req.body.tipo_entrega || 'presencial';

  // ---- Validaciones de entrada (antes de tocar la base de datos) ----------
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe incluir al menos un producto.' });
  }
  if (!['efectivo', 'transferencia'].includes(metodo_pago)) {
    return res.status(400).json({ error: 'El método de pago debe ser efectivo o transferencia.' });
  }
  if (!['presencial', 'domicilio'].includes(tipo_entrega)) {
    return res.status(400).json({ error: 'El tipo de entrega debe ser presencial o domicilio.' });
  }

  const varianteIds = items.map((item) => item.variante_id);
  if (varianteIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'Hay un producto inválido en el carrito.' });
  }

  // Se toma UNA conexión exclusiva del pool: una transacción solo funciona si
  // todas sus consultas viajan por la misma conexión.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ---- 1) Precios reales, leídos del servidor ---------------------------
    const variantesResultado = await client.query(
      `SELECT id, precio FROM variantes_producto WHERE id = ANY($1::int[])`,
      [varianteIds]
    );

    // Diccionario { variante_id: precio } para consultar cada precio rápido.
    const precioPorVariante = {};
    for (const fila of variantesResultado.rows) {
      precioPorVariante[fila.id] = Number(fila.precio);
    }

    // Si alguna variante enviada no existe, se aborta la venta completa.
    for (const varianteId of varianteIds) {
      if (precioPorVariante[varianteId] === undefined) {
        throw { status: 400, mensaje: `El producto con variante ${varianteId} no existe.` };
      }
    }

    // ---- 2) La orden (la comanda que verá la cocina) ----------------------
    // Nace en 'sin_preparar' (Sprint 2): aparece de inmediato en el tablero
    // de comandas. `creado_por` guarda quién la registró (viene del token).
    const orden = await client.query(
      `INSERT INTO ordenes (numero_orden, cliente_id, tipo_entrega, estado, creado_por)
       VALUES ($1, $2, $3, 'sin_preparar', $4)
       RETURNING *`,
      [generarNumeroOrden(), cliente_id || null, tipo_entrega, req.usuario.id]
    );

    // ---- 3) Detalle de la orden + cálculo del subtotal --------------------
    let subtotal = 0;
    for (const item of items) {
      // Cantidad inválida o cero se corrige a 1.
      const cantidad = Number(item.cantidad) > 0 ? Number(item.cantidad) : 1;
      const precioUnitario = precioPorVariante[item.variante_id];
      subtotal += precioUnitario * cantidad;

      // El precio se guarda en el renglón ("congelado"): si el menú cambia de
      // precio mañana, esta venta conserva lo que realmente se cobró.
      // `notas` trae la personalización ("Sin: tocino · sin picante").
      await client.query(
        `INSERT INTO orden_detalle (orden_id, variante_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)`,
        [orden.rows[0].id, item.variante_id, cantidad, precioUnitario, item.notas || null]
      );
    }

    // ---- 4) El cobro -------------------------------------------------------
    // El descuento por lealtad todavía no está implementado (pendiente de construir).
    const descuentoLealtad = 0;
    const total = subtotal - descuentoLealtad;

    const venta = await client.query(
      `INSERT INTO ventas (orden_id, subtotal, descuento_lealtad, total, metodo_pago, cajero_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orden.rows[0].id, subtotal, descuentoLealtad, total, metodo_pago, req.usuario.id]
    );

    // Todo salió bien: se confirman las tres escrituras a la vez.
    await client.query('COMMIT');

    res.status(201).json({
      orden: orden.rows[0],
      venta: venta.rows[0],
    });
  } catch (error) {
    // Cualquier fallo deshace TODO lo escrito arriba: nunca queda una orden
    // sin venta ni un detalle a medias.
    await client.query('ROLLBACK');
    // Los errores "esperados" (validaciones) se lanzan como { status, mensaje }.
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la venta.' });
  } finally {
    // Siempre se devuelve la conexión al pool, haya éxito o error.
    client.release();
  }
});

// GET /api/ventas?fecha=YYYY-MM-DD
// Lista las ventas del día (o de la fecha indicada) con sus productos,
// más recientes primero. Es información financiera: solo administrador y
// encargado (RNF-03), igual que /api/caja/cortes.
// "Del día" significa el día del negocio en hora de Durango (utils/fecha.js).
router.get('/', requiereRol('administrador', 'encargado'), async (req, res) => {
  const fecha = req.query.fecha || fechaHoyNegocio();

  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }

  try {
    // Consulta 1: las ventas del día con datos de su orden, el cajero y —si
    // fue cancelada— quién la canceló (LEFT JOIN: solo existe en canceladas).
    const ventas = await pool.query(
      `SELECT v.*, o.id AS orden_id, o.numero_orden, o.tipo_entrega, u.nombre AS cajero,
              uc.nombre AS cancelado_por_nombre
       FROM ventas v
       JOIN ordenes o ON o.id = v.orden_id
       JOIN usuarios u ON u.id = v.cajero_id
       LEFT JOIN usuarios uc ON uc.id = v.cancelado_por
       WHERE ${diaNegocioSql('v.fecha')} = $1
       ORDER BY v.fecha DESC`,
      [fecha]
    );

    if (ventas.rows.length === 0) {
      return res.json([]);
    }

    // Consulta 2: los productos de TODAS esas ventas en una sola consulta
    // (en vez de una por venta) para que la pantalla cargue rápido.
    const ordenIds = ventas.rows.map((v) => v.orden_id);
    const detalle = await pool.query(
      `SELECT od.orden_id, od.cantidad, od.notas, vp.nombre AS variante_nombre, p.nombre AS producto_nombre
       FROM orden_detalle od
       JOIN variantes_producto vp ON vp.id = od.variante_id
       JOIN productos p ON p.id = vp.producto_id
       WHERE od.orden_id = ANY($1::int[])`,
      [ordenIds]
    );

    // Se agrupan los renglones por orden: { orden_id: [item, item, …] }.
    const detallePorOrden = {};
    for (const fila of detalle.rows) {
      if (!detallePorOrden[fila.orden_id]) {
        detallePorOrden[fila.orden_id] = [];
      }
      detallePorOrden[fila.orden_id].push({
        producto: fila.producto_nombre,
        variante: fila.variante_nombre,
        cantidad: fila.cantidad,
        notas: fila.notas,
      });
    }

    // Cada venta sale con su arreglo `items` ya incluido.
    const resultado = ventas.rows.map((venta) => ({
      ...venta,
      items: detallePorOrden[venta.orden_id] || [],
    }));

    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las ventas.' });
  }
});

// PATCH /api/ventas/:id/cancelar
// Solo administrador o encargado pueden cancelar una venta (RF-03).
// Deja registro de QUIÉN canceló (cancelado_por), CUÁNDO (fecha_cancelacion) y
// el motivo (opcional). Una venta cancelada deja de contar en el corte de caja
// y su comanda pasa a 'cancelada' (desaparece del tablero de cocina).
// La venta y su orden se actualizan en una transacción para que nunca queden
// en estados contradictorios.
router.patch('/:id/cancelar', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // `AND estado = 'completada'` impide cancelar dos veces la misma venta:
    // si ya estaba cancelada, el UPDATE no encuentra fila y se responde 404.
    const venta = await client.query(
      `UPDATE ventas
       SET estado = 'cancelada', cancelado_por = $1, motivo_cancelacion = $2, fecha_cancelacion = NOW()
       WHERE id = $3 AND estado = 'completada'
       RETURNING *`,
      [req.usuario.id, motivo || null, id]
    );

    if (venta.rows.length === 0) {
      throw { status: 404, mensaje: 'La venta no existe o ya fue cancelada.' };
    }

    // La comanda asociada también se cancela (sale del tablero de cocina).
    await client.query(`UPDATE ordenes SET estado = 'cancelada' WHERE id = $1`, [
      venta.rows[0].orden_id,
    ]);

    await client.query('COMMIT');
    res.json(venta.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al cancelar la venta.' });
  } finally {
    client.release();
  }
});

module.exports = router;
