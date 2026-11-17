// =============================================================================
// routes/compras.js — COMPRAS A PROVEEDORES (2026-11-16)
// =============================================================================
// Endpoints (prefijo /api/compras), solo administrador/encargado (información de
// costos y abastecimiento, mismo criterio que routes/insumos.js).
//
//   GET   /sugerencias        → insumos bajo su mínimo, con una cantidad sugerida
//   GET   /precios/:insumoId  → precio por proveedor de un insumo (de insumo_compras)
//   GET   /?estado=           → órdenes de compra (pendiente | recibida | cancelada)
//   GET   /:id                → una orden con sus renglones
//   POST  /                   → crear una orden { proveedor_id?, nota?, items }
//   PATCH /:id/cancelar       → cancelar una orden pendiente
//   POST  /:id/recibir        → registrar la llegada de la mercancía
//
// POR QUÉ SE SEPARA "PEDIR" DE "RECIBIR"
// Pedir no mueve inventario ni costos: solo deja constancia de lo solicitado y
// evita volver a pedir lo mismo ("en pedido"). Al RECIBIR sí se registra, en una
// sola transacción por renglón, lo mismo que una "Entrada" manual de Inventario:
// movimiento de entrada + historial de costo (insumo_compras) + costo vigente
// del insumo (insumos.costo_unitario). Así Costeo y Reportes se alimentan solos.
//
// Las tablas de órdenes vienen de la migración 2026-11-16_ordenes_compra.sql;
// mientras no esté corrida, /sugerencias y /precios funcionan igual y el resto
// responde 503 con un mensaje claro (código 42P01 = tabla inexistente).
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { EXPRESION_EXISTENCIA } = require('../utils/existencia');

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

const SIN_TABLAS = { error: 'Las compras todavía no están habilitadas en el servidor (falta la migración).' };

function redondear2(n) {
  return Math.round(n * 100) / 100;
}

// GET /api/compras/sugerencias
// Insumos con mínimo capturado (> 0) cuya existencia no lo alcanza. La cantidad
// sugerida repone hasta el DOBLE del mínimo (colchón razonable para no pedir a
// diario) menos lo que ya hay y lo que ya está pedido y pendiente.
router.get('/sugerencias', async (req, res) => {
  try {
    const base = await pool.query(
      `SELECT i.id AS insumo_id, i.nombre, i.unidad_medida, i.cantidad_minima,
              i.costo_unitario, i.proveedor_id, p.nombre AS proveedor,
              ${EXPRESION_EXISTENCIA} AS existencia
       FROM insumos i
       LEFT JOIN movimientos_inventario m ON m.insumo_id = i.id
       LEFT JOIN proveedores p ON p.id = i.proveedor_id
       WHERE i.cantidad_minima > 0
       GROUP BY i.id, p.nombre
       HAVING ${EXPRESION_EXISTENCIA} <= i.cantidad_minima
       ORDER BY p.nombre NULLS LAST, i.nombre`,
    );

    // Lo ya pedido y pendiente (si las tablas aún no existen, simplemente 0).
    const enPedido = new Map();
    try {
      const pend = await pool.query(
        `SELECT d.insumo_id, SUM(d.cantidad_pedida) AS cantidad
         FROM orden_compra_detalle d
         JOIN ordenes_compra o ON o.id = d.orden_compra_id
         WHERE o.estado = 'pendiente'
         GROUP BY d.insumo_id`,
      );
      for (const f of pend.rows) enPedido.set(f.insumo_id, Number(f.cantidad));
    } catch (error) {
      if (error.code !== '42P01') throw error;
    }

    const sugerencias = base.rows.map((f) => {
      const existencia = redondear2(Number(f.existencia));
      const minima = Number(f.cantidad_minima);
      const pedido = enPedido.get(f.insumo_id) ?? 0;
      const sugerida = Math.max(redondear2(minima * 2 - existencia - pedido), 0);
      return {
        insumo_id: f.insumo_id,
        nombre: f.nombre,
        unidad_medida: f.unidad_medida,
        existencia,
        cantidad_minima: minima,
        en_pedido: pedido,
        cantidad_sugerida: sugerida,
        costo_unitario: f.costo_unitario === null ? null : Number(f.costo_unitario),
        proveedor_id: f.proveedor_id,
        proveedor: f.proveedor,
      };
    });
    res.json(sugerencias);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al calcular lo que hay que surtir.' });
  }
});

