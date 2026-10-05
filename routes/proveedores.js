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

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// GET /api/proveedores
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, contacto, telefono FROM proveedores ORDER BY nombre'
    );
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
      [nombre.trim(), contacto?.trim() || null, telefono?.trim() || null]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el proveedor.' });
  }
});

module.exports = router;
