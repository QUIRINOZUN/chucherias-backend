const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);

// Genera un número de orden único y legible: ORD-<fecha>-<sufijo aleatorio>
function generarNumeroOrden() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sufijo = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${fecha}-${sufijo}`;
}

// POST /api/ventas
// Registra una venta del punto de venta en una sola transacción:
// orden + orden_detalle + venta. Los precios NUNCA se toman del cliente,
// siempre se leen de variantes_producto en el servidor.
router.post('/', async (req, res) => {
  const { items, metodo_pago, cliente_id } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe incluir al menos un producto.' });
  }
  if (!['efectivo', 'transferencia'].includes(metodo_pago)) {
    return res.status(400).json({ error: 'El método de pago debe ser efectivo o transferencia.' });
  }

  const varianteIds = items.map((item) => item.variante_id);
  if (varianteIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'Hay un producto inválido en el carrito.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const variantesResultado = await client.query(
      `SELECT id, precio FROM variantes_producto WHERE id = ANY($1::int[])`,
      [varianteIds]
    );

    const precioPorVariante = {};
    for (const fila of variantesResultado.rows) {
      precioPorVariante[fila.id] = Number(fila.precio);
    }

    for (const varianteId of varianteIds) {
      if (precioPorVariante[varianteId] === undefined) {
        throw { status: 400, mensaje: `El producto con variante ${varianteId} no existe.` };
      }
    }

    const orden = await client.query(
      `INSERT INTO ordenes (numero_orden, cliente_id, tipo_entrega, estado, creado_por)
       VALUES ($1, $2, 'presencial', 'entregado', $3)
       RETURNING *`,
      [generarNumeroOrden(), cliente_id || null, req.usuario.id]
    );

    let subtotal = 0;
    for (const item of items) {
      const cantidad = Number(item.cantidad) > 0 ? Number(item.cantidad) : 1;
      const precioUnitario = precioPorVariante[item.variante_id];
      subtotal += precioUnitario * cantidad;

      await client.query(
        `INSERT INTO orden_detalle (orden_id, variante_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)`,
        [orden.rows[0].id, item.variante_id, cantidad, precioUnitario, item.notas || null]
      );
    }

    // El descuento por lealtad todavía no está implementado (pendiente de construir).
    const descuentoLealtad = 0;
    const total = subtotal - descuentoLealtad;

    const venta = await client.query(
      `INSERT INTO ventas (orden_id, subtotal, descuento_lealtad, total, metodo_pago, cajero_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orden.rows[0].id, subtotal, descuentoLealtad, total, metodo_pago, req.usuario.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      orden: orden.rows[0],
      venta: venta.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la venta.' });
  } finally {
    client.release();
  }
});

// GET /api/ventas?fecha=YYYY-MM-DD
// Lista las ventas del día (o de la fecha indicada), más recientes primero.
router.get('/', async (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

  try {
    const resultado = await pool.query(
      `SELECT v.*, o.numero_orden, u.nombre AS cajero
       FROM ventas v
       JOIN ordenes o ON o.id = v.orden_id
       JOIN usuarios u ON u.id = v.cajero_id
       WHERE v.fecha::date = $1
       ORDER BY v.fecha DESC`,
      [fecha]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las ventas.' });
  }
});

// PATCH /api/ventas/:id/cancelar
// Solo administrador o encargado pueden cancelar una venta (RF-03).
router.patch('/:id/cancelar', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const venta = await client.query(
      `UPDATE ventas
       SET estado = 'cancelada', cancelado_por = $1, motivo_cancelacion = $2
       WHERE id = $3 AND estado = 'completada'
       RETURNING *`,
      [req.usuario.id, motivo || null, id]
    );

    if (venta.rows.length === 0) {
      throw { status: 404, mensaje: 'La venta no existe o ya fue cancelada.' };
    }

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