// GET /api/compras/precios/:insumoId — a quién le ha comprado este insumo y a
// cuánto (último costo y cuántas compras registradas por proveedor).
router.get('/precios/:insumoId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.proveedor_id, COALESCE(p.nombre, 'Sin proveedor') AS proveedor,
              COUNT(*)::int AS compras,
              MIN(c.costo_unitario) AS minimo,
              MAX(c.fecha) AS ultima_fecha,
              (ARRAY_AGG(c.costo_unitario ORDER BY c.fecha DESC))[1] AS ultimo_costo
       FROM insumo_compras c
       LEFT JOIN proveedores p ON p.id = c.proveedor_id
       WHERE c.insumo_id = $1
       GROUP BY c.proveedor_id, p.nombre
       ORDER BY ultimo_costo ASC`,
      [req.params.insumoId],
    );
    res.json(
      r.rows.map((f) => ({
        proveedor_id: f.proveedor_id,
        proveedor: f.proveedor,
        compras: f.compras,
        costo_minimo: Number(f.minimo),
        ultimo_costo: Number(f.ultimo_costo),
        ultima_fecha: f.ultima_fecha,
      })),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar los precios.' });
  }
});

// GET /api/compras?estado=
router.get('/', async (req, res) => {
  const { estado } = req.query;
  if (estado !== undefined && !['pendiente', 'recibida', 'cancelada'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }
  try {
    const r = await pool.query(
      `SELECT o.id, o.estado, o.nota, o.fecha_creacion, o.fecha_recepcion,
              o.proveedor_id, p.nombre AS proveedor,
              u.nombre AS creado_por_nombre,
              COUNT(d.id)::int AS renglones,
              COALESCE(SUM(d.costo_total_recibido), 0) AS total_recibido
       FROM ordenes_compra o
       LEFT JOIN proveedores p ON p.id = o.proveedor_id
       JOIN usuarios u ON u.id = o.creado_por
       LEFT JOIN orden_compra_detalle d ON d.orden_compra_id = o.id
       WHERE ($1::text IS NULL OR o.estado = $1)
       GROUP BY o.id, p.nombre, u.nombre
       ORDER BY o.fecha_creacion DESC
       LIMIT 200`,
      [estado ?? null],
    );
    res.json(r.rows.map((f) => ({ ...f, total_recibido: Number(f.total_recibido) })));
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json(SIN_TABLAS);
    console.error(error);
    res.status(500).json({ error: 'Error al listar las compras.' });
  }
});

// GET /api/compras/:id
router.get('/:id', async (req, res) => {
  try {
    const o = await pool.query(
      `SELECT o.id, o.estado, o.nota, o.fecha_creacion, o.fecha_recepcion,
              o.proveedor_id, p.nombre AS proveedor
       FROM ordenes_compra o LEFT JOIN proveedores p ON p.id = o.proveedor_id
       WHERE o.id = $1`,
      [req.params.id],
    );
    if (o.rows.length === 0) return res.status(404).json({ error: 'Orden de compra no encontrada.' });
    const d = await pool.query(
      `SELECT d.id, d.insumo_id, i.nombre, i.unidad_medida, i.costo_unitario,
              d.cantidad_pedida, d.cantidad_recibida, d.costo_total_recibido
       FROM orden_compra_detalle d JOIN insumos i ON i.id = d.insumo_id
       WHERE d.orden_compra_id = $1 ORDER BY i.nombre`,
      [req.params.id],
    );
    res.json({
      ...o.rows[0],
      items: d.rows.map((f) => ({
        ...f,
        cantidad_pedida: Number(f.cantidad_pedida),
        cantidad_recibida: f.cantidad_recibida === null ? null : Number(f.cantidad_recibida),
        costo_total_recibido: f.costo_total_recibido === null ? null : Number(f.costo_total_recibido),
        costo_unitario: f.costo_unitario === null ? null : Number(f.costo_unitario),
      })),
    });
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json(SIN_TABLAS);
    console.error(error);
    res.status(500).json({ error: 'Error al consultar la orden.' });
  }
});

// POST /api/compras { proveedor_id?, nota?, items: [{ insumo_id, cantidad_pedida }] }
router.post('/', async (req, res) => {
  const { proveedor_id: proveedorId, nota, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un insumo a la orden.' });
  }
  if (items.length > 200) return res.status(400).json({ error: 'Máximo 200 renglones por orden.' });
  if (nota !== undefined && nota !== null && typeof nota !== 'string') {
    return res.status(400).json({ error: 'La nota debe ser texto.' });
  }
  const vistos = new Set();
  for (const it of items) {
    const idInsumo = Number(it?.insumo_id);
    const cantidad = Number(it?.cantidad_pedida);
    if (!Number.isInteger(idInsumo) || idInsumo <= 0) {
      return res.status(400).json({ error: 'Hay un insumo con id inválido.' });
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Cada cantidad pedida debe ser mayor a cero.' });
    }
    if (vistos.has(idInsumo)) return res.status(400).json({ error: 'Un insumo está repetido en la orden.' });
    vistos.add(idInsumo);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (proveedorId) {
      const p = await client.query('SELECT id FROM proveedores WHERE id = $1', [proveedorId]);
      if (p.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El proveedor no existe.' });
      }
    }
    const existentes = await client.query('SELECT id FROM insumos WHERE id = ANY($1::int[])', [[...vistos]]);
    if (existentes.rows.length !== vistos.size) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Algún insumo de la orden no existe.' });
    }
    const orden = await client.query(
      `INSERT INTO ordenes_compra (proveedor_id, nota, creado_por)
       VALUES ($1, $2, $3) RETURNING id, estado, fecha_creacion`,
      [proveedorId || null, nota?.trim() || null, req.usuario.id],
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO orden_compra_detalle (orden_compra_id, insumo_id, cantidad_pedida)
         VALUES ($1, $2, $3)`,
        [orden.rows[0].id, Number(it.insumo_id), redondear2(Number(it.cantidad_pedida))],
      );
    }
    await client.query('COMMIT');
    res.status(201).json(orden.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '42P01') return res.status(503).json(SIN_TABLAS);
    console.error(error);
    res.status(500).json({ error: 'Error al crear la orden de compra.' });
  } finally {
    client.release();
  }
});

