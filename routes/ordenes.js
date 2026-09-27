// =============================================================================
// routes/ordenes.js — COMANDAS Y ESTADOS DE PREPARACIÓN (Sprint 2)
// =============================================================================
// Una "comanda" es la orden de una venta vista desde la cocina. Cada venta
// registrada en el POS crea una orden en estado 'sin_preparar' (ver
// routes/ventas.js) y este módulo permite seguirla hasta entregarla.
//
// Endpoints (prefijo /api/ordenes), todos exigen sesión:
//   GET   /?estado=a,b      → órdenes para el tablero (administrador,
//                             encargado, cajero, auxiliar)
//   PATCH /:id/estado       → avanzar la orden un paso (administrador,
//                             encargado, auxiliar)
//
// CICLO DE VIDA (solo hacia adelante, sin saltos ni retrocesos):
//   sin_preparar → preparando → por_entregar → entregado
//   'cancelada' NO forma parte de esta secuencia: se asigna al cancelar la
//   venta (PATCH /api/ventas/:id/cancelar) y ya no se puede avanzar.
//
// QUIÉN PUEDE QUÉ
//   Ver el tablero:   administrador, encargado, cajero, auxiliar
//   Avanzar estados:  administrador, encargado, auxiliar (cocina)
//   El cajero SOLO consulta: no ve botones ni puede llamar al PATCH.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);

// Quién puede qué (Sprint 2): las comandas las ve todo el personal de
// operación (incluido el cajero, solo lectura), pero solo administrador,
// encargado y auxiliar (cocina) pueden avanzarlas de estado.
const ROLES_QUE_VEN = ['administrador', 'encargado', 'cajero', 'auxiliar'];
const ROLES_QUE_AVANZAN = ['administrador', 'encargado', 'auxiliar'];

// El flujo de una comanda avanza en un solo sentido; 'cancelada' se maneja
// aparte, a través de la cancelación de la venta.
// El orden del arreglo ES el orden del flujo: el "siguiente" estado de uno es
// el elemento que le sigue.
const SECUENCIA_ESTADOS = ['sin_preparar', 'preparando', 'por_entregar', 'entregado'];

// GET /api/ordenes?estado=sin_preparar,preparando
// Lista órdenes con sus productos, para el tablero de comandas. Sin filtro,
// devuelve solo las órdenes activas (no entregadas ni canceladas).
// Las más antiguas salen primero: son las que llevan más tiempo esperando.
router.get('/', requiereRol(...ROLES_QUE_VEN), async (req, res) => {
  // `estado` llega como texto separado por comas: "sin_preparar,preparando".
  const estadosSolicitados = req.query.estado
    ? String(req.query.estado).split(',').map((e) => e.trim())
    : ['sin_preparar', 'preparando', 'por_entregar'];

  try {
    // Consulta 1: las órdenes en los estados pedidos (más antiguas primero).
    const ordenes = await pool.query(
      `SELECT o.id, o.numero_orden, o.estado, o.tipo_entrega, o.fecha_creacion
       FROM ordenes o
       WHERE o.estado = ANY($1::varchar[])
       ORDER BY o.fecha_creacion ASC`,
      [estadosSolicitados]
    );

    if (ordenes.rows.length === 0) {
      return res.json([]);
    }

    // Consulta 2: los productos de todas esas órdenes de una sola vez
    // (incluye `notas`: lo que el cliente pidió quitar o cambiar).
    const ordenIds = ordenes.rows.map((o) => o.id);
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

    // Cada orden sale con su arreglo `items` incluido.
    const resultado = ordenes.rows.map((orden) => ({
      ...orden,
      items: detallePorOrden[orden.id] || [],
    }));

    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las órdenes.' });
  }
});

// PATCH /api/ordenes/:id/estado
// Avanza la orden exactamente un paso en la secuencia
// sin_preparar -> preparando -> por_entregar -> entregado.
// Cuerpo: { estado: '<el estado siguiente>' }. El cliente debe pedir
// justamente el siguiente estado; cualquier otro (salto o retroceso) es 400.
router.patch('/:id/estado', requiereRol(...ROLES_QUE_AVANZAN), async (req, res) => {
  const { id } = req.params;
  const { estado: estadoSolicitado } = req.body;

  try {
    const ordenActual = await pool.query('SELECT estado FROM ordenes WHERE id = $1', [id]);
    if (ordenActual.rows.length === 0) {
      return res.status(404).json({ error: 'La orden no existe.' });
    }

    const estadoActual = ordenActual.rows[0].estado;
    const indiceActual = SECUENCIA_ESTADOS.indexOf(estadoActual);

    // Una orden 'cancelada' no está en la secuencia (índice -1): ya no se mueve.
    if (indiceActual === -1) {
      return res.status(409).json({
        error: `La orden está en estado "${estadoActual}" y ya no se puede avanzar.`,
      });
    }

    // El único estado permitido es el que sigue en la secuencia. Si la orden
    // ya está 'entregado' no hay siguiente y también se rechaza.
    const siguienteEstado = SECUENCIA_ESTADOS[indiceActual + 1];
    if (!siguienteEstado || estadoSolicitado !== siguienteEstado) {
      return res.status(400).json({
        error: `Desde "${estadoActual}" solo se puede avanzar a "${siguienteEstado || '(ninguno, ya está entregada)'}".`,
      });
    }

    // La condición sobre el estado actual evita que dos personas (o dos
    // toques seguidos) avancen la misma comanda dos pasos: solo gana una.
    // (Si otra petición la movió justo antes, este UPDATE no encuentra fila.)
    const resultado = await pool.query(
      'UPDATE ordenes SET estado = $1 WHERE id = $2 AND estado = $3 RETURNING *',
      [siguienteEstado, id, estadoActual]
    );

    if (resultado.rows.length === 0) {
      return res.status(409).json({ error: 'La orden ya cambió de estado. Se actualizó el tablero.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el estado de la orden.' });
  }
});

module.exports = router;
