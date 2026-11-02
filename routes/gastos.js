// =============================================================================
// routes/gastos.js — GASTOS GENERALES DEL NEGOCIO (2026-10-28)
// =============================================================================
// Renta, servicios, mantenimiento, compras no ligadas a una venta ni a un
// insumo de receta. Cierra la foto financiera que ya dan Ventas (ingresos),
// Costeo (costo de insumos) y Nómina (costo de mano de obra) — ver
// migraciones/2026-10-28_gastos.sql para el detalle completo de la decisión
// de alcance (aislado de caja, categorías editables, proveedor opcional,
// es_recurrente solo informativo).
//
// Todos los endpoints exigen administrador/encargado (RNF-03, información
// financiera — mismo criterio que insumos/caja/nómina/reportes).
//
//   GET    /categorias           → catálogo de categorías de gasto
//   POST   /categorias           → alta rápida de categoría (nombre único)
//   GET    /?desde=&hasta=&categoria_id=&forma_pago=&proveedor_id=&buscar=
//                                 → lista de gastos, todos los filtros
//                                   opcionales y combinables (sin filtros,
//                                   todo el histórico — mismo criterio que
//                                   mermas/reportes/ventas-especiales)
//   GET    /alertas              → gastos recurrentes cuya fecha de pago
//                                   (dia_pago_mes) ya se acerca o ya venció
//                                   este mes, y que todavía no se han
//                                   vuelto a registrar — ver "2026-10-31:
//                                   alertas de pago recurrente" más abajo
//   POST   /                     → registrar un gasto (acepta dia_pago_mes/
//                                   dias_aviso_previo si es_recurrente)
//   PATCH  /:id                  → editar (deja auditoría RNF-02)
//   DELETE /:id                  → eliminar (un gasto no tiene historial
//                                   transaccional que dependa de él, a
//                                   diferencia de una venta — corregir un
//                                   error de captura no necesita el patrón
//                                   de "nunca se borra")
//   DELETE /historial?desde=&hasta= → ELIMINA todos los gastos del rango de
//                                   una vez, irreversible (solo administrador)
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { registrarAccion } = require('../utils/bitacora');
const { fechaValida, fechaHoyNegocio } = require('../utils/fecha');

const router = express.Router();

const FORMAS_PAGO_VALIDAS = ['efectivo', 'transferencia'];

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

function idValido(id) {
  return /^\d+$/.test(id);
}

const SELECT_GASTO = `
  SELECT g.id, g.categoria_id, cg.nombre AS categoria, g.concepto, g.monto,
         to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.forma_pago, g.es_recurrente,
         g.dia_pago_mes, g.dias_aviso_previo,
         g.proveedor_id, p.nombre AS proveedor_nombre, g.nota,
         g.registrado_por, u.nombre AS registrado_por_nombre, g.fecha_registro,
         g.editado_por, ue.nombre AS editado_por_nombre, g.fecha_edicion
  FROM gastos g
  JOIN categorias_gasto cg ON cg.id = g.categoria_id
  JOIN usuarios u ON u.id = g.registrado_por
  LEFT JOIN proveedores p ON p.id = g.proveedor_id
  LEFT JOIN usuarios ue ON ue.id = g.editado_por
`;

// GET /api/gastos/categorias
router.get('/categorias', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre FROM categorias_gasto ORDER BY nombre');
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las categorías de gasto.' });
  }
});

// POST /api/gastos/categorias
router.post('/categorias', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) {
    return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
  }
  try {
    const resultado = await pool.query('INSERT INTO categorias_gasto (nombre) VALUES ($1) RETURNING id, nombre', [
      nombre.trim(),
    ]);
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al crear la categoría de gasto.' });
  }
});

