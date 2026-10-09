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
//   GET   /:id/tiempos      → cuánto duró la orden en cada estado, para
//                             reportes (administrador, encargado — RF-08)
//   GET   /:id/insumos-descontados → qué insumos (y cuánto) descontarían
//                             las líneas indicadas, para el checklist de
//                             cancelación parcial (administrador, encargado)
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
//
// DESCUENTO AUTOMÁTICO DE INVENTARIO (Fase 2 del recetario, "en base al
// estado del pedido"): al entrar a 'preparando' —y solo en ese paso, nunca
// al registrar la venta— se expande la receta de cada producto de la orden
// (utils/inventarioOrden.js) y se registra una salida en
// `movimientos_inventario` por cada insumo, multiplicada por la cantidad
// vendida, ligada a la orden (`orden_id`) para poder revertirla si la venta
// se cancela después (RF-11, ver routes/ventas.js). Se excluyen los insumos
// marcados "quitado" en `orden_detalle_insumos` (ver routes/ventas.js). Un
// producto sin receta cargada todavía (ver PENDIENTES_FASE2 en
// scripts/seed-recetas.js) no descuenta nada — no bloquea el avance de la
// comanda, solo no descuenta.
//
// TIEMPO POR ESTADO (RF-08): cada cambio de estado cierra el renglón abierto
// de `orden_estado_historial` (fecha_fin = NOW()) y abre uno nuevo para el
// estado al que acaba de entrar. Así queda registrado cuánto duró cada paso,
// consultable en GET /:id/tiempos.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const {
  calcularInsumosDeOrden,
  calcularInsumosDeLineas,
  registrarMovimientosInventario,
} = require('../utils/inventarioOrden');

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
      `SELECT od.orden_id, od.variante_id, od.cantidad, od.notas,
              vp.nombre AS variante_nombre, p.nombre AS producto_nombre
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
        variante_id: fila.variante_id,
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
// Se hace en una transacción porque el paso a 'preparando' también escribe
// el descuento de inventario (ver cabecera del archivo): o se mueve la
// comanda Y se descuenta, o no se mueve nada.
router.patch('/:id/estado', requiereRol(...ROLES_QUE_AVANZAN), async (req, res) => {
  const { id } = req.params;
  const { estado: estadoSolicitado } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ordenActual = await client.query(
      'SELECT estado, numero_orden FROM ordenes WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (ordenActual.rows.length === 0) {
      throw { status: 404, mensaje: 'La orden no existe.' };
    }

    const { estado: estadoActual, numero_orden: numeroOrden } = ordenActual.rows[0];
    const indiceActual = SECUENCIA_ESTADOS.indexOf(estadoActual);

    // Una orden 'cancelada' no está en la secuencia (índice -1): ya no se mueve.
    if (indiceActual === -1) {
      throw { status: 409, mensaje: `La orden está en estado "${estadoActual}" y ya no se puede avanzar.` };
    }

    // El único estado permitido es el que sigue en la secuencia. Si la orden
    // ya está 'entregado' no hay siguiente y también se rechaza.
    const siguienteEstado = SECUENCIA_ESTADOS[indiceActual + 1];
    if (!siguienteEstado || estadoSolicitado !== siguienteEstado) {
      throw {
        status: 400,
        mensaje: `Desde "${estadoActual}" solo se puede avanzar a "${siguienteEstado || '(ninguno, ya está entregada)'}".`,
      };
    }

    // La condición sobre el estado actual evita que dos personas (o dos
    // toques seguidos) avancen la misma comanda dos pasos: solo gana una.
    // (El FOR UPDATE de arriba ya bloqueó la fila, así que esto no debería
    // fallar por una carrera, pero se deja como segundo seguro.)
    const resultado = await client.query(
      'UPDATE ordenes SET estado = $1 WHERE id = $2 AND estado = $3 RETURNING *',
      [siguienteEstado, id, estadoActual]
    );

    if (resultado.rows.length === 0) {
      throw { status: 409, mensaje: 'La orden ya cambió de estado. Se actualizó el tablero.' };
    }

    // Descuento de inventario: solo al ENTRAR a 'preparando' (no al salir de
    // ahí en pasos posteriores). Como sin_preparar->preparando es la única
    // forma de llegar a 'preparando', esto corre una sola vez por orden.
    if (siguienteEstado === 'preparando') {
      await descontarInventario(client, id, numeroOrden, req.usuario.id);
    }

    // RF-08: se cierra el renglón de historial del estado que se deja
    // (fecha_fin = NOW()) y se abre uno nuevo para el estado al que se entra.
    await client.query(
      `UPDATE orden_estado_historial SET fecha_fin = NOW() WHERE orden_id = $1 AND fecha_fin IS NULL`,
      [id]
    );
    await client.query(
      `INSERT INTO orden_estado_historial (orden_id, estado, fecha_inicio, responsable_id)
       VALUES ($1, $2, NOW(), $3)`,
      [id, siguienteEstado, req.usuario.id]
    );

    await client.query('COMMIT');
    res.json(resultado.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el estado de la orden.' });
  } finally {
    client.release();
  }
});

// Expande la receta de la orden (utils/inventarioOrden.js) y registra una
// SALIDA en movimientos_inventario por cada insumo, ligada a la orden para
// poder revertirla si la venta se cancela después (RF-11).
async function descontarInventario(client, ordenId, numeroOrden, responsableId) {
  const insumos = await calcularInsumosDeOrden(client, ordenId);
  await registrarMovimientosInventario(client, insumos, {
    tipo: 'salida',
    responsableId,
    motivo: `Venta ${numeroOrden}`,
    ordenId,
  });
}

// GET /api/ordenes/:id/tiempos
// Cuánto duró la orden en cada estado (RF-08: "para su posterior consulta
// en reportes"). Cada renglón de orden_estado_historial ya tiene su
// fecha_inicio/fecha_fin; aquí solo se calcula la duración en segundos — la
// del estado actual (fecha_fin todavía NULL) se calcula contra NOW().
// Mismo criterio de permisos que el resto de la información financiera/de
// reportes (GET /api/ventas, /api/caja/cortes): administrador y encargado.
router.get('/:id/tiempos', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT estado, fecha_inicio, fecha_fin,
              EXTRACT(EPOCH FROM (COALESCE(fecha_fin, NOW()) - fecha_inicio))::int AS duracion_segundos
       FROM orden_estado_historial
       WHERE orden_id = $1
       ORDER BY fecha_inicio ASC`,
      [id]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los tiempos de la orden.' });
  }
});

