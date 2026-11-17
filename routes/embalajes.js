// =============================================================================
// routes/embalajes.js — CATÁLOGO DE EMBALAJES Y DECORACIONES (2026-11-17)
// =============================================================================
// Prefijo /api/embalajes. Un embalaje es un insumo marcado con embalaje_uso (ver
// utils/embalajes.js), así que su existencia, entradas, ajustes, mermas y costo se manejan con
// las rutas de /api/insumos/:id/... que ya existen; aquí solo vive su catálogo (alta, edición,
// baja) separado en dos usos: ventas normales y ventas especiales.
//
//   GET    /?uso=venta|especial  cajero y auxiliar también (Comandas elige el embalaje); costos solo admin/encargado
//   POST   /                     { nombre, unidad_medida?, uso, clase?, cantidad_minima?, costo_unitario?, proveedor_id? }
//   PATCH  /:id                  edición parcial
//   DELETE /:id                  solo si nunca se ha usado
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { EXPRESION_EXISTENCIA } = require('../utils/existencia');
const { embalajesDisponibles } = require('../utils/embalajes');

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);
router.use(verificarToken);

const USOS = ['venta', 'especial'];
const CLASES = ['embalaje', 'decoracion'];
const GESTORES = ['administrador', 'encargado'];

async function exigirMigracion(res) {
  if (await embalajesDisponibles()) return true;
  res.status(503).json({ error: 'Los embalajes todavía no están habilitados en el servidor.' });
  return false;
}

