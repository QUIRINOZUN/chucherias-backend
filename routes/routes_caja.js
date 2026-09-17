const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);

// GET /api/caja/resumen?fecha=YYYY-MM-DD
// Calcula, en tiempo real, cuánto debería haber en caja según el sistema
// (RF-04), sin guardar nada todavía. Sirve para que el cajero compare
// contra lo que cuenta físicamente antes de cerrar el turno.
router.get('/resumen', async (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

  try {
    const resultado = await pool.query(
      `SELECT metodo_pago, COALESCE(SUM(total), 0) AS total
       FROM ventas
       WHERE estado = 'completada' AND fecha::date = $1
       GROUP BY metodo_pago`,
      [fecha]
    );

    const totales = { efectivo: 0, transferencia: 0 };
    for (const fila of resultado.rows) {
      totales[fila.metodo_pago] = Number(fila.total);
    }

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

  const fechaCorte = fecha || new Date().toISOString().slice(0, 10);

  try {
    const resumen = await pool.query(
      `SELECT metodo_pago, COALESCE(SUM(total), 0) AS total
       FROM ventas
       WHERE estado = 'completada' AND fecha::date = $1
       GROUP BY metodo_pago`,
      [fechaCorte]
    );

    const totalesSistema = { efectivo: 0, transferencia: 0 };
    for (const fila of resumen.rows) {
      totalesSistema[fila.metodo_pago] = Number(fila.total);
    }
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

// GET /api/caja/cortes
// Historial de cortes ya guardados. Solo administrador y encargado.
router.get('/cortes', requiereRol('administrador', 'encargado'), async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT cc.*, u.nombre AS responsable
       FROM cortes_caja cc
       JOIN usuarios u ON u.id = cc.responsable_id
       ORDER BY cc.fecha DESC`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el historial de cortes.' });
  }
});

module.exports = router;