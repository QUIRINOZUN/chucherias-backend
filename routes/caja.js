// =============================================================================
// routes/caja.js — RESUMEN DE CAJA Y CORTES (Sprint 1, RF-04)
// =============================================================================
// Endpoints (prefijo /api/caja), todos exigen sesión:
//   GET  /resumen?fecha=     → lo que el SISTEMA calcula que debería haber
//                              (administrador, encargado, cajero)
//   POST /corte              → guarda el corte comparando contado vs. sistema
//                              (administrador, encargado, cajero)
//   GET  /cortes?desde=&hasta=&responsable_id=
//                            → historial de cortes con filtros
//                              (administrador, encargado)
//
// IDEA DEL CORTE (RF-04)
//   Al cerrar, el cajero cuenta el dinero físico. El sistema suma las ventas
//   'completada' del día por método de pago. La DIFERENCIA (contado - sistema)
//   se guarda junto con el corte: positiva = sobra dinero, negativa = falta.
//   El total del sistema SIEMPRE lo calcula el servidor; el cliente nunca lo
//   envía, así no se puede "acomodar" el corte.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaHoyNegocio, diaNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);

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
    const totales = await totalesDelDia(fecha);

    res.json({
      fecha,
      total_efectivo: totales.efectivo,
      total_transferencia: totales.transferencia,
      total_sistema: totales.efectivo + totales.transferencia,
    });
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
    // El sistema recalcula sus totales en este mismo momento.
    const totalesSistema = await totalesDelDia(fechaCorte);
    const totalSistema = totalesSistema.efectivo + totalesSistema.transferencia;
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

module.exports = router;