// PATCH /api/compras/:id/cancelar — solo una orden pendiente.
router.patch('/:id/cancelar', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE ordenes_compra SET estado = 'cancelada'
       WHERE id = $1 AND estado = 'pendiente' RETURNING id, estado`,
      [req.params.id],
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: 'Solo se puede cancelar una orden pendiente que exista.' });
    }
    res.json(r.rows[0]);
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json(SIN_TABLAS);
    console.error(error);
    res.status(500).json({ error: 'Error al cancelar la orden.' });
  }
});

// POST /api/compras/:id/recibir
// { items: [{ detalle_id, cantidad_recibida, costo_total? }] }
// Por cada renglón con cantidad_recibida > 0 registra la entrada de inventario;
// si trae costo_total (lo que se pagó por TODO lo recibido de ese renglón), el
// costo por unidad = costo_total / cantidad_recibida queda en el historial y como
// costo vigente del insumo. Un renglón con 0 o sin captura se da por no recibido.
// La orden pasa a 'recibida' (una recepción parcial se registra como completa:
// lo que no llegó se vuelve a pedir en una orden nueva).
router.post('/:id/recibir', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Captura lo que llegó de cada insumo.' });
  }
  for (const it of items) {
    const idDet = Number(it?.detalle_id);
    const cant = Number(it?.cantidad_recibida);
    if (!Number.isInteger(idDet) || idDet <= 0) return res.status(400).json({ error: 'Renglón inválido.' });
    if (!Number.isFinite(cant) || cant < 0) {
      return res.status(400).json({ error: 'Cada cantidad recibida debe ser de cero o más.' });
    }
    if (it.costo_total !== undefined && it.costo_total !== null && it.costo_total !== '') {
      const c = Number(it.costo_total);
      if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: 'Cada costo debe ser de cero o más.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orden = await client.query(`SELECT id, estado, proveedor_id FROM ordenes_compra WHERE id = $1 FOR UPDATE`, [
      req.params.id,
    ]);
    if (orden.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden de compra no encontrada.' });
    }
    if (orden.rows[0].estado !== 'pendiente') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Esta orden ya fue recibida o cancelada.' });
    }
    const renglones = await client.query('SELECT id, insumo_id FROM orden_compra_detalle WHERE orden_compra_id = $1', [
      req.params.id,
    ]);
    const porId = new Map(renglones.rows.map((r) => [r.id, r]));
    const enviados = new Set();
    let entradas = 0;

    for (const it of items) {
      const det = porId.get(Number(it.detalle_id));
      if (!det) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Un renglón no pertenece a esta orden.' });
      }
      if (enviados.has(det.id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Un renglón está repetido.' });
      }
      enviados.add(det.id);

      const cantidad = redondear2(Number(it.cantidad_recibida));
      const tieneCosto = it.costo_total !== undefined && it.costo_total !== null && it.costo_total !== '';
      const costoTotal = tieneCosto ? redondear2(Number(it.costo_total)) : null;

      await client.query(
        'UPDATE orden_compra_detalle SET cantidad_recibida = $1, costo_total_recibido = $2 WHERE id = $3',
        [cantidad, costoTotal, det.id],
      );
      if (cantidad <= 0) continue;

      const mov = await client.query(
        `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, responsable_id, motivo)
         VALUES ($1, 'entrada', $2, $3, $4) RETURNING id`,
        [det.insumo_id, cantidad, req.usuario.id, `Compra #${orden.rows[0].id}`],
      );
      entradas++;
      if (costoTotal && costoTotal > 0) {
        const costoUnitario = Math.round((costoTotal / cantidad) * 1e6) / 1e6;
        await client.query(
          `INSERT INTO insumo_compras (insumo_id, costo_unitario, cantidad, proveedor_id, registrado_por, movimiento_id, nota)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            det.insumo_id,
            costoUnitario,
            cantidad,
            orden.rows[0].proveedor_id,
            req.usuario.id,
            mov.rows[0].id,
            `Compra #${orden.rows[0].id}`,
          ],
        );
        await client.query('UPDATE insumos SET costo_unitario = $1 WHERE id = $2', [costoUnitario, det.insumo_id]);
      }
    }

    await client.query(
      `UPDATE ordenes_compra SET estado = 'recibida', fecha_recepcion = NOW(), recibido_por = $1 WHERE id = $2`,
      [req.usuario.id, req.params.id],
    );
    await client.query('COMMIT');
    res.json({ ok: true, entradas });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '42P01') return res.status(503).json(SIN_TABLAS);
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la recepción.' });
  } finally {
    client.release();
  }
});

module.exports = router;