router.get('/', requiereRol(...GESTORES, 'cajero', 'auxiliar'), async (req, res) => {
  const { uso } = req.query;
  if (uso !== undefined && !USOS.includes(uso)) {
    return res.status(400).json({ error: `El uso debe ser uno de: ${USOS.join(', ')}.` });
  }
  if (!(await embalajesDisponibles())) return res.json([]);
  const veCostos = GESTORES.includes(req.usuario.rol);
  try {
    const r = await pool.query(
      `SELECT i.id, i.nombre, i.unidad_medida, i.cantidad_minima, i.costo_unitario, i.proveedor_id,
              p.nombre AS proveedor, i.embalaje_uso AS uso, i.embalaje_clase AS clase,
              ${EXPRESION_EXISTENCIA} AS existencia
       FROM insumos i
       LEFT JOIN proveedores p ON p.id = i.proveedor_id
       LEFT JOIN movimientos_inventario m ON m.insumo_id = i.id
       WHERE i.embalaje_uso IS NOT NULL AND ($1::text IS NULL OR i.embalaje_uso = $1)
       GROUP BY i.id, p.nombre
       ORDER BY i.embalaje_clase NULLS FIRST, i.nombre`,
      [uso || null],
    );
    res.json(
      r.rows.map((f) => {
        const existencia = Number(f.existencia);
        const minimo = Number(f.cantidad_minima);
        return {
          id: f.id,
          nombre: f.nombre,
          unidad_medida: f.unidad_medida,
          uso: f.uso,
          clase: f.clase,
          existencia,
          agotado: existencia <= 0,
          ...(veCostos && {
            cantidad_minima: minimo,
            costo_unitario: f.costo_unitario === null ? null : Number(f.costo_unitario),
            proveedor_id: f.proveedor_id,
            proveedor: f.proveedor,
            alerta: minimo > 0 && existencia <= minimo,
          }),
        };
      }),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los embalajes.' });
  }
});

function validarCuerpo(b, parcial) {
  if (!parcial || b.nombre !== undefined) {
    if (typeof b.nombre !== 'string' || !b.nombre.trim()) return 'El nombre es obligatorio.';
  }
  if (b.uso !== undefined && !USOS.includes(b.uso)) return `El uso debe ser uno de: ${USOS.join(', ')}.`;
  if (!parcial && b.uso === undefined) return 'Indica si es para ventas normales o ventas especiales.';
  if (b.clase !== undefined && b.clase !== null && !CLASES.includes(b.clase)) {
    return `La clase debe ser una de: ${CLASES.join(', ')}.`;
  }
  for (const campo of ['cantidad_minima', 'costo_unitario']) {
    if (b[campo] !== undefined && b[campo] !== null && b[campo] !== '') {
      const n = Number(b[campo]);
      if (!Number.isFinite(n) || n < 0) return `El campo ${campo.replace('_', ' ')} no puede ser negativo.`;
    }
  }
  return null;
}

router.post('/', requiereRol(...GESTORES), async (req, res) => {
  if (!(await exigirMigracion(res))) return;
  const b = req.body;
  const error = validarCuerpo(b, false);
  if (error) return res.status(400).json({ error });
  const clase = b.uso === 'especial' ? b.clase || 'embalaje' : null;
  try {
    const r = await pool.query(
      `INSERT INTO insumos (nombre, unidad_medida, cantidad_minima, proveedor_id, costo_unitario, embalaje_uso, embalaje_clase)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        b.nombre.trim(),
        b.unidad_medida?.trim() || 'pza',
        Number(b.cantidad_minima) || 0,
        b.proveedor_id || null,
        b.costo_unitario === '' || b.costo_unitario === undefined ? null : b.costo_unitario,
        b.uso,
        clase,
      ],
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'El proveedor indicado no existe.' });
    console.error(e);
    res.status(500).json({ error: 'Error al crear el embalaje.' });
  }
});

router.patch('/:id', requiereRol(...GESTORES), async (req, res) => {
  if (!(await exigirMigracion(res))) return;
  const b = req.body;
  const error = validarCuerpo(b, true);
  if (error) return res.status(400).json({ error });
  try {
    const a = await pool.query('SELECT * FROM insumos WHERE id = $1 AND embalaje_uso IS NOT NULL', [req.params.id]);
    if (a.rows.length === 0) return res.status(404).json({ error: 'Embalaje no encontrado.' });
    const fila = a.rows[0];
    const uso = b.uso !== undefined ? b.uso : fila.embalaje_uso;
    const clase = uso === 'especial' ? (b.clase !== undefined ? b.clase : fila.embalaje_clase) || 'embalaje' : null;
    await pool.query(
      `UPDATE insumos SET nombre = $1, unidad_medida = $2, cantidad_minima = $3, proveedor_id = $4,
              costo_unitario = $5, embalaje_uso = $6, embalaje_clase = $7 WHERE id = $8`,
      [
        b.nombre !== undefined ? b.nombre.trim() : fila.nombre,
        b.unidad_medida !== undefined ? b.unidad_medida.trim() || fila.unidad_medida : fila.unidad_medida,
        b.cantidad_minima !== undefined ? Number(b.cantidad_minima) || 0 : fila.cantidad_minima,
        b.proveedor_id !== undefined ? b.proveedor_id || null : fila.proveedor_id,
        b.costo_unitario !== undefined ? (b.costo_unitario === '' ? null : b.costo_unitario) : fila.costo_unitario,
        uso,
        clase,
        req.params.id,
      ],
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'El proveedor indicado no existe.' });
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar el embalaje.' });
  }
});

router.delete('/:id', requiereRol(...GESTORES), async (req, res) => {
  if (!(await exigirMigracion(res))) return;
  const cliente = await pool.connect();
  try {
    const a = await cliente.query('SELECT id FROM insumos WHERE id = $1 AND embalaje_uso IS NOT NULL', [req.params.id]);
    if (a.rows.length === 0) return res.status(404).json({ error: 'Embalaje no encontrado.' });
    await cliente.query('BEGIN');
    await cliente.query('DELETE FROM insumo_compras WHERE insumo_id = $1', [req.params.id]);
    await cliente.query('DELETE FROM movimientos_inventario WHERE insumo_id = $1', [req.params.id]);
    await cliente.query('DELETE FROM insumos WHERE id = $1', [req.params.id]);
    await cliente.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    if (e.code === '23503') {
      return res.status(409).json({
        error:
          'No se puede eliminar: ya se usó en ventas. Si no lo vas a usar más, déjalo en cero o cámbialo de nombre.',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar el embalaje.' });
  } finally {
    cliente.release();
  }
});

module.exports = router;
