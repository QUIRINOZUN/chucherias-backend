// =============================================================================
// routes/ventas.js — REGISTRO, CONSULTA Y CANCELACIÓN DE VENTAS
// =============================================================================
// Endpoints (prefijo /api/ventas), todos exigen sesión:
//   POST  /                → registrar una venta (administrador, encargado, cajero)
//   GET   /?desde=&hasta=&estado=&metodo_pago=&tipo_entrega=&buscar=
//                           → consulta de tickets con filtros, todos opcionales
//                             y combinables; sin ninguno, todo el histórico
//                             (mismo criterio que mermas/ventas-especiales) —
//                             (administrador, encargado). Ver "2026-10-22:
//                             de 'Ventas de hoy' a 'Ventas'" más abajo.
//   PATCH /:id/cancelar    → cancelar una venta, total o PARCIAL (RF-03)
//                            (administrador, encargado)
//   DELETE /historial?desde=&hasta=
//                           → ELIMINA todas las ventas/órdenes del rango,
//                             irreversible (solo administrador) — ver
//                             sección "ELIMINAR HISTORIAL" más abajo.
//
// 2026-10-22: de "Ventas de hoy" a "Ventas" — el módulo pasó de mostrar
// solo el día en curso a ser la consulta general de tickets (RF implícito:
// poder localizar cualquier venta pasada, no solo la de hoy). `GET /` dejó
// de exigir ni asumir ninguna fecha por default — antes devolvía SIEMPRE el
// día del negocio en curso (`fecha` por default a `fechaHoyNegocio()`); el
// filtro de fecha ahora es un rango (`desde`/`hasta`) opcional, igual que ya
// usan mermas/caja (cortes)/reportes/ventas especiales. `buscar` encuentra
// un ticket por folio, cajero, cliente (de lealtad o de domicilio, nombre o
// teléfono) o por el nombre de un producto vendido — pensado para "¿quién
// compró X?" o "busco el ticket de Fulano" sin saber la fecha exacta.
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
//
//   RF-23 (2026-10-16): si la venta cancelada (TOTAL, no parcial) había
//   generado una visita de lealtad, esa visita (y el descuento, si lo hubo)
//   se revierte — "no se toma en cuenta para los puntos", confirmado en la
//   entrevista con la titular. Ver la sección correspondiente más abajo.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { registrarAccion } = require('../utils/bitacora');
const { fechaHoyNegocio, diaNegocioSql, fechaValida } = require('../utils/fecha');
const {
  calcularInsumosDeOrden,
  calcularInsumosDeLineas,
  registrarMovimientosInventario,
} = require('../utils/inventarioOrden');

const router = express.Router();

router.use(verificarToken);

