// =============================================================================
// routes/promociones.js — PROMOCIONES CON VIGENCIA (2026-11-16)
// =============================================================================
// Endpoints (prefijo /api/promociones), solo administrador/encargado:
//   GET    /            → todas, con `vigente_ahora` (¿aplica en este momento?)
//   POST   /            → crear
//   PATCH  /:id         → editar (cuerpo completo, mismos campos que crear)
//   PATCH  /:id/activo  → activar / desactivar
//   DELETE /:id         → eliminar
// La promoción vigente se vuelve el precio de la variante (ver utils/promociones.js
// y routes/ventas.js): el cliente nunca manda un precio.
// Necesita la migración 2026-11-16_promociones.sql; sin ella responde 503.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaValida } = require('../utils/fecha');
const { tieneTabla } = require('../utils/esquema');
const { COLUMNAS, ahoraNegocio, estaVigente } = require('../utils/promociones');

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

const SIN_TABLA = { error: 'Las promociones todavía no están habilitadas en el servidor (falta la migración).' };
const ALCANCES = { categoria: 'categorias', producto: 'productos', variante: 'variantes_producto' };

// Valida y normaliza el cuerpo; devuelve { datos } o { error }.
async function validarCuerpo(body) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre || nombre.length > 80) return { error: 'El nombre es obligatorio (máximo 80 caracteres).' };
  if (!['porcentaje', 'monto'].includes(body.tipo)) return { error: 'El tipo debe ser porcentaje o monto.' };
  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { error: 'El valor debe ser mayor a cero.' };
  if (body.tipo === 'porcentaje' && valor > 100) return { error: 'Un porcentaje no puede pasar de 100.' };
  const alcance = body.alcance || 'todo';
  if (!['todo', 'categoria', 'producto', 'variante'].includes(alcance)) return { error: 'Alcance inválido.' };

  let alcanceId = null;
  if (alcance !== 'todo') {
    alcanceId = Number(body.alcance_id);
    if (!Number.isInteger(alcanceId) || alcanceId <= 0) return { error: 'Elige a qué aplica la promoción.' };
    const existe = await pool.query(`SELECT 1 FROM ${ALCANCES[alcance]} WHERE id = $1`, [alcanceId]);
    if (existe.rows.length === 0) return { error: 'El producto, la variante o la categoría elegida no existe.' };
  }

  let dias = null;
  if (Array.isArray(body.dias_semana) && body.dias_semana.length > 0) {
    dias = [...new Set(body.dias_semana.map(Number))];
    if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      return { error: 'Los días deben ir de 0 (domingo) a 6.' };
    if (dias.length === 7) dias = null; // todos los días = sin restricción
  }

  const horaOk = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  let horaInicio = null;
  let horaFin = null;
  if (body.hora_inicio || body.hora_fin) {
    if (!horaOk(body.hora_inicio) || !horaOk(body.hora_fin))
      return { error: 'Captura hora de inicio y de fin (HH:MM).' };
    if (body.hora_inicio >= body.hora_fin) return { error: 'La hora de fin debe ser posterior a la de inicio.' };
    horaInicio = body.hora_inicio;
    horaFin = body.hora_fin;
  }

  const fechaInicio = body.fecha_inicio || null;
  const fechaFin = body.fecha_fin || null;
  if ((fechaInicio && !fechaValida(fechaInicio)) || (fechaFin && !fechaValida(fechaFin))) {
    return { error: 'Las fechas deben tener el formato AAAA-MM-DD.' };
  }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio)
    return { error: 'La fecha final no puede ser anterior a la inicial.' };

  return {
    datos: [nombre, body.tipo, valor, alcance, alcanceId, dias, horaInicio, horaFin, fechaInicio, fechaFin],
  };
}

router.get('/', async (req, res) => {
  try {
    if (!(await tieneTabla('promociones'))) return res.status(503).json(SIN_TABLA);
    const r = await pool.query(`SELECT ${COLUMNAS} FROM promociones ORDER BY activo DESC, id DESC`);
    const ahora = ahoraNegocio();
    res.json(r.rows.map((p) => ({ ...p, vigente_ahora: estaVigente(p, ahora) })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al listar las promociones.' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!(await tieneTabla('promociones'))) return res.status(503).json(SIN_TABLA);
    const { datos, error } = await validarCuerpo(req.body);
    if (error) return res.status(400).json({ error });
    const r = await pool.query(
      `INSERT INTO promociones
         (nombre, tipo, valor, alcance, alcance_id, dias_semana, hora_inicio, hora_fin, fecha_inicio, fecha_fin, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [...datos, req.usuario.id],
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear la promoción.' });
  }
});

router.patch('/:id/activo', async (req, res) => {
  if (typeof req.body.activo !== 'boolean')
    return res.status(400).json({ error: 'activo debe ser verdadero o falso.' });
  try {
    if (!(await tieneTabla('promociones'))) return res.status(503).json(SIN_TABLA);
    const r = await pool.query('UPDATE promociones SET activo = $1 WHERE id = $2 RETURNING id, activo', [
      req.body.activo,
      req.params.id,
    ]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada.' });
    res.json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar la promoción.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!(await tieneTabla('promociones'))) return res.status(503).json(SIN_TABLA);
    const { datos, error } = await validarCuerpo(req.body);
    if (error) return res.status(400).json({ error });
    const r = await pool.query(
      `UPDATE promociones SET nombre = $1, tipo = $2, valor = $3, alcance = $4, alcance_id = $5,
         dias_semana = $6, hora_inicio = $7, hora_fin = $8, fecha_inicio = $9, fecha_fin = $10
       WHERE id = $11 RETURNING id`,
      [...datos, req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada.' });
    res.json({ id: r.rows[0].id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al editar la promoción.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!(await tieneTabla('promociones'))) return res.status(503).json(SIN_TABLA);
    const r = await pool.query('DELETE FROM promociones WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada.' });
    res.json({ id: r.rows[0].id, eliminado: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar la promoción.' });
  }
});

module.exports = router;
