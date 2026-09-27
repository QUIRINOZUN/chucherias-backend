// =============================================================================
// routes/catalogo.js — MENÚ DE PRODUCTOS PARA EL PUNTO DE VENTA (Sprint 1)
// =============================================================================
// Endpoints (se montan en /api, por eso aquí llevan /categorias y /productos):
//   GET /api/categorias → las 12 categorías del menú.
//   GET /api/productos  → productos ACTIVOS con sus variantes y precios.
//
// MODELO
//   categorias 1─N productos 1─N variantes_producto
//   Un producto es "Alitas"; sus variantes son las presentaciones que se
//   venden ("Paquete #1 · 8 pz + papas…", "Paquete #2…") y CADA variante tiene
//   su precio. Lo que se agrega al carrito y se cobra siempre es una VARIANTE.
//
// Lo consulta el POS al abrir (cualquier rol con sesión).
// =============================================================================
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
    // 1) Productos activos con el nombre de su categoría. Los productos viejos
    //    se desactivan (activo = FALSE) en vez de borrarse, y aquí se ocultan.
    const productos = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.imagen_url, c.id AS categoria_id, c.nombre AS categoria
       FROM productos p
       JOIN categorias c ON c.id = p.categoria_id
       WHERE p.activo = TRUE
       ORDER BY c.nombre, p.nombre`
    );

    // 2) Todas las variantes, de la más barata a la más cara.
    const variantes = await pool.query(
      `SELECT id, producto_id, nombre, precio FROM variantes_producto ORDER BY precio`
    );

    // 3) Se agrupan las variantes por producto en un diccionario
    //    { producto_id: [variante, variante, …] } para evitar recorrer la lista
    //    completa por cada producto.
    const variantesPorProducto = {};
    for (const variante of variantes.rows) {
      if (!variantesPorProducto[variante.producto_id]) {
        variantesPorProducto[variante.producto_id] = [];
      }
      variantesPorProducto[variante.producto_id].push({
        id: variante.id,
        nombre: variante.nombre,
        // pg devuelve NUMERIC como texto; se convierte a número para el frontend.
        precio: Number(variante.precio),
      });
    }

    // 4) Cada producto sale con su arreglo `variantes` incluido.
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
