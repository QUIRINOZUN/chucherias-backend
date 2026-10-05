// =============================================================================
// routes/mermas.js — CONSULTA CONSOLIDADA DE MERMAS
// =============================================================================
// Hasta ahora las mermas solo se podían ver dispersas: las de PRODUCTO (una
// venta cancelada) en el badge de cada venta en "Ventas de hoy", y las de
// INSUMO (manual, o por no rescatar algo al cancelar en 'preparando') en el
// historial de movimientos de CADA insumo, uno por uno, en Inventario. Este
// endpoint las junta en un solo listado consultable con filtros.
//
// GET /api/mermas?desde=&hasta=&tipo=producto|insumo
//   Todos los parámetros son opcionales y combinables. Solo administrador y
//   encargado (información financiera, RNF-03 — mismo criterio que ventas y
//   cortes de caja). Es de solo lectura: las mermas se siguen generando
//   automáticamente (routes/ventas.js) o manualmente (routes/insumos.js),
//   nunca desde aquí.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { diaNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

router.get('/', async (req, res) => {
  const { desde, hasta, tipo } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (tipo && !['producto', 'insumo'].includes(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "producto" o "insumo".' });
  }

  try {
    // Una merma de producto trae variante_id (nombre = producto + variante,
    // valor_total = lo que costaba ese producto); una de insumo trae
    // insumo_id (nombre = el insumo, con su unidad; sin valor en pesos — no
    // se le captura un costo unitario al insumo todavía). `numero_orden` solo
    // existe para las que vienen de cancelar una venta.
    const resultado = await pool.query(
      `SELECT m.id, m.fecha, m.cantidad, m.motivo, m.estado_orden_previo,
              u.nombre AS responsable,
              CASE WHEN m.variante_id IS NOT NULL THEN 'producto' ELSE 'insumo' END AS tipo,
              CASE
                WHEN m.variante_id IS NOT NULL THEN p.nombre || ' (' || vp.nombre || ')'
                ELSE i.nombre
              END AS nombre,
              i.unidad_medida,
              o.numero_orden,
              CASE WHEN m.valor_unitario IS NOT NULL THEN m.valor_unitario * m.cantidad ELSE NULL END AS valor_total
       FROM mermas m
       JOIN usuarios u ON u.id = m.responsable_id
       LEFT JOIN variantes_producto vp ON vp.id = m.variante_id
       LEFT JOIN productos p ON p.id = vp.producto_id
       LEFT JOIN insumos i ON i.id = m.insumo_id
       LEFT JOIN ordenes o ON o.id = m.orden_id
       WHERE ($1::date IS NULL OR ${diaNegocioSql('m.fecha')} >= $1::date)
         AND ($2::date IS NULL OR ${diaNegocioSql('m.fecha')} <= $2::date)
         AND (
           $3::text IS NULL
           OR ($3 = 'producto' AND m.variante_id IS NOT NULL)
           OR ($3 = 'insumo' AND m.insumo_id IS NOT NULL)
         )
       ORDER BY m.fecha DESC`,
      [desde || null, hasta || null, tipo || null]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las mermas.' });
  }
});

module.exports = router;