// GET /api/ordenes/:id/insumos-descontados?lineas=12,13
// Qué insumos (y cuánto de cada uno) se descontarían/descontaron por las
// líneas indicadas — sin `lineas`, todas las activas (no canceladas) de la
// orden. La usa la pantalla de cancelación (historial-ventas) para armar el
// checklist de "qué se rescata / qué ya es merma" cuando la comanda está en
// 'preparando' (ver PATCH /api/ventas/:id/cancelar). Es una consulta, no
// escribe nada: se puede llamar antes de decidir qué cancelar.
router.get('/:id/insumos-descontados', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { id } = req.params;
  try {
    let ordenDetalleIds;
    if (req.query.lineas) {
      ordenDetalleIds = String(req.query.lineas)
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v));
    } else {
      const lineas = await pool.query('SELECT id FROM orden_detalle WHERE orden_id = $1 AND cancelado = FALSE', [
        id,
      ]);
      ordenDetalleIds = lineas.rows.map((r) => r.id);
    }

    const insumos = await calcularInsumosDeLineas(pool, ordenDetalleIds);
    if (insumos.length === 0) {
      return res.json([]);
    }

    const insumoIds = insumos.map((i) => i.insumo_id);
    const nombres = await pool.query(
      'SELECT id, nombre, unidad_medida FROM insumos WHERE id = ANY($1::int[])',
      [insumoIds]
    );
    const datosPorId = new Map(nombres.rows.map((r) => [r.id, r]));

    res.json(
      insumos.map((i) => ({
        insumo_id: i.insumo_id,
        cantidad: i.cantidad,
        nombre: datosPorId.get(i.insumo_id)?.nombre ?? '(insumo eliminado)',
        unidad_medida: datosPorId.get(i.insumo_id)?.unidad_medida ?? '',
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al calcular los insumos descontados.' });
  }
});

module.exports = router;