// GET /api/gastos?desde=&hasta=&categoria_id=&forma_pago=&proveedor_id=&buscar=
router.get('/', async (req, res) => {
  const { desde, hasta, categoria_id, forma_pago, proveedor_id, buscar } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (categoria_id && !idValido(categoria_id)) {
    return res.status(400).json({ error: 'El id de categoría debe ser numérico.' });
  }
  if (proveedor_id && !idValido(proveedor_id)) {
    return res.status(400).json({ error: 'El id de proveedor debe ser numérico.' });
  }
  if (forma_pago && !FORMAS_PAGO_VALIDAS.includes(forma_pago)) {
    return res.status(400).json({
      error: `La forma de pago debe ser una de: ${FORMAS_PAGO_VALIDAS.join(', ')}.`,
    });
  }

  try {
    const resultado = await pool.query(
      `${SELECT_GASTO}
       WHERE ($1::date IS NULL OR g.fecha >= $1::date)
         AND ($2::date IS NULL OR g.fecha <= $2::date)
         AND ($3::int IS NULL OR g.categoria_id = $3::int)
         AND ($4::text IS NULL OR g.forma_pago = $4::text)
         AND ($5::int IS NULL OR g.proveedor_id = $5::int)
         AND ($6::text IS NULL OR g.concepto ILIKE '%' || $6 || '%' OR g.nota ILIKE '%' || $6 || '%')
       ORDER BY g.fecha DESC, g.id DESC`,
      [
        desde || null,
        hasta || null,
        categoria_id || null,
        forma_pago || null,
        proveedor_id || null,
        buscar?.trim() || null,
      ],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los gastos.' });
  }
});

// GET /api/gastos/alertas — 2026-10-31: gastos recurrentes que se acercan a
// (o ya pasaron) su día de pago este mes, y que todavía no se han vuelto a
// registrar en el mes en curso. Decisión de alcance: "día fijo del mes +
// aviso N días antes" (ver CLAUDE.md) — ambos campos se capturan por gasto
// recurrente (dia_pago_mes, dias_aviso_previo), no en una configuración
// aparte.
//
// Se agrupa por (categoria_id, concepto) — esa pareja es la "serie" del
// gasto recurrente (ej. "Servicios" + "Renta local" es una serie, "Gastos
// generales" + "Internet" es otra). Se toma SIEMPRE la captura más
// reciente de cada serie como plantilla (monto, dia_pago_mes,
// dias_aviso_previo) y se excluye cualquier serie que YA tenga un gasto
// registrado este mes calendario — ya se pagó, no hace falta avisar.
//
// Registrada ANTES de GET /:id — espera, este archivo no tiene GET /:id,
// así que no hay colisión de rutas; se deja aquí, junto a GET /, por
// cercanía temática.
router.get('/alertas', async (req, res) => {
  try {
    const resultado = await pool.query(`
      WITH series AS (
        SELECT DISTINCT ON (g.categoria_id, g.concepto)
               g.categoria_id, g.concepto, g.monto, g.dia_pago_mes, g.dias_aviso_previo
        FROM gastos g
        WHERE g.es_recurrente = TRUE AND g.dia_pago_mes IS NOT NULL
        ORDER BY g.categoria_id, g.concepto, g.fecha DESC
      )
      SELECT s.categoria_id, cg.nombre AS categoria, s.concepto, s.monto,
             s.dia_pago_mes, s.dias_aviso_previo
      FROM series s
      JOIN categorias_gasto cg ON cg.id = s.categoria_id
      WHERE NOT EXISTS (
        SELECT 1 FROM gastos g2
        WHERE g2.categoria_id = s.categoria_id AND g2.concepto = s.concepto AND g2.es_recurrente = TRUE
          AND date_trunc('month', g2.fecha) = date_trunc('month', CURRENT_DATE)
      )
    `);

    const hoy = new Date(`${fechaHoyNegocio()}T00:00:00`);
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth();
    const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();

    const alertas = resultado.rows
      .map((fila) => {
        const diaObjetivo = Math.min(fila.dia_pago_mes, ultimoDiaMes);
        const fechaObjetivo = new Date(anio, mes, diaObjetivo);
        const diasRestantes = Math.round((fechaObjetivo - hoy) / (1000 * 60 * 60 * 24));
        return {
          categoria_id: fila.categoria_id,
          categoria: fila.categoria,
          concepto: fila.concepto,
          monto_ultimo: Number(fila.monto),
          dia_pago_mes: fila.dia_pago_mes,
          dias_restantes: diasRestantes,
          dias_aviso_previo: fila.dias_aviso_previo,
          vencido: diasRestantes < 0,
        };
      })
      // Solo lo que ya entró en su propia ventana de aviso (días_restantes
      // <= dias_aviso_previo) — el resto todavía no es una alerta real.
      .filter((alerta) => alerta.dias_restantes <= alerta.dias_aviso_previo)
      .sort((a, b) => a.dias_restantes - b.dias_restantes);

    res.json(alertas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las alertas de gastos recurrentes.' });
  }
});

// POST /api/gastos
// Cuerpo esperado: { categoria_id, concepto, monto, fecha, forma_pago,
//                     es_recurrente?, dia_pago_mes?, dias_aviso_previo?,
//                     proveedor_id?, nota? }
router.post('/', async (req, res) => {
  const {
    categoria_id,
    concepto,
    monto,
    fecha,
    forma_pago,
    es_recurrente,
    dia_pago_mes,
    dias_aviso_previo,
    proveedor_id,
    nota,
  } = req.body;

  if (!Number.isInteger(categoria_id)) {
    return res.status(400).json({ error: 'La categoría es obligatoria.' });
  }
  if (!concepto?.trim()) {
    return res.status(400).json({ error: 'El concepto es obligatorio.' });
  }
  if (typeof monto !== 'number' || monto <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
  }
  if (!fecha || !fechaValida(fecha)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }
  if (!FORMAS_PAGO_VALIDAS.includes(forma_pago)) {
    return res.status(400).json({
      error: `La forma de pago debe ser una de: ${FORMAS_PAGO_VALIDAS.join(', ')}.`,
    });
  }
  if (proveedor_id !== undefined && proveedor_id !== null && !Number.isInteger(proveedor_id)) {
    return res.status(400).json({ error: 'El proveedor es inválido.' });
  }
  if (
    dia_pago_mes !== undefined &&
    dia_pago_mes !== null &&
    (!Number.isInteger(dia_pago_mes) || dia_pago_mes < 1 || dia_pago_mes > 31)
  ) {
    return res.status(400).json({ error: 'El día de pago debe ser un número entre 1 y 31.' });
  }
  if (
    dias_aviso_previo !== undefined &&
    dias_aviso_previo !== null &&
    (!Number.isInteger(dias_aviso_previo) || dias_aviso_previo < 0)
  ) {
    return res.status(400).json({ error: 'Los días de aviso previo no pueden ser negativos.' });
  }

  try {
    const categoria = await pool.query('SELECT id FROM categorias_gasto WHERE id = $1', [categoria_id]);
    if (categoria.rows.length === 0) {
      return res.status(400).json({ error: 'La categoría no existe.' });
    }
    if (proveedor_id) {
      const proveedor = await pool.query('SELECT id FROM proveedores WHERE id = $1', [proveedor_id]);
      if (proveedor.rows.length === 0) {
        return res.status(400).json({ error: 'El proveedor no existe.' });
      }
    }

    const insertado = await pool.query(
      `INSERT INTO gastos
         (categoria_id, concepto, monto, fecha, forma_pago, es_recurrente,
          dia_pago_mes, dias_aviso_previo, proveedor_id, nota, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        categoria_id,
        concepto.trim(),
        monto,
        fecha,
        forma_pago,
        Boolean(es_recurrente),
        es_recurrente ? dia_pago_mes || null : null,
        dias_aviso_previo ?? 3,
        proveedor_id || null,
        nota?.trim() || null,
        req.usuario.id,
      ],
    );
    const fila = await pool.query(`${SELECT_GASTO} WHERE g.id = $1`, [insertado.rows[0].id]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el gasto.' });
  }
});

// PATCH /api/gastos/:id — edición parcial; campos ausentes conservan su
// valor actual. Deja auditoría (RNF-02) solo si algo de verdad cambió.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: 'El id debe ser numérico.' });
  }
  const body = req.body;

  try {
    const actual = await pool.query('SELECT * FROM gastos WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    const fila = actual.rows[0];

    if (body.categoria_id !== undefined) {
      if (!Number.isInteger(body.categoria_id)) {
        return res.status(400).json({ error: 'La categoría es inválida.' });
      }
      const categoria = await pool.query('SELECT id FROM categorias_gasto WHERE id = $1', [body.categoria_id]);
      if (categoria.rows.length === 0) {
        return res.status(400).json({ error: 'La categoría no existe.' });
      }
    }
    if (body.concepto !== undefined && !body.concepto.trim()) {
      return res.status(400).json({ error: 'El concepto no puede quedar vacío.' });
    }
    if (body.monto !== undefined && (typeof body.monto !== 'number' || body.monto <= 0)) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
    }
    if (body.fecha !== undefined && !fechaValida(body.fecha)) {
      return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
    }
    if (body.forma_pago !== undefined && !FORMAS_PAGO_VALIDAS.includes(body.forma_pago)) {
      return res.status(400).json({
        error: `La forma de pago debe ser una de: ${FORMAS_PAGO_VALIDAS.join(', ')}.`,
      });
    }
    if (body.proveedor_id !== undefined && body.proveedor_id !== null && !Number.isInteger(body.proveedor_id)) {
      return res.status(400).json({ error: 'El proveedor es inválido.' });
    }
    if (body.proveedor_id) {
      const proveedor = await pool.query('SELECT id FROM proveedores WHERE id = $1', [body.proveedor_id]);
      if (proveedor.rows.length === 0) {
        return res.status(400).json({ error: 'El proveedor no existe.' });
      }
    }

    const categoriaId = body.categoria_id !== undefined ? body.categoria_id : fila.categoria_id;
    const concepto = body.concepto !== undefined ? body.concepto.trim() : fila.concepto;
    const monto = body.monto !== undefined ? body.monto : Number(fila.monto);
    const fecha = body.fecha !== undefined ? body.fecha : fila.fecha.toISOString().slice(0, 10);
    const formaPago = body.forma_pago !== undefined ? body.forma_pago : fila.forma_pago;
    const esRecurrente = body.es_recurrente !== undefined ? Boolean(body.es_recurrente) : fila.es_recurrente;
    const proveedorId = body.proveedor_id !== undefined ? body.proveedor_id || null : fila.proveedor_id;
    const nota = body.nota !== undefined ? body.nota?.trim() || null : fila.nota;

    if (
      body.dia_pago_mes !== undefined &&
      body.dia_pago_mes !== null &&
      (!Number.isInteger(body.dia_pago_mes) || body.dia_pago_mes < 1 || body.dia_pago_mes > 31)
    ) {
      return res.status(400).json({ error: 'El día de pago debe ser un número entre 1 y 31.' });
    }
    if (
      body.dias_aviso_previo !== undefined &&
      body.dias_aviso_previo !== null &&
      (!Number.isInteger(body.dias_aviso_previo) || body.dias_aviso_previo < 0)
    ) {
      return res.status(400).json({ error: 'Los días de aviso previo no pueden ser negativos.' });
    }
    const diaPagoMes = body.dia_pago_mes !== undefined ? body.dia_pago_mes || null : fila.dia_pago_mes;
    const diasAvisoPrevio =
      body.dias_aviso_previo !== undefined ? (body.dias_aviso_previo ?? 3) : fila.dias_aviso_previo;
    // Sin es_recurrente, dia_pago_mes nunca se queda capturado (no tendría
    // ningún uso: la alerta solo mira gastos con es_recurrente = TRUE).
    const diaPagoMesFinal = esRecurrente ? diaPagoMes : null;

    const huboCambio =
      categoriaId !== fila.categoria_id ||
      concepto !== fila.concepto ||
      monto !== Number(fila.monto) ||
      fecha !== fila.fecha.toISOString().slice(0, 10) ||
      formaPago !== fila.forma_pago ||
      esRecurrente !== fila.es_recurrente ||
      diaPagoMesFinal !== fila.dia_pago_mes ||
      diasAvisoPrevio !== fila.dias_aviso_previo ||
      proveedorId !== fila.proveedor_id ||
      nota !== fila.nota;

    await pool.query(
      `UPDATE gastos
       SET categoria_id = $1, concepto = $2, monto = $3, fecha = $4, forma_pago = $5,
           es_recurrente = $6, dia_pago_mes = $7, dias_aviso_previo = $8, proveedor_id = $9, nota = $10,
           editado_por = CASE WHEN $11 THEN $12 ELSE editado_por END,
           fecha_edicion = CASE WHEN $11 THEN NOW() ELSE fecha_edicion END
       WHERE id = $13`,
      [
        categoriaId,
        concepto,
        monto,
        fecha,
        formaPago,
        esRecurrente,
        diaPagoMesFinal,
        diasAvisoPrevio,
        proveedorId,
        nota,
        huboCambio,
        req.usuario.id,
        id,
      ],
    );

    const resultado = await pool.query(`${SELECT_GASTO} WHERE g.id = $1`, [id]);
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el gasto.' });
  }
});

// DELETE /api/gastos/historial?desde=&hasta=
// Elimina TODOS los gastos del rango [desde, hasta] (ambos obligatorios) de
// una vez — irreversible. Solo administrador (el resto del archivo ya es
// admin/encargado; esta acción se restringe más). Registrada ANTES de
// DELETE /:id para que Express no intente leer "historial" como un id.
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

  try {
    const resultado = await pool.query(
      'DELETE FROM gastos WHERE fecha >= $1::date AND fecha <= $2::date RETURNING id',
      [desde, hasta],
    );

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'eliminar_historial',
      detalle: `Gastos: ${resultado.rows.length} gasto(s) del ${desde} al ${hasta}.`,
    });

    res.json({ eliminados: resultado.rows.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el historial de gastos.' });
  }
});

// DELETE /api/gastos/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: 'El id debe ser numérico.' });
  }
  try {
    const resultado = await pool.query('DELETE FROM gastos WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el gasto.' });
  }
});

module.exports = router;
