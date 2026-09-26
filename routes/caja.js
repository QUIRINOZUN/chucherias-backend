const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaHoyNegocio, diaNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);

// Totales del sistema por método de pago para un día del negocio.
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
router.post('/corte', requiereRol('administrador', 'encargado', 'cajero'), async (req, res) => {
  const { fecha, turno, total_efectivo_contado, total_transferencia_contado } = req.body;

  if (total_efectivo_contado == null || total_transferencia_contado == null) {
    return res.status(400).json({ error: 'Debes indicar el efectivo y la transferencia contados.' });
  }

  const fechaCorte = fecha || fechaHoyNegocio();

  if (!fechaValida(fechaCorte)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }

  try {
    const totalesSistema = await totalesDelDia(fechaCorte);
    const totalSistema = totalesSistema.efectivo + totalesSistema.transferencia;
    const totalContado = Number(total_efectivo_contado) + Number(total_transferencia_contado);
    const diferencia = totalContado - totalSistema;

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
