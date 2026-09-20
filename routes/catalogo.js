const express = require('express');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);

// GET /api/categorias
router.get('/categorias', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre FROM categorias ORDER BY nombre');
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las categorías.' });
  }
});

// GET /api/productos
// Devuelve los productos activos junto con sus variantes (tamaños/paquetes),
// agrupados, listos para que el punto de venta arme el menú.
router.get('/productos', async (req, res) => {
  try {
    const productos = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.imagen_url, c.id AS categoria_id, c.nombre AS categoria
       FROM productos p
       JOIN categorias c ON c.id = p.categoria_id
       WHERE p.activo = TRUE
       ORDER BY c.nombre, p.nombre`
    );

    const variantes = await pool.query(
      `SELECT id, producto_id, nombre, precio FROM variantes_producto ORDER BY precio`
    );

    const variantesPorProducto = {};
    for (const variante of variantes.rows) {
      if (!variantesPorProducto[variante.producto_id]) {
        variantesPorProducto[variante.producto_id] = [];
      }
      variantesPorProducto[variante.producto_id].push({
        id: variante.id,
        nombre: variante.nombre,
        precio: Number(variante.precio),
      });
    }

    const resultado = productos.rows.map((producto) => ({
      ...producto,
      variantes: variantesPorProducto[producto.id] || [],
    }));

    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los productos.' });
  }
});

module.exports = router;