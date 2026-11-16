// =============================================================================
// routes/proveedores.js — CATÁLOGO DE PROVEEDORES (para el módulo de inventario)
// =============================================================================
// Endpoints (prefijo /api/proveedores), todos exigen sesión, solo
// administrador/encargado (mismo criterio que routes/insumos.js).
//
//   GET  /   → lista de proveedores (para el selector del formulario de insumos)
//   POST /   → crear proveedor (nombre obligatorio, contacto y teléfono opcionales)
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// GET /api/proveedores
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre, contacto, telefono FROM proveedores ORDER BY nombre');
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los proveedores.' });
  }
});

// POST /api/proveedores
router.post('/', async (req, res) => {
  const { nombre, contacto, telefono } = req.body;

  if (!nombre?.trim()) {
    return res.status(400).json({ error: 'El nombre del proveedor es obligatorio.' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO proveedores (nombre, contacto, telefono)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, contacto, telefono`,
      [nombre.trim(), contacto?.trim() || null, telefono?.trim() || null],
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el proveedor.' });
  }
});

// PATCH /api/proveedores/:id — corrige nombre, contacto o teléfono (parcial).
router.patch('/:id', async (req, res) => {
  const { nombre, contacto, telefono } = req.body;
  if (nombre !== undefined && (typeof nombre !== 'string' || !nombre.trim())) {
    return res.status(400).json({ error: 'El nombre del proveedor no puede quedar vacío.' });
  }
  for (const [campo, valor] of [
    ['contacto', contacto],
    ['teléfono', telefono],
  ]) {
    if (valor !== undefined && valor !== null && typeof valor !== 'string') {
      return res.status(400).json({ error: `El ${campo} debe ser texto.` });
    }
  }
  try {
    const resultado = await pool.query(
      `UPDATE proveedores SET
         nombre = COALESCE($1, nombre),
         contacto = CASE WHEN $4 THEN $2 ELSE contacto END,
         telefono = CASE WHEN $5 THEN $3 ELSE telefono END
       WHERE id = $6
       RETURNING id, nombre, contacto, telefono`,
      [
        nombre?.trim() ?? null,
        contacto?.trim() || null,
        telefono?.trim() || null,
        contacto !== undefined,
        telefono !== undefined,
        req.params.id,
      ],
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Proveedor no encontrado.' });
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el proveedor.' });
  }
});

// DELETE /api/proveedores/:id — solo si nada lo usa (insumos, compras, gastos).
// Si tiene historial, Postgres lo rechaza por llave foránea (23503) y se
// responde 409 en vez de un error crudo; en ese caso no se borra nada.
router.delete('/:id', async (req, res) => {
  try {
    const resultado = await pool.query('DELETE FROM proveedores WHERE id = $1 RETURNING id', [req.params.id]);
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Proveedor no encontrado.' });
    res.json({ id: resultado.rows[0].id, eliminado: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar: este proveedor ya está ligado a insumos, compras o gastos.',
      });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el proveedor.' });
  }
});

module.exports = router;