// Genera un número de orden único y legible: ORD-<fecha>-<sufijo aleatorio>
// Ejemplo: ORD-20260926-4821. La fecha es el día del negocio en hora de
// Durango (fechaHoyNegocio, ver utils/fecha.js) — antes usaba
// `new Date().toISOString()` (UTC), así que después de las 6:00 pm locales
// el número de orden quedaba con la fecha del día siguiente aunque la venta
// siguiera siendo del día de hoy en el corte de caja.
function generarNumeroOrden() {
  const fecha = fechaHoyNegocio().replace(/-/g, '');
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
//     cliente_nombre?, cliente_direccion?, cliente_telefono?, (obligatorios SOLO si domicilio)
//     repartidor_id?,   (opcional, solo tiene sentido si domicilio — ver sección 2)
//     items: [{ variante_id, cantidad, notas? }],
//     cliente_id? }      (RF-21/RF-22: cliente de lealtad, opcional — ver sección 4)
// Respuesta 201: { orden, venta }.
router.post('/', requiereRol('administrador', 'encargado', 'cajero'), async (req, res) => {
  const { items, metodo_pago, cliente_id } = req.body;
  const tipo_entrega = req.body.tipo_entrega || 'presencial';
  // Entrevista con la titular: una orden debe poder registrar "nombre del
  // repartidor" — opcional (puede asignarse después desde Comandas, ver
  // PATCH /api/ordenes/:id/repartidor) y solo tiene sentido en domicilio.
  const repartidorId = tipo_entrega === 'domicilio' ? req.body.repartidor_id || null : null;

  // ---- Validaciones de entrada (antes de tocar la base de datos) ----------
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe incluir al menos un producto.' });
  }
  if (!['efectivo', 'transferencia'].includes(metodo_pago)) {
    return res.status(400).json({
      error: 'El método de pago debe ser efectivo o transferencia.',
    });
  }
  if (!['presencial', 'domicilio'].includes(tipo_entrega)) {
    return res.status(400).json({ error: 'El tipo de entrega debe ser presencial o domicilio.' });
  }

  // 2026-10-11/12: nombre, dirección y teléfono del cliente, obligatorios
  // SOLO para domicilio (en presencial se ignoran, aunque lleguen, para no
  // guardar basura a medias si el frontend se equivoca).
  const clienteNombre = tipo_entrega === 'domicilio' ? req.body.cliente_nombre?.trim() : null;
  const clienteDireccion = tipo_entrega === 'domicilio' ? req.body.cliente_direccion?.trim() : null;
  const clienteTelefono = tipo_entrega === 'domicilio' ? req.body.cliente_telefono?.trim() : null;
  if (tipo_entrega === 'domicilio' && (!clienteNombre || !clienteDireccion || !clienteTelefono)) {
    return res.status(400).json({
      error: 'Un pedido a domicilio necesita el nombre, la dirección y el teléfono del cliente.',
    });
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
    // Se trae también productos.requiere_preparacion (2026-10-19): decide
    // más abajo si esta orden nace en 'sin_preparar' (normal) o salta
    // directo a 'por_entregar' — ver sección 3.5.
    const variantesResultado = await client.query(
      `SELECT vp.id, vp.precio, p.requiere_preparacion
         FROM variantes_producto vp
         JOIN productos p ON p.id = vp.producto_id
         WHERE vp.id = ANY($1::int[])`,
      [varianteIds],
    );

    // Diccionarios { variante_id: precio / requiere_preparacion } para
    // consultar cada dato rápido, sin repetir la consulta por línea.
    const precioPorVariante = {};
    const requierePreparacionPorVariante = {};
    for (const fila of variantesResultado.rows) {
      precioPorVariante[fila.id] = Number(fila.precio);
      requierePreparacionPorVariante[fila.id] = fila.requiere_preparacion;
    }

    // Si alguna variante enviada no existe, se aborta la venta completa.
    for (const varianteId of varianteIds) {
      if (precioPorVariante[varianteId] === undefined) {
        throw {
          status: 400,
          mensaje: `El producto con variante ${varianteId} no existe.`,
        };
      }
    }

    // Productos sin preparación (RF nuevo, 2026-10-19): bebidas
    // embotelladas, botanas de bolsa — no pasan por cocina. Si TODOS los
    // productos de esta orden son así, la orden nace directo en
    // 'por_entregar' (ver sección 2) en vez de esperar en el tablero de
    // cocina. Una orden MIXTA (aunque sea un solo producto que sí requiera
    // preparación) sigue el flujo normal completo — el estado es de la
    // orden entera, no por línea.
    const todosSinPreparacion = varianteIds.every((id) => requierePreparacionPorVariante[id] === false);

    // Si viene un cliente de lealtad, debe existir ANTES de insertar la
    // orden (que lo referencia por FK) — si no, Postgres rechazaría el
    // INSERT con un error de llave foránea genérico en vez de este 400
    // claro. El cómputo completo de visita/descuento (que sí necesita el
    // subtotal) vive más abajo, en la sección 4.
    if (cliente_id) {
      const clienteExiste = await client.query(`SELECT 1 FROM clientes WHERE id = $1`, [cliente_id]);
      if (clienteExiste.rows.length === 0) {
        throw {
          status: 400,
          mensaje: 'El cliente de lealtad seleccionado no existe.',
        };
      }
    }

    // Mismo criterio: si viene un repartidor, debe existir y estar activo
    // ANTES de insertar la orden (que lo referencia por FK).
    if (repartidorId) {
      const repartidorExiste = await client.query(
        `SELECT 1 FROM empleados WHERE id = $1 AND activo = TRUE AND puesto ILIKE '%repartidor%'`,
        [repartidorId],
      );
      if (repartidorExiste.rows.length === 0) {
        throw {
          status: 400,
          mensaje: 'El repartidor seleccionado no existe o no está activo.',
        };
      }
    }

    // ---- 2) La orden (la comanda que verá la cocina) ----------------------
    // Nace en 'sin_preparar' (Sprint 2): aparece de inmediato en el tablero
    // de comandas. EXCEPCIÓN (2026-10-19): si TODOS sus productos tienen
    // requiere_preparacion = FALSE, nace directo en 'por_entregar' — nunca
    // pasa por el tablero de cocina (ver sección 1 y 3.5). `creado_por`
    // guarda quién la registró (viene del token).
    const estadoInicial = todosSinPreparacion ? 'por_entregar' : 'sin_preparar';
    const orden = await client.query(
      `INSERT INTO ordenes
         (numero_orden, cliente_id, tipo_entrega, estado, creado_por,
          cliente_nombre, cliente_direccion, cliente_telefono, repartidor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        generarNumeroOrden(),
        cliente_id || null,
        tipo_entrega,
        estadoInicial,
        req.usuario.id,
        clienteNombre,
        clienteDireccion,
        clienteTelefono,
        repartidorId,
      ],
    );

    // RF-08: abre el primer renglón de tiempo por estado, que
    // routes/ordenes.js irá cerrando y reabriendo en cada avance. Si la
    // orden nació directo en 'por_entregar' (sección 1), nunca pasó de
    // verdad por 'sin_preparar'/'preparando' — se abre el renglón del
    // estado real en el que nació, para no inventar tiempos de estados
    // que esta orden nunca tuvo.
    await client.query(
      `INSERT INTO orden_estado_historial (orden_id, estado, fecha_inicio, responsable_id)
       VALUES ($1, $2, NOW(), $3)`,
      [orden.rows[0].id, estadoInicial, req.usuario.id],
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
        [orden.rows[0].id, item.variante_id, cantidad, precioUnitario, item.notas || null],
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
          [detalle.rows[0].id, insumo.rows[0].id],
        );
      }

      // Y los insumos ELEGIDOS (salsa/topping/dip): no están en la receta fija
      // de la variante (esa línea se dejó fuera a propósito), así que aquí sí
      // se guarda también la cantidad — es la única fuente de esa cantidad
      // para cuando se descuente el inventario.
      //
      // RF-16 (2026-10-13): si el insumo elegido tiene costo_extra (ej.
      // "cacahuate diferente" +$5), se suma al subtotal — escalado por la
      // cantidad del renglón (2 Pepihuates con el mismo extra = 2× el
      // cargo), igual que ya escala la cantidad del insumo descontado. El
      // cargo se resuelve aquí, del lado del servidor, buscando el insumo
      // por nombre — nunca viene un precio del cliente. Se congela en
      // costo_extra_aplicado para que esta venta conserve lo cobrado aunque
      // el costo_extra del insumo cambie después.
      for (const elegido of item.insumos_elegidos || []) {
        const insumo = await client.query('SELECT id, costo_extra FROM insumos WHERE nombre = $1', [elegido.insumo]);
        if (insumo.rows.length === 0) {
          continue;
        }
        const costoExtraUnitario = Number(insumo.rows[0].costo_extra) || 0;
        const costoExtraAplicado = costoExtraUnitario > 0 ? costoExtraUnitario * cantidad : null;
        if (costoExtraAplicado) {
          subtotal += costoExtraAplicado;
        }
        await client.query(
          `INSERT INTO orden_detalle_insumos
             (orden_detalle_id, insumo_id, tipo, cantidad, unidad_medida, costo_extra_aplicado)
           VALUES ($1, $2, 'elegido', $3, $4, $5)`,
          [detalle.rows[0].id, insumo.rows[0].id, elegido.cantidad, elegido.unidad_medida, costoExtraAplicado],
        );
      }
    }

    // ---- 3.5) Descuento inmediato para productos sin preparación ----------
    // (2026-10-19) Esta orden nació directo en 'por_entregar' (sección 2) —
    // nunca va a pasar por el PATCH /api/ordenes/:id/estado que normalmente
    // dispara el descuento de inventario al entrar a 'preparando' (ver
    // routes/ordenes.js). Se descuenta AQUÍ, con el mismo mecanismo
    // (calcularInsumosDeOrden + registrarMovimientosInventario), para que
    // una bebida embotellada o una botana de bolsa sí reste su inventario
    // aunque la comanda nunca "entre a cocina". Se corre DESPUÉS del ciclo
    // de arriba porque calcularInsumosDeOrden lee orden_detalle y
    // orden_detalle_insumos, que recién se acaban de insertar.
    if (todosSinPreparacion) {
      const insumosOrden = await calcularInsumosDeOrden(client, orden.rows[0].id);
      await registrarMovimientosInventario(client, insumosOrden, {
        tipo: 'salida',
        responsableId: req.usuario.id,
        motivo: `Venta ${orden.rows[0].numero_orden}`,
        ordenId: orden.rows[0].id,
      });
    }

    // ---- 4) Lealtad (RF-21/RF-22, 2026-10-15) -----------------------------
    // Solo si el cobro trae un cliente_id (opcional — "cliente ocasional" no
    // participa). Reglas de negocio (ver cabecera de routes/clientes.js):
    // 1 visita/cliente/día, solo si el subtotal >= $100; ciclo de 10
    // visitas que se reinicia (visita #5 del ciclo = 5%, #10 = 15% y
    // vuelve a 0). El cálculo vive AQUÍ, no en clientes.js, porque es
    // aquí donde se conoce el subtotal real de ESTA compra.
    let descuentoLealtad = 0;
    let infoLealtad = null;
    // Ciclo de lealtad a mostrar en el ticket (2026-10-17, ver "potenciar
    // ticket" más abajo): el número de visita del ciclo DESPUÉS de esta
    // compra, para que el comprobante siempre pueda dibujar el avance
    // "X de 10" aunque esta compra en particular no haya contado una
    // visita nueva (ej. segunda compra del mismo cliente el mismo día).
    let visitasLealtadParaTicket = null;
    if (cliente_id) {
      // FOR UPDATE: dos cobros simultáneos del mismo cliente no pueden
      // pisarse el contador de visitas.
      const clienteFila = await client.query(`SELECT id, visitas_acumuladas FROM clientes WHERE id = $1 FOR UPDATE`, [
        cliente_id,
      ]);
      if (clienteFila.rows.length === 0) {
        throw {
          status: 400,
          mensaje: 'El cliente de lealtad seleccionado no existe.',
        };
      }
      const visitasActuales = clienteFila.rows[0].visitas_acumuladas;
      visitasLealtadParaTicket = visitasActuales;

      const yaVisitoHoy = await client.query(
        `SELECT 1 FROM lealtad_historial
           WHERE cliente_id = $1 AND tipo_evento = 'visita'
             AND ${diaNegocioSql('fecha')} = $2
           LIMIT 1`,
        [cliente_id, fechaHoyNegocio()],
      );

      if (yaVisitoHoy.rows.length === 0 && subtotal >= 100) {
        const visitaNumero = visitasActuales + 1;
        let descuentoPorcentaje = 0;
        let nuevasVisitas = visitaNumero;
        let descripcionDescuento = null;

        if (visitaNumero === 10) {
          descuentoPorcentaje = 0.15;
          nuevasVisitas = 0;
          descripcionDescuento = '15% por completar el ciclo de 10 visitas';
        } else if (visitaNumero === 5) {
          descuentoPorcentaje = 0.05;
          descripcionDescuento = '5% por llegar a 5 visitas del ciclo';
        }

        descuentoLealtad = Math.round(subtotal * descuentoPorcentaje * 100) / 100;

        infoLealtad = {
          cliente_id,
          visitaNumero,
          nuevasVisitas,
          descripcionDescuento,
        };
        visitasLealtadParaTicket = nuevasVisitas;
      }
    }

    // ---- 5) El cobro --------------------------------------------------------
    const total = subtotal - descuentoLealtad;

    const venta = await client.query(
      `INSERT INTO ventas (orden_id, subtotal, descuento_lealtad, total, metodo_pago, cajero_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orden.rows[0].id, subtotal, descuentoLealtad, total, metodo_pago, req.usuario.id],
    );

    // Se registra la visita (y, si aplica, el descuento) ya con el id real
    // de la venta — después de insertarla, para poder ligarlos.
    if (infoLealtad) {
      await client.query(`UPDATE clientes SET visitas_acumuladas = $1 WHERE id = $2`, [
        infoLealtad.nuevasVisitas,
        infoLealtad.cliente_id,
      ]);
      await client.query(
        `INSERT INTO lealtad_historial (cliente_id, venta_id, tipo_evento, descripcion, visita_numero)
           VALUES ($1, $2, 'visita', $3, $4)`,
        [
          infoLealtad.cliente_id,
          venta.rows[0].id,
          `Visita #${infoLealtad.visitaNumero} del ciclo`,
          infoLealtad.visitaNumero,
        ],
      );
      if (infoLealtad.descripcionDescuento) {
        await client.query(
          `INSERT INTO lealtad_historial (cliente_id, venta_id, tipo_evento, descripcion)
             VALUES ($1, $2, 'descuento_aplicado', $3)`,
          [infoLealtad.cliente_id, venta.rows[0].id, infoLealtad.descripcionDescuento],
        );
      }
    }

    // Todo salió bien: se confirman todas las escrituras a la vez.
    await client.query('COMMIT');

    res.status(201).json({
      orden: orden.rows[0],
      venta: venta.rows[0],
      // Solo informativo para el ticket (avance del ciclo "X de 10"); el
      // descuento real ya vive en venta.descuento_lealtad, esto nunca se
      // vuelve a usar para calcular dinero.
      visitas_lealtad: visitasLealtadParaTicket,
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

const ESTADOS_VENTA_VALIDOS = ['completada', 'cancelada'];
const METODOS_PAGO_VALIDOS = ['efectivo', 'transferencia'];
const TIPOS_ENTREGA_VALIDOS = ['presencial', 'domicilio'];

// GET /api/ventas?desde=&hasta=&estado=&metodo_pago=&tipo_entrega=&buscar=
// Consulta de tickets con sus productos, más recientes primero. Todos los
// filtros son opcionales y combinables; sin ninguno, TODO el histórico
// (mismo criterio que mermas/ventas-especiales — ver nota de cabecera del
// archivo, "2026-10-22: de 'Ventas de hoy' a 'Ventas'"). `desde`/`hasta`
// comparan contra el día del negocio en hora de Durango (utils/fecha.js),
// igual que ya hacen caja (cortes) y mermas. `buscar` encuentra un ticket
// por folio, cajero, cliente (lealtad o domicilio, nombre o teléfono) o por
// el nombre de un producto/variante vendido en esa orden. Es información
// financiera: solo administrador y encargado (RNF-03).
router.get('/', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { desde, hasta, estado, metodo_pago, tipo_entrega, buscar } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (estado && !ESTADOS_VENTA_VALIDOS.includes(estado)) {
    return res.status(400).json({
      error: `El estado debe ser uno de: ${ESTADOS_VENTA_VALIDOS.join(', ')}.`,
    });
  }
  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({
      error: `El método de pago debe ser uno de: ${METODOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }
  if (tipo_entrega && !TIPOS_ENTREGA_VALIDOS.includes(tipo_entrega)) {
    return res.status(400).json({
      error: `El tipo de entrega debe ser uno de: ${TIPOS_ENTREGA_VALIDOS.join(', ')}.`,
    });
  }

  const busquedaTexto = buscar?.trim() || null;

  try {
    // Consulta 1: las ventas que cumplen los filtros, con datos de su orden,
    // el cajero, —si fue cancelada— quién la canceló (LEFT JOIN: solo existe
    // en canceladas), y cuántas mermas (y cuántos pesos) generó esa
    // cancelación (0 en una venta no cancelada).
    const ventas = await pool.query(
      `SELECT v.*, o.id AS orden_id, o.numero_orden, o.tipo_entrega, o.estado AS estado_orden,
              o.cliente_nombre, o.cliente_direccion, o.cliente_telefono,
              c.nombre_completo AS cliente_lealtad_nombre,
              e.nombre AS repartidor_nombre,
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
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN empleados e ON e.id = o.repartidor_id
       WHERE ($1::date IS NULL OR ${diaNegocioSql('v.fecha')} >= $1::date)
         AND ($2::date IS NULL OR ${diaNegocioSql('v.fecha')} <= $2::date)
         AND ($3::text IS NULL OR v.estado = $3)
         AND ($4::text IS NULL OR v.metodo_pago = $4)
         AND ($5::text IS NULL OR o.tipo_entrega = $5)
         AND (
           $6::text IS NULL
           OR o.numero_orden ILIKE '%' || $6 || '%'
           OR u.nombre ILIKE '%' || $6 || '%'
           OR c.nombre_completo ILIKE '%' || $6 || '%'
           OR o.cliente_nombre ILIKE '%' || $6 || '%'
           OR o.cliente_telefono ILIKE '%' || $6 || '%'
           OR EXISTS (
             SELECT 1 FROM orden_detalle od2
             JOIN variantes_producto vp2 ON vp2.id = od2.variante_id
             JOIN productos p2 ON p2.id = vp2.producto_id
             WHERE od2.orden_id = o.id
               AND (p2.nombre ILIKE '%' || $6 || '%' OR vp2.nombre ILIKE '%' || $6 || '%')
           )
         )
       ORDER BY v.fecha DESC`,
      [desde || null, hasta || null, estado || null, metodo_pago || null, tipo_entrega || null, busquedaTexto],
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
      [ordenIds],
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
      throw {
        status: 404,
        mensaje: 'La venta no existe o ya fue cancelada.',
      };
    }

    const ordenId = venta.rows[0].orden_id;

    // Estado de la orden ANTES de tocar nada: decide qué pasa con los
    // insumos (rescate selectivo, merma automática, o nada que descontar).
    const ordenActual = await client.query(
      `SELECT estado, numero_orden, cliente_id FROM ordenes WHERE id = $1 FOR UPDATE`,
      [ordenId],
    );
    const { estado: estadoOrden, numero_orden: numeroOrden, cliente_id: clienteLealtadId } = ordenActual.rows[0];

    // Líneas activas (no canceladas todavía) de la orden — son las únicas
    // candidatas a cancelar ahora.
    const lineasActivas = await client.query(
      `SELECT id, variante_id, cantidad, precio_unitario
       FROM orden_detalle WHERE orden_id = $1 AND cancelado = FALSE`,
      [ordenId],
    );
    if (lineasActivas.rows.length === 0) {
      throw {
        status: 409,
        mensaje: 'Esta venta ya no tiene productos activos que cancelar.',
      };
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
      throw {
        status: 400,
        mensaje: 'Selecciona al menos un producto para cancelar.',
      };
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
        ],
      );
      await client.query(
        `UPDATE orden_detalle SET cancelado = TRUE, fecha_cancelacion = NOW(), motivo_cancelacion = $2 WHERE id = $1`,
        [linea.id, motivo || null],
      );
    }

    // ---- INSUMOS: rescate selectivo (preparando), merma automática (por_entregar/
    // entregado), o nada que hacer (sin_preparar — nunca se descontó) ----
    let insumosRestituidos = 0;
    if (estadoOrden === 'preparando') {
      const insumosDescontados = await calcularInsumosDeLineas(
        client,
        lineasACancelar.map((l) => l.id),
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
    //
    // NOTA (2026-10-19): una orden de productos SIN preparación (ver sección
    // "3.5" de POST /, arriba) nace directo en 'por_entregar' — si se
    // cancela, cae en esta misma rama ("ya está armado", merma automática
    // completa, sin checklist de rescate). Es una simplificación a
    // propósito: aunque técnicamente una bebida embotellada sin abrir SÍ
    // podría regresar al inventario, construir una tercera rama de
    // cancelación solo para este caso quedó fuera de alcance — se puede
    // revisar si en la práctica resulta molesto.

    // ---- ¿Queda alguna línea activa? Si no, la venta y la orden se cancelan
    // por completo (igual que antes de este ajuste) ----
    const lineasRestantes = lineasActivas.rows.length - lineasACancelar.length;
    if (lineasRestantes === 0) {
      await client.query(
        `UPDATE ventas SET estado = 'cancelada', cancelado_por = $1, motivo_cancelacion = $2, fecha_cancelacion = NOW()
         WHERE id = $3`,
        [req.usuario.id, motivo || null, id],
      );
      await client.query(`UPDATE ordenes SET estado = 'cancelada' WHERE id = $1`, [ordenId]);
      // RF-08: se cierra el renglón de historial que seguía abierto.
      await client.query(
        `UPDATE orden_estado_historial SET fecha_fin = NOW() WHERE orden_id = $1 AND fecha_fin IS NULL`,
        [ordenId],
      );
    }
    // Si quedan líneas activas, la venta sigue 'completada' y la comanda sigue
    // su curso normal con lo que le queda — solo se le quitaron productos.

    // ---- RF-23 / LEALTAD: revertir la visita (y el descuento, si lo hubo)
    // que esta venta le dio a su cliente — "no se toma en cuenta para los
    // puntos" (confirmado en la entrevista con la titular). Solo aplica si
    // la cancelación es TOTAL: una cancelación PARCIAL deja la venta
    // 'completada' con algo de dinero cobrado, y el subtotal original
    // (ventas.subtotal nunca se recalcula) ya no refleja con certeza si
    // seguiría calificando para la visita — se deja fuera a propósito en
    // vez de adivinar.
    //
    // Asume que la cancelación ocurre el MISMO día de la venta (la
    // titular confirmó en la entrevista que así se cancela siempre, "hasta
    // el final del día, para no perjudicar el corte") — si se cancelara
    // días después y el cliente ya hubiera acumulado visitas nuevas
    // encima, esta reversión simple (−1, o volver a 9 si deshace el
    // reinicio del ciclo) podría quedar desfasada; en ese caso excepcional
    // hay que ajustar `clientes.visitas_acumuladas` a mano.
    let lealtadRevertida = false;
    if (lineasRestantes === 0 && clienteLealtadId) {
      const visitaLealtad = await client.query(
        `SELECT id, visita_numero FROM lealtad_historial
           WHERE venta_id = $1 AND tipo_evento = 'visita'
           LIMIT 1`,
        [id],
      );
      if (visitaLealtad.rows.length > 0) {
        lealtadRevertida = true;
        const visitaNumero = visitaLealtad.rows[0].visita_numero;
        const nuevasVisitas = visitaNumero === 10 ? 9 : Math.max(visitaNumero - 1, 0);
        await client.query(`UPDATE clientes SET visitas_acumuladas = $1 WHERE id = $2`, [
          nuevasVisitas,
          clienteLealtadId,
        ]);
        // Se borran ambas filas (visita + descuento_aplicado, si hubo) —
        // "no se toma en cuenta", no queda un registro de algo que ya no
        // ocurrió.
        await client.query(`DELETE FROM lealtad_historial WHERE venta_id = $1`, [id]);
      }
    }

    // ---- REEMBOLSO: lo que se le debe devolver al cliente por LO CANCELADO
    // EN ESTA OPERACIÓN (nunca el total completo de la venta, por si ya hubo
    // una cancelación parcial anterior) — movimiento de caja, mismo mecanismo
    // que un retiro (resta del efectivo esperado), ligado a la orden. ----
    if (valorTotalMerma > 0) {
      await client.query(
        `INSERT INTO movimientos_caja (tipo, monto, motivo, responsable_id, confirmado, confirmado_por, fecha_confirmacion, orden_id)
         VALUES ('reembolso', $1, $2, $3, TRUE, $3, NOW(), $4)`,
        [valorTotalMerma, `Reembolso por cancelación — orden ${numeroOrden}`, req.usuario.id, ordenId],
      );
    }

    // Se vuelve a leer la venta (puede haber cambiado de estado arriba) para
    // que la respuesta refleje su estado REAL, no la foto de antes de cancelar.
    const ventaFinal = await client.query('SELECT * FROM ventas WHERE id = $1', [id]);

    await client.query('COMMIT');

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'cancelar_venta',
      detalle: `Orden ${numeroOrden} — ${lineasACancelar.length} producto(s), ${
        lineasRestantes === 0 ? 'total' : 'parcial'
      }. ${motivo ? `Motivo: ${motivo}` : 'Sin motivo.'}`,
    });

    res.json({
      ...ventaFinal.rows[0],
      cancelacion_total: lineasRestantes === 0,
      productos_cancelados: lineasACancelar.length,
      mermas_generadas: lineasACancelar.length,
      mermas_valor_total: valorTotalMerma.toFixed(2),
      insumos_restituidos: insumosRestituidos,
      monto_reembolso: valorTotalMerma.toFixed(2),
      lealtad_revertida: lealtadRevertida,
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

// =============================================================================
// ELIMINAR HISTORIAL (2026-10-29) — acción de alto riesgo, solo administrador
// =============================================================================
// DELETE /api/ventas/historial?desde=&hasta=
// Borra TODAS las ventas y sus órdenes cuyo día del negocio caiga dentro del
// rango [desde, hasta] (ambos obligatorios) — irreversible, sin confirmación
// adicional del servidor (la confirmación vive en el frontend).
//
// Las filas de OTROS módulos que referencian estas órdenes/ventas (mermas,
// movimientos de caja, movimientos de inventario, historial de lealtad) NO
// se borran aquí: se DESLIGAN (su orden_id/venta_id queda en NULL) para que
// ese historial siga existiendo bajo su propio botón "Eliminar historial" en
// su propia pantalla — borrar Ventas no debe borrar Caja/Inventario/Mermas
// por sorpresa.
router.delete('/historial', requiereRol('administrador'), async (req, res) => {
  const { desde, hasta } = req.query;

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Debes indicar un rango de fechas (desde y hasta).' });
  }
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (hasta < desde) {
    return res.status(400).json({ error: 'La fecha "hasta" no puede ser anterior a "desde".' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const filas = await client.query(
      `SELECT v.id AS venta_id, o.id AS orden_id
       FROM ventas v
       JOIN ordenes o ON o.id = v.orden_id
       WHERE ${diaNegocioSql('v.fecha')} >= $1::date
         AND ${diaNegocioSql('v.fecha')} <= $2::date`,
      [desde, hasta],
    );
    const ventaIds = filas.rows.map((f) => f.venta_id);
    const ordenIds = filas.rows.map((f) => f.orden_id);

    if (ventaIds.length > 0) {
      await client.query(`UPDATE lealtad_historial SET venta_id = NULL WHERE venta_id = ANY($1::int[])`, [ventaIds]);
      await client.query(`UPDATE movimientos_caja SET orden_id = NULL WHERE orden_id = ANY($1::int[])`, [ordenIds]);
      await client.query(`UPDATE movimientos_inventario SET orden_id = NULL WHERE orden_id = ANY($1::int[])`, [
        ordenIds,
      ]);
      await client.query(`UPDATE mermas SET orden_id = NULL WHERE orden_id = ANY($1::int[])`, [ordenIds]);

      await client.query(
        `DELETE FROM orden_detalle_insumos
         WHERE orden_detalle_id IN (SELECT id FROM orden_detalle WHERE orden_id = ANY($1::int[]))`,
        [ordenIds],
      );
      await client.query(`DELETE FROM orden_detalle WHERE orden_id = ANY($1::int[])`, [ordenIds]);
      await client.query(`DELETE FROM orden_estado_historial WHERE orden_id = ANY($1::int[])`, [ordenIds]);
      await client.query(`DELETE FROM ventas WHERE id = ANY($1::int[])`, [ventaIds]);
      await client.query(`DELETE FROM ordenes WHERE id = ANY($1::int[])`, [ordenIds]);
    }

    await client.query('COMMIT');

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'eliminar_historial',
      detalle: `Ventas: ${ventaIds.length} venta(s) del ${desde} al ${hasta}.`,
    });

    res.json({ eliminados: ventaIds.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el historial de ventas.' });
  } finally {
    client.release();
  }
});

module.exports = router;
