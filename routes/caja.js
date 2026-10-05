// =============================================================================
// routes/caja.js — RESUMEN DE CAJA, CORTES Y MOVIMIENTOS (Sprint 1, RF-04)
// =============================================================================
// Endpoints (prefijo /api/caja), todos exigen sesión:
//   GET   /resumen?fecha=     → lo que el SISTEMA calcula que debería haber
//                               (administrador, encargado, cajero)
//   POST  /corte              → guarda el corte comparando contado vs. sistema
//                               (administrador, encargado, cajero)
//   GET   /cortes?desde=&hasta=&responsable_id=
//                             → historial de cortes con filtros
//                               (administrador, encargado)
//   POST  /movimientos        → registrar apertura/ingreso/retiro de efectivo
//                               (apertura e ingreso: administrador, encargado,
//                               cajero — mismos roles que usan el POS; retiro:
//                               SOLO administrador, y no puede exceder el
//                               efectivo disponible hoy — ver validación abajo)
//   GET   /movimientos?fecha= → historial de movimientos del día
//                               (administrador, encargado)
//   GET   /retiros-pendientes → retiros de HOY sin confirmar (para que el POS
//                               haga polling y le avise al cajero)
//                               (administrador, encargado, cajero)
//   PATCH /movimientos/:id/confirmar
//                             → el cajero confirma un retiro (dispara el
//                               comprobante imprimible en el POS)
//                               (administrador, encargado, cajero)
//
// IDEA DEL CORTE (RF-04)
//   Al cerrar, el cajero cuenta el dinero físico. El sistema suma las ventas
//   'completada' del día por método de pago MÁS los movimientos de efectivo
//   que no son ventas (apertura + ingresos − retiros — ver más abajo). La
//   DIFERENCIA (contado - sistema) se guarda junto con el corte: positiva =
//   sobra dinero, negativa = falta. El total del sistema SIEMPRE lo calcula
//   el servidor; el cliente nunca lo envía, así no se puede "acomodar" el corte.
//
// MOVIMIENTOS DE CAJA (apertura / ingreso / retiro / reembolso)
//   Dinero que entra o sale del cajón físico SIN ser una venta: el saldo
//   inicial con el que arranca el turno (apertura), efectivo que entra por
//   fuera de una venta normal —ej. se cobra una orden que había quedado sin
//   cobrar— (ingreso), y dinero que el administrador saca para pagar
//   proveedores o comprar insumos en el día (retiro). Solo el administrador
//   puede registrar un retiro; el cajero lo confirma del lado del POS
//   (GET /retiros-pendientes + PATCH /confirmar) y ahí se le imprime su
//   comprobante — es su respaldo de que ese dinero salió con autorización.
//   'reembolso' es distinto a los otros tres: NO se crea aquí ni por
//   POST /movimientos (ese endpoint solo acepta apertura/ingreso/retiro) —
//   lo genera automáticamente routes/ventas.js al cancelar parte o toda una
//   venta, ligado a la orden (`orden_id`), y nace ya confirmado (no pasa por
//   el POS como el retiro).
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaHoyNegocio, diaNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);

// Roles que operan el POS: son los únicos que tiene sentido que registren
// una apertura o un ingreso (el movimiento nace en su propia sesión).
const ROLES_CAJA = ['administrador', 'encargado', 'cajero'];

// Totales del sistema por método de pago para un día del negocio.
// Solo suma ventas 'completada': las canceladas no cuentan para caja.
// Devuelve siempre { efectivo, transferencia } (0 si no hubo ventas de ese tipo).
async function totalesDelDia(fecha) {
  const resultado = await pool.query(
    `SELECT metodo_pago, COALESCE(SUM(total), 0) AS total
     FROM ventas
     WHERE estado = 'completada' AND ${diaNegocioSql('fecha')} = $1
     GROUP BY metodo_pago`,
    [fecha]
  );

  const totales = { efectivo: 0, transferencia: 0 };
  for (const fila of resultado.rows) {
    totales[fila.metodo_pago] = Number(fila.total);
  }
  return totales;
}

