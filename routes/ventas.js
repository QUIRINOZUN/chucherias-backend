// =============================================================================
// routes/ventas.js — REGISTRO, CONSULTA Y CANCELACIÓN DE VENTAS
// =============================================================================
// Endpoints (prefijo /api/ventas), todos exigen sesión:
//   POST  /                → registrar una venta (administrador, encargado, cajero)
//   GET   /?fecha=…        → ventas de un día del negocio      (administrador, encargado)
//   PATCH /:id/cancelar    → cancelar una venta, total o PARCIAL (RF-03)
//                            (administrador, encargado)
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
//
// CANCELACIÓN (PARCIAL o total) — decisión de negocio del 2026-10-03:
//   Cancelar una venta ya NO es todo-o-nada: se puede elegir cuáles
//   productos (orden_detalle) se cancelan. `ventas.total` NUNCA se modifica
//   después de registrada (es el histórico de lo que se cobró); lo que se
//   ajusta es `ventas.estado` (solo pasa a 'cancelada' si TODOS sus
//   productos quedan cancelados) y se registra un REEMBOLSO (ver abajo).
//
//   Por cada producto cancelado, sin importar el estado de la comanda, se
//   registra una MERMA (tabla `mermas`, a nivel producto — "esto ya no se
//   puede volver a vender"). Qué pasa con los INSUMOS de ese producto
//   depende del estado que tenía la comanda al cancelarse:
//     - 'sin_preparar'  → nunca se descontó nada, no hay nada que rescatar
//                         ni que perder (ver RF-11 más abajo).
//     - 'preparando'    → YA se había descontado. Quien cancela elige, por
//                         insumo, cuáles se RESCATAN (vuelven al inventario)
//                         y cuáles ya son MERMA de insumo (se usaron en la
//                         preparación y no se pueden recuperar) — viene en
//                         `insumos_rescatados` del body.
//     - 'por_entregar' / 'entregado' → el producto ya está armado o listo:
//                         NINGÚN insumo se rescata, todo queda como ya
//                         consumido (no se revierte nada).
//
//   REEMBOLSO: si cancelar implica que el cliente ya pagó por algo que no
//   se le va a entregar, se registra un movimiento de caja tipo 'reembolso'
//   (mismo mecanismo que 'retiro': resta del efectivo esperado — ver
//   routes/caja.js) por la suma de los productos cancelados EN ESTA
//   operación, ligado a la orden (`movimientos_caja.orden_id`).
//
//   RF-11 (restitución de inventario): si la comanda ya había pasado por
//   'preparando' (y por lo tanto routes/ordenes.js ya descontó sus
//   insumos), cancelar restituye SOLO los insumos marcados como "rescatados"
//   (ver arriba) — antes de este ajuste se restituía siempre el 100%. La
//   merma (financiera, a nivel producto) y la restitución (ajuste del
//   ledger de insumos) conviven a propósito: una no sustituye a la otra.
//
//   Fase 2 del recetario: cada item puede traer `insumos_quitados` (nombres
//   de insumo, no solo texto) — se guardan en `orden_detalle_insumos` para
//   que el descuento automático de inventario (routes/ordenes.js, al pasar
//   la comanda a 'preparando') sepa qué NO restar.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaHoyNegocio, diaNegocioSql, fechaValida } = require('../utils/fecha');
const { calcularInsumosDeLineas, registrarMovimientosInventario } = require('../utils/inventarioOrden');

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

    // RF-08: abre el primer renglón de tiempo por estado ('sin_preparar'),
    // que routes/ordenes.js irá cerrando y reabriendo en cada avance.
    await client.query(
      `INSERT INTO orden_estado_historial (orden_id, estado, fecha_inicio, responsable_id)
       VALUES ($1, 'sin_preparar', NOW(), $2)`,
      [orden.rows[0].id, req.usuario.id]
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
      const detalle = await client.query(
        `INSERT INTO orden_detalle (orden_id, variante_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orden.rows[0].id, item.variante_id, cantidad, precioUnitario, item.notas || null]
      );

      // Fase 2 del recetario: ingredientes quitados, como insumo real (no
      // solo texto), para que el descuento automático sepa qué NO restar al
      // preparar esta línea (ver PATCH /api/ordenes/:id/estado). Un nombre
      // que no coincida con ningún insumo se ignora en silencio: es mejor
      // perder la exclusión de ESE ingrediente que tumbar la venta completa
      // por un nombre mal escrito en el catálogo del POS.
      for (const nombreInsumo of item.insumos_quitados || []) {
        const insumo = await client.query('SELECT id FROM insumos WHERE nombre = $1', [nombreInsumo]);
        if (insumo.rows.length === 0) {
          continue;
        }
        await client.query(
          `INSERT INTO orden_detalle_insumos (orden_detalle_id, insumo_id, tipo)
           VALUES ($1, $2, 'quitado')`,
          [detalle.rows[0].id, insumo.rows[0].id]
        );
      }

      // Y los insumos ELEGIDOS (salsa/topping/dip): no están en la receta fija
      // de la variante (esa línea se dejó fuera a propósito), así que aquí sí
      // se guarda también la cantidad — es la única fuente de esa cantidad
      // para cuando se descuente el inventario.
      for (const elegido of item.insumos_elegidos || []) {
        const insumo = await client.query('SELECT id FROM insumos WHERE nombre = $1', [elegido.insumo]);
        if (insumo.rows.length === 0) {
          continue;
        }
        await client.query(
          `INSERT INTO orden_detalle_insumos (orden_detalle_id, insumo_id, tipo, cantidad, unidad_medida)
           VALUES ($1, $2, 'elegido', $3, $4)`,
          [detalle.rows[0].id, insumo.rows[0].id, elegido.cantidad, elegido.unidad_medida]
        );
      }
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
    // Consulta 1: las ventas del día con datos de su orden, el cajero, —si
    // fue cancelada— quién la canceló (LEFT JOIN: solo existe en canceladas),
    // y cuántas mermas (y cuántos pesos) generó esa cancelación (0 en una
    // venta no cancelada).
    const ventas = await pool.query(
      `SELECT v.*, o.id AS orden_id, o.numero_orden, o.tipo_entrega, o.estado AS estado_orden,
              u.nombre AS cajero, uc.nombre AS cancelado_por_nombre,
              (SELECT COUNT(*)::int FROM mermas m WHERE m.orden_id = o.id) AS mermas_generadas,
              (SELECT COALESCE(SUM(m.valor_unitario * m.cantidad), 0) FROM mermas m WHERE m.orden_id = o.id) AS mermas_valor_total,
              -- RF-11: insumos que se restituyeron al cancelar (0 en una venta
              -- no cancelada, si se canceló antes de llegar a 'preparando', o si
              -- al cancelar en 'preparando' no se marcó ningún insumo como rescatado).
              (SELECT COUNT(*)::int FROM movimientos_inventario mi
                WHERE mi.orden_id = o.id AND mi.tipo = 'entrada') AS insumos_restituidos,
              -- RF-08: cuánto duró la orden en 'preparando' (NULL si nunca llegó).
              (SELECT EXTRACT(EPOCH FROM (COALESCE(oeh.fecha_fin, NOW()) - oeh.fecha_inicio))::int
                FROM orden_estado_historial oeh
                WHERE oeh.orden_id = o.id AND oeh.estado = 'preparando') AS segundos_preparacion,
              -- Cancelación parcial: dinero devuelto al cliente por los productos
              -- cancelados de ESTA orden (0 si nunca se canceló nada de ella).
              (SELECT COALESCE(SUM(mc.monto), 0) FROM movimientos_caja mc
                WHERE mc.orden_id = o.id AND mc.tipo = 'reembolso') AS monto_reembolsado
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
      `SELECT od.id AS orden_detalle_id, od.orden_id, od.cantidad, od.notas, od.cancelado,
              od.motivo_cancelacion, od.precio_unitario, vp.nombre AS variante_nombre, p.nombre AS producto_nombre
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
        orden_detalle_id: fila.orden_detalle_id,
        producto: fila.producto_nombre,
        variante: fila.variante_nombre,
        cantidad: fila.cantidad,
        notas: fila.notas,
        motivo_cancelacion: fila.motivo_cancelacion,
        cancelado: fila.cancelado,
        precio_unitario: fila.precio_unitario,
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
// Solo administrador o encargado pueden cancelar una venta (RF-03), total o
// PARCIALMENTE (ver cabecera del archivo para la lógica completa).
//
// Cuerpo: {
//   motivo?: string,
//   orden_detalle_ids?: number[],   // qué productos cancelar; si se omite o
//                                    // viene vacío, se cancelan TODOS los
//                                    // activos (comportamiento de siempre)
//   insumos_rescatados?: number[],  // solo importa si la comanda está
//                                    // 'preparando': ids de insumo que se
//                                    // RESCATAN (el resto queda como merma)
// }
//
// La venta, la orden/líneas, las mermas, la restitución de inventario y el
// reembolso se registran en una sola transacción.
router.patch('/:id/cancelar', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { id } = req.params;
  const { motivo, orden_detalle_ids: lineasSolicitadas, insumos_rescatados } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // La venta debe seguir 'completada' (impide cancelar algo ya cancelado
    // del todo). FOR UPDATE: dos cancelaciones a la vez no pisan el cálculo.
    const venta = await client.query(`SELECT * FROM ventas WHERE id = $1 FOR UPDATE`, [id]);
    if (venta.rows.length === 0 || venta.rows[0].estado !== 'completada') {
      throw { status: 404, mensaje: 'La venta no existe o ya fue cancelada.' };
    }

    const ordenId = venta.rows[0].orden_id;

    // Estado de la orden ANTES de tocar nada: decide qué pasa con los
    // insumos (rescate selectivo, merma automática, o nada que descontar).
    const ordenActual = await client.query(
      `SELECT estado, numero_orden FROM ordenes WHERE id = $1 FOR UPDATE`,
      [ordenId]
    );
    const { estado: estadoOrden, numero_orden: numeroOrden } = ordenActual.rows[0];

    // Líneas activas (no canceladas todavía) de la orden — son las únicas
    // candidatas a cancelar ahora.
    const lineasActivas = await client.query(
      `SELECT id, variante_id, cantidad, precio_unitario
       FROM orden_detalle WHERE orden_id = $1 AND cancelado = FALSE`,
      [ordenId]
    );
    if (lineasActivas.rows.length === 0) {
      throw { status: 409, mensaje: 'Esta venta ya no tiene productos activos que cancelar.' };
    }

    // Sin `orden_detalle_ids` (o vacío), se cancelan TODAS las líneas activas
    // — es el "cancelar la venta completa" de siempre. Con la lista, solo
    // las que de verdad siguen activas (una línea ya cancelada se ignora en
    // silencio en vez de dar error, por si el cliente manda algo desfasado).
    const idsSolicitados = Array.isArray(lineasSolicitadas) ? new Set(lineasSolicitadas) : null;
    const lineasACancelar =
      idsSolicitados && idsSolicitados.size > 0
        ? lineasActivas.rows.filter((l) => idsSolicitados.has(l.id))
        : lineasActivas.rows;

    if (lineasACancelar.length === 0) {
      throw { status: 400, mensaje: 'Selecciona al menos un producto para cancelar.' };
    }

    // ---- MERMA a nivel producto: una fila por cada línea cancelada AHORA ----
    let valorTotalMerma = 0;
    for (const linea of lineasACancelar) {
      valorTotalMerma += Number(linea.precio_unitario) * Number(linea.cantidad);
      await client.query(
        `INSERT INTO mermas
           (variante_id, cantidad, motivo, responsable_id, orden_id, valor_unitario, estado_orden_previo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          linea.variante_id,
          linea.cantidad,
          `Venta cancelada — orden ${numeroOrden} estaba en "${estadoOrden}"`,
          req.usuario.id,
          ordenId,
          linea.precio_unitario,
          estadoOrden,
        ]
      );
      await client.query(
        `UPDATE orden_detalle SET cancelado = TRUE, fecha_cancelacion = NOW(), motivo_cancelacion = $2 WHERE id = $1`,
        [linea.id, motivo || null]
      );
    }

    // ---- INSUMOS: rescate selectivo (preparando), merma automática (por_entregar/
    // entregado), o nada que hacer (sin_preparar — nunca se descontó) ----
    let insumosRestituidos = 0;
    if (estadoOrden === 'preparando') {
      const insumosDescontados = await calcularInsumosDeLineas(
        client,
        lineasACancelar.map((l) => l.id)
      );
      const idsRescatados = new Set(Array.isArray(insumos_rescatados) ? insumos_rescatados : []);
      const aRestituir = insumosDescontados.filter((i) => idsRescatados.has(i.insumo_id));
      if (aRestituir.length > 0) {
        await registrarMovimientosInventario(client, aRestituir, {
          tipo: 'entrada',
          responsableId: req.usuario.id,
          motivo: `Restitución parcial por cancelación — orden ${numeroOrden}`,
          ordenId,
        });
      }
      insumosRestituidos = aRestituir.length;
    }
    // 'sin_preparar': nunca se descontó nada, no hay nada que rescatar ni perder.
    // 'por_entregar' / 'entregado': el producto ya está armado — todo el insumo
    // ya descontado queda como consumido, no se restituye nada automáticamente.

    // ---- ¿Queda alguna línea activa? Si no, la venta y la orden se cancelan
    // por completo (igual que antes de este ajuste) ----
    const lineasRestantes = lineasActivas.rows.length - lineasACancelar.length;
    if (lineasRestantes === 0) {
      await client.query(
        `UPDATE ventas SET estado = 'cancelada', cancelado_por = $1, motivo_cancelacion = $2, fecha_cancelacion = NOW()
         WHERE id = $3`,
        [req.usuario.id, motivo || null, id]
      );
      await client.query(`UPDATE ordenes SET estado = 'cancelada' WHERE id = $1`, [ordenId]);
      // RF-08: se cierra el renglón de historial que seguía abierto.
      await client.query(
        `UPDATE orden_estado_historial SET fecha_fin = NOW() WHERE orden_id = $1 AND fecha_fin IS NULL`,
        [ordenId]
      );
    }
    // Si quedan líneas activas, la venta sigue 'completada' y la comanda sigue
    // su curso normal con lo que le queda — solo se le quitaron productos.

    // ---- REEMBOLSO: lo que se le debe devolver al cliente por LO CANCELADO
    // EN ESTA OPERACIÓN (nunca el total completo de la venta, por si ya hubo
    // una cancelación parcial anterior) — movimiento de caja, mismo mecanismo
    // que un retiro (resta del efectivo esperado), ligado a la orden. ----
    if (valorTotalMerma > 0) {
      await client.query(
        `INSERT INTO movimientos_caja (tipo, monto, motivo, responsable_id, confirmado, confirmado_por, fecha_confirmacion, orden_id)
         VALUES ('reembolso', $1, $2, $3, TRUE, $3, NOW(), $4)`,
        [valorTotalMerma, `Reembolso por cancelación — orden ${numeroOrden}`, req.usuario.id, ordenId]
      );
    }

    // Se vuelve a leer la venta (puede haber cambiado de estado arriba) para
    // que la respuesta refleje su estado REAL, no la foto de antes de cancelar.
    const ventaFinal = await client.query('SELECT * FROM ventas WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({
      ...ventaFinal.rows[0],
      cancelacion_total: lineasRestantes === 0,
      productos_cancelados: lineasACancelar.length,
      mermas_generadas: lineasACancelar.length,
      mermas_valor_total: valorTotalMerma.toFixed(2),
      insumos_restituidos: insumosRestituidos,
      monto_reembolso: valorTotalMerma.toFixed(2),
    });
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