// Suma de movimientos de caja (no-venta) del día, por tipo. Un retiro cuenta
// aunque todavía no lo haya confirmado el cajero: ya salió del cajón físico
// en cuanto el administrador lo registra, la confirmación solo es el aviso
// y el comprobante — no condiciona si se descuenta del total del sistema.
async function movimientosCajaDelDia(fecha) {
  const resultado = await pool.query(
    `SELECT tipo, COALESCE(SUM(monto), 0) AS total
     FROM movimientos_caja
     WHERE ${diaNegocioSql('fecha')} = $1
     GROUP BY tipo`,
    [fecha]
  );

  const totales = { apertura: 0, ingreso: 0, retiro: 0, reembolso: 0 };
  for (const fila of resultado.rows) {
    totales[fila.tipo] = Number(fila.total);
  }
  return totales;
}

// Resumen completo de un día: ventas + movimientos de caja, ya combinados en
// lo que el sistema espera encontrar físicamente. La usan /resumen y /corte,
// para que ambos calculen exactamente lo mismo.
//
// REEMBOLSOS (cancelación parcial o total de una venta, ver routes/ventas.js):
// `ventas.total` de una venta parcialmente cancelada NUNCA se modifica (sigue
// siendo lo que se cobró originalmente, íntegro) — por eso `ventas_efectivo`
// de abajo incluye ese monto completo, y es el reembolso quien lo resta aquí.
// Si se restara en los dos lados a la vez quedaría descontado por partida
// doble; restando solo aquí queda correcto sin tocar el histórico de ventas.
async function resumenCajaDelDia(fecha) {
  const ventas = await totalesDelDia(fecha);
  const movimientos = await movimientosCajaDelDia(fecha);
  const totalEfectivo =
    ventas.efectivo + movimientos.apertura + movimientos.ingreso - movimientos.retiro - movimientos.reembolso;

  return {
    ventas_efectivo: ventas.efectivo,
    apertura: movimientos.apertura,
    ingresos_efectivo: movimientos.ingreso,
    retiros_efectivo: movimientos.retiro,
    reembolsos_efectivo: movimientos.reembolso,
    total_efectivo: totalEfectivo,
    total_transferencia: ventas.transferencia,
    total_sistema: totalEfectivo + ventas.transferencia,
  };
}

// GET /api/caja/resumen?fecha=YYYY-MM-DD
// Calcula, en tiempo real, cuánto debería haber en caja según el sistema
// (RF-04), sin guardar nada todavía. Sirve para que el cajero compare
// contra lo que cuenta físicamente antes de cerrar el turno.
// Sin `fecha`, usa el día actual del negocio (hora de Durango).
router.get('/resumen', requiereRol('administrador', 'encargado', 'cajero'), async (req, res) => {
  const fecha = req.query.fecha || fechaHoyNegocio();

  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }

  try {
    const resumen = await resumenCajaDelDia(fecha);
    res.json({ fecha, ...resumen });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al calcular el resumen de caja.' });
  }
});

// POST /api/caja/corte
// Guarda el corte de caja del día, comparando lo contado físicamente
// contra lo que el sistema esperaba (RF-04).
// Cuerpo: { total_efectivo_contado, total_transferencia_contado, fecha?, turno? }
// Nota: no se limita a un corte por día (puede haber uno por turno).
router.post('/corte', requiereRol('administrador', 'encargado', 'cajero'), async (req, res) => {
  const { fecha, turno, total_efectivo_contado, total_transferencia_contado } = req.body;

  // Ambos montos contados son obligatorios (0 es válido: por eso se compara
  // con null y no con "falsy").
  if (total_efectivo_contado == null || total_transferencia_contado == null) {
    return res.status(400).json({ error: 'Debes indicar el efectivo y la transferencia contados.' });
  }

  const fechaCorte = fecha || fechaHoyNegocio();

  if (!fechaValida(fechaCorte)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }

  try {
    // El sistema recalcula sus totales en este mismo momento (ventas +
    // apertura/ingresos/retiros del día — ver resumenCajaDelDia arriba).
    const { total_sistema: totalSistema } = await resumenCajaDelDia(fechaCorte);
    const totalContado = Number(total_efectivo_contado) + Number(total_transferencia_contado);
    // > 0 sobra dinero, < 0 falta dinero, 0 cuadra exacto.
    const diferencia = totalContado - totalSistema;

    // Se guardan los montos CONTADOS por el cajero (total_efectivo /
    // total_transferencia), lo que esperaba el sistema (total_sistema), la
    // diferencia y quién hizo el corte (responsable_id, tomado del token).
    const resultado = await pool.query(
      `INSERT INTO cortes_caja (fecha, turno, total_efectivo, total_transferencia, total_sistema, diferencia, responsable_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [fechaCorte, turno || null, total_efectivo_contado, total_transferencia_contado, totalSistema, diferencia, req.usuario.id]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al guardar el corte de caja.' });
  }
});

// GET /api/caja/cortes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&responsable_id=N
// Historial de cortes ya guardados; los tres filtros son opcionales y se
// combinan. Solo administrador y encargado.
router.get('/cortes', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { desde, hasta, responsable_id } = req.query;

  // Se validan los filtros que lleguen; los ausentes se ignoran.
  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (responsable_id && !/^\d+$/.test(responsable_id)) {
    return res.status(400).json({ error: 'El usuario indicado no es válido.' });
  }

  try {
    // `fecha` sale como texto (AAAA-MM-DD) a propósito: una columna DATE
    // que el driver convierte a Date se corre un día según la zona horaria
    // del servidor.
    // Patrón de filtros opcionales: `($1 IS NULL OR condición)` hace que un
    // filtro no enviado (NULL) no restrinja nada, y así una sola consulta
    // sirve para cualquier combinación de filtros.
    const resultado = await pool.query(
      `SELECT cc.id, to_char(cc.fecha, 'YYYY-MM-DD') AS fecha, cc.turno,
              cc.total_efectivo, cc.total_transferencia, cc.total_sistema,
              cc.diferencia, cc.responsable_id, u.nombre AS responsable
       FROM cortes_caja cc
       JOIN usuarios u ON u.id = cc.responsable_id
       WHERE ($1::date IS NULL OR cc.fecha >= $1::date)
         AND ($2::date IS NULL OR cc.fecha <= $2::date)
         AND ($3::int IS NULL OR cc.responsable_id = $3::int)
       ORDER BY cc.fecha DESC, cc.id DESC`,
      [desde || null, hasta || null, responsable_id || null]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el historial de cortes.' });
  }
});

// POST /api/caja/movimientos
// Registra un movimiento de efectivo que NO es una venta.
// Cuerpo: { tipo: 'apertura' | 'ingreso' | 'retiro', monto, motivo? }.
// 'retiro' exige rol administrador aunque ROLES_CAJA ya haya dejado pasar la
// petición — se valida aquí porque el permiso depende del VALOR del campo
// `tipo`, no solo de la ruta.
router.post('/movimientos', requiereRol(...ROLES_CAJA), async (req, res) => {
  const { tipo, monto, motivo } = req.body;

  if (!['apertura', 'ingreso', 'retiro'].includes(tipo)) {
    return res.status(400).json({ error: 'El tipo de movimiento no es válido.' });
  }
  if (tipo === 'retiro' && req.usuario.rol !== 'administrador') {
    return res.status(403).json({ error: 'Solo el administrador puede registrar retiros de efectivo.' });
  }

  const montoNum = Number(monto);
  if (!montoNum || montoNum <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
  }
  // El retiro es dinero saliendo sin que una venta lo respalde: el motivo es
  // obligatorio para que quede auditado por qué salió (proveedor, insumos…).
  if (tipo === 'retiro' && !motivo?.trim()) {
    return res.status(400).json({ error: 'El motivo del retiro es obligatorio.' });
  }

  try {
    // Un retiro no puede dejar la caja en negativo: se valida contra el
    // efectivo que el sistema calcula que hay HOY (ventas en efectivo +
    // apertura + ingresos − retiros ya registrados — ver resumenCajaDelDia).
    // Los movimientos siempre nacen con fecha = NOW() (columna DEFAULT), así
    // que un retiro de hoy siempre compite por el efectivo de hoy.
    if (tipo === 'retiro') {
      const { total_efectivo: efectivoDisponible } = await resumenCajaDelDia(fechaHoyNegocio());
      if (montoNum > efectivoDisponible) {
        return res.status(400).json({
          error: `No hay suficiente efectivo en caja para ese retiro. Disponible: $${efectivoDisponible.toFixed(2)}.`,
          efectivo_disponible: efectivoDisponible,
        });
      }
    }

    // Apertura e ingreso los registra la misma persona que está en el POS en
    // ese momento: nacen confirmados. Un retiro lo registra el administrador
    // pero lo confirma el cajero del lado del POS (ver /retiros-pendientes y
    // PATCH /movimientos/:id/confirmar) — nace SIN confirmar.
    const confirmado = tipo !== 'retiro';
    const resultado = await pool.query(
      `INSERT INTO movimientos_caja (tipo, monto, motivo, responsable_id, confirmado, confirmado_por, fecha_confirmacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tipo,
        montoNum,
        motivo?.trim() || null,
        req.usuario.id,
        confirmado,
        confirmado ? req.usuario.id : null,
        confirmado ? new Date() : null,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el movimiento de caja.' });
  }
});

// GET /api/caja/movimientos?fecha=YYYY-MM-DD
// Historial de movimientos de caja (apertura/ingreso/retiro) de un día.
// Solo administrador y encargado, igual que el historial de cortes.
router.get('/movimientos', requiereRol('administrador', 'encargado'), async (req, res) => {
  const fecha = req.query.fecha || fechaHoyNegocio();

  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }

  try {
    const resultado = await pool.query(
      `SELECT mc.id, mc.tipo, mc.monto, mc.motivo, mc.fecha, mc.confirmado,
              u.nombre AS responsable, uc.nombre AS confirmado_por_nombre
       FROM movimientos_caja mc
       JOIN usuarios u ON u.id = mc.responsable_id
       LEFT JOIN usuarios uc ON uc.id = mc.confirmado_por
       WHERE ${diaNegocioSql('mc.fecha')} = $1
       ORDER BY mc.fecha DESC`,
      [fecha]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los movimientos de caja.' });
  }
});

// GET /api/caja/retiros-pendientes
// Retiros de HOY que el administrador ya registró pero el cajero todavía no
// confirma en el POS. El POS hace polling de este endpoint (igual que el
// tablero de comandas) para avisar en pantalla en cuanto aparece uno nuevo.
router.get('/retiros-pendientes', requiereRol(...ROLES_CAJA), async (req, res) => {
  try {
    const fecha = fechaHoyNegocio();
    const resultado = await pool.query(
      `SELECT mc.id, mc.monto, mc.motivo, mc.fecha, u.nombre AS responsable
       FROM movimientos_caja mc
       JOIN usuarios u ON u.id = mc.responsable_id
       WHERE mc.tipo = 'retiro' AND mc.confirmado = FALSE AND ${diaNegocioSql('mc.fecha')} = $1
       ORDER BY mc.fecha ASC`,
      [fecha]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los retiros pendientes.' });
  }
});

// PATCH /api/caja/movimientos/:id/confirmar
// El cajero confirma que vio el aviso de un retiro en el POS; el frontend
// usa la respuesta para armar el comprobante imprimible (RF del retiro:
// "comprobante físico para el cajero"). Condicionado a confirmado = FALSE
// para que dos confirmaciones a la vez no pisen la auditoría ni impriman
// el comprobante dos veces por error.
router.patch('/movimientos/:id/confirmar', requiereRol(...ROLES_CAJA), async (req, res) => {
  const { id } = req.params;

  try {
    const actualizado = await pool.query(
      `UPDATE movimientos_caja
       SET confirmado = TRUE, confirmado_por = $1, fecha_confirmacion = NOW()
       WHERE id = $2 AND tipo = 'retiro' AND confirmado = FALSE
       RETURNING id`,
      [req.usuario.id, id]
    );

    if (actualizado.rows.length === 0) {
      return res.status(409).json({ error: 'Este retiro ya fue confirmado o no existe.' });
    }

    // Se vuelve a consultar con el JOIN para traer el nombre de quién
    // AUTORIZÓ el retiro (el administrador) — lo necesita el comprobante.
    const completo = await pool.query(
      `SELECT mc.id, mc.tipo, mc.monto, mc.motivo, mc.fecha, mc.confirmado,
              mc.fecha_confirmacion, u.nombre AS responsable, uc.nombre AS confirmado_por_nombre
       FROM movimientos_caja mc
       JOIN usuarios u ON u.id = mc.responsable_id
       LEFT JOIN usuarios uc ON uc.id = mc.confirmado_por
       WHERE mc.id = $1`,
      [id]
    );
    res.json(completo.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al confirmar el retiro.' });
  }
});

module.exports = router;
