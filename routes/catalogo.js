// =============================================================================
// routes/catalogo.js — MENÚ DE PRODUCTOS (Sprint 1) + GESTIÓN (2026-10-09)
// =============================================================================
// Lectura (cualquier rol con sesión — lo consulta el POS al abrir):
//   GET /api/categorias           → las categorías del menú.
//   GET /api/productos?todos=1    → productos (activos por default; con
//                                    ?todos=1 incluye los desactivados Y sus
//                                    variantes desactivadas, para la pantalla
//                                    de gestión del menú).
//
// Gestión (solo administrador/encargado — antes el menú SOLO se cargaba con
// scripts/seed-catalogo.js; esto es la primera API para editarlo desde la
// app, parte del submódulo "Menú" dentro de Recetario):
//   POST   /api/categorias                     → crear categoría
//   PATCH  /api/categorias/:id                 → renombrar categoría
//   DELETE /api/categorias/:id                 → eliminar (solo si no tiene
//                                                 productos)
//   POST   /api/productos                      → crear producto
//   PATCH  /api/productos/:id                  → editar nombre/descripción/
//                                                 categoría
//   PATCH  /api/productos/:id/activo           → activar/desactivar
//   DELETE /api/productos/:id                  → eliminar (solo si no tiene
//                                                 variantes)
//   POST   /api/productos/:id/imagen           → subir/reemplazar la foto
//                                                 (multipart/form-data,
//                                                 campo "imagen") — sube a
//                                                 Cloudinary y borra la
//                                                 anterior si tenía
//   DELETE /api/productos/:id/imagen           → quitar la foto (borra de
//                                                 Cloudinary también)
//   POST   /api/productos/:productoId/variantes → crear variante
//   PATCH  /api/variantes/:id                  → editar nombre/precio
//   PATCH  /api/variantes/:id/activo           → activar/desactivar
//   DELETE /api/variantes/:id                  → eliminar (bloqueado si ya
//                                                 tiene ventas; si solo tenía
//                                                 una receta capturada, esa
//                                                 sí se borra junto con ella
//                                                 — es metadata interna, no
//                                                 historial de negocio)
//
// MODELO
//   categorias 1─N productos 1─N variantes_producto
//   Un producto es "Alitas"; sus variantes son las presentaciones que se
//   venden ("Paquete #1 · 8 pz + papas…", "Paquete #2…") y CADA variante tiene
//   su precio. Lo que se agrega al carrito y se cobra siempre es una VARIANTE.
//
// `productos.precio_base` es una columna heredada del esquema original que
// NINGÚN código de negocio lee (ni el POS, ni el descuento de inventario) —
// se completa con 0 al crear un producto nuevo y se deja así a propósito; el
// precio real de cada presentación SIEMPRE vive en variantes_producto.precio.
// =============================================================================
const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { subirImagen, borrarImagen } = require('../utils/cloudinary');

const router = express.Router();

router.use(verificarToken);

const GESTION = requiereRol('administrador', 'encargado');

// Multer en memoria (no a disco): el archivo solo existe mientras dura la
// petición, luego se manda directo a Cloudinary como buffer — Render no
// garantiza disco persistente entre despliegues, así que guardarlo ahí no
// serviría de nada. 5 MB es de sobra para una foto de platillo ya
// comprimida desde un celular.
const uploadImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('El archivo debe ser una imagen.'));
    }
    cb(null, true);
  },
});

// =====================================================================
// CATEGORÍAS
// =====================================================================

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

// POST /api/categorias
router.post('/categorias', GESTION, async (req, res) => {
  const nombre = req.body.nombre?.trim();
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
  }
  try {
    const resultado = await pool.query(
      'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id, nombre',
      [nombre],
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al crear la categoría.' });
  }
});

// PATCH /api/categorias/:id
router.patch('/categorias/:id', GESTION, async (req, res) => {
  const { id } = req.params;
  const nombre = req.body.nombre?.trim();
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
  }
  try {
    const resultado = await pool.query(
      'UPDATE categorias SET nombre = $1 WHERE id = $2 RETURNING id, nombre',
      [nombre, id],
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al editar la categoría.' });
  }
});

// DELETE /api/categorias/:id
// Bloqueada (409) si tiene productos asignados (FK de productos.categoria_id,
// NOT NULL) — moverlos o eliminarlos primero. Nunca se reasignan solos: sería
// invisible para quien está editando el menú.
router.delete('/categorias/:id', GESTION, async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query('DELETE FROM categorias WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    res.json({ ok: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar: todavía tiene productos. Muévelos o elimínalos primero.',
      });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar la categoría.' });
  }
});

// =====================================================================
// PRODUCTOS
// =====================================================================

// GET /api/productos?todos=1
// Por default solo productos activos con sus variantes activas (lo que usa
// el POS); ?todos=1 trae también los desactivados y, de cada producto, TODAS
// sus variantes (activas e inactivas) — para la pantalla de gestión del
// menú, donde hace falta poder reactivarlas.
router.get('/productos', async (req, res) => {
  const incluirInactivos = req.query.todos === '1';
  try {
    const productos = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.imagen_url, p.activo,
              c.id AS categoria_id, c.nombre AS categoria
       FROM productos p
       JOIN categorias c ON c.id = p.categoria_id
       ${incluirInactivos ? '' : 'WHERE p.activo = TRUE'}
       ORDER BY c.nombre, p.nombre`,
    );

    const variantes = await pool.query(
      `SELECT id, producto_id, nombre, precio, activo FROM variantes_producto
       ${incluirInactivos ? '' : 'WHERE activo = TRUE'}
       ORDER BY precio`,
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
        activo: variante.activo,
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

// POST /api/productos
router.post('/productos', GESTION, async (req, res) => {
  const { categoria_id, nombre, descripcion, imagen_url } = req.body;
  if (!categoria_id || !nombre?.trim()) {
    return res.status(400).json({ error: 'La categoría y el nombre son obligatorios.' });
  }
  try {
    const categoria = await pool.query('SELECT id FROM categorias WHERE id = $1', [categoria_id]);
    if (categoria.rows.length === 0) {
      return res.status(400).json({ error: 'La categoría indicada no existe.' });
    }
    // precio_base: ver nota del encabezado — ningún código de negocio la lee.
    const resultado = await pool.query(
      `INSERT INTO productos (categoria_id, nombre, descripcion, precio_base, imagen_url, activo)
       VALUES ($1, $2, $3, 0, $4, TRUE)
       RETURNING id, categoria_id, nombre, descripcion, imagen_url, activo`,
      [categoria_id, nombre.trim(), descripcion?.trim() || null, imagen_url?.trim() || null],
    );
    res.status(201).json({ ...resultado.rows[0], variantes: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el producto.' });
  }
});

// PATCH /api/productos/:id
router.patch('/productos/:id', GESTION, async (req, res) => {
  const { id } = req.params;
  const { categoria_id, nombre, descripcion, imagen_url } = req.body;

  try {
    const actual = await pool.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    const productoActual = actual.rows[0];

    let nuevaCategoriaId = productoActual.categoria_id;
    if (categoria_id !== undefined) {
      const categoria = await pool.query('SELECT id FROM categorias WHERE id = $1', [
        categoria_id,
      ]);
      if (categoria.rows.length === 0) {
        return res.status(400).json({ error: 'La categoría indicada no existe.' });
      }
      nuevaCategoriaId = categoria_id;
    }
    const nuevoNombre = nombre?.trim() || productoActual.nombre;
    const nuevaDescripcion =
      descripcion !== undefined ? descripcion?.trim() || null : productoActual.descripcion;
    const nuevaImagen =
      imagen_url !== undefined ? imagen_url?.trim() || null : productoActual.imagen_url;

    const resultado = await pool.query(
      `UPDATE productos SET categoria_id = $1, nombre = $2, descripcion = $3, imagen_url = $4
       WHERE id = $5
       RETURNING id, categoria_id, nombre, descripcion, imagen_url, activo`,
      [nuevaCategoriaId, nuevoNombre, nuevaDescripcion, nuevaImagen, id],
    );
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al editar el producto.' });
  }
});

// PATCH /api/productos/:id/activo
router.patch('/productos/:id/activo', GESTION, async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    const resultado = await pool.query(
      'UPDATE productos SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo',
      [!!activo, id],
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el producto.' });
  }
});

// POST /api/productos/:id/imagen
// multipart/form-data, campo "imagen". Sube a Cloudinary y guarda la URL +
// el public_id (hace falta el segundo para poder borrar/reemplazar después
// sin dejar basura en la cuenta de Cloudinary). Si el producto ya tenía una
// foto, la anterior se borra de Cloudinary tras subir la nueva — "mejor
// esfuerzo": si ese borrado falla no se interrumpe la subida nueva, solo
// queda un archivo huérfano en la cuenta (no rompe nada del sistema).
router.post('/productos/:id/imagen', GESTION, (req, res) => {
  uploadImagen.single('imagen')(req, res, async (errorMulter) => {
    if (errorMulter) {
      return res
        .status(400)
        .json({ error: errorMulter.message || 'No se pudo procesar el archivo.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Falta el archivo de imagen (campo "imagen").' });
    }

    const { id } = req.params;
    try {
      const producto = await pool.query(
        'SELECT id, imagen_public_id FROM productos WHERE id = $1',
        [id],
      );
      if (producto.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }

      const subida = await subirImagen(req.file.buffer, 'chucherias/productos');

      const publicIdAnterior = producto.rows[0].imagen_public_id;
      if (publicIdAnterior) {
        await borrarImagen(publicIdAnterior).catch((error) => {
          console.error('No se pudo borrar la imagen anterior de Cloudinary:', error);
        });
      }

      const resultado = await pool.query(
        `UPDATE productos SET imagen_url = $1, imagen_public_id = $2 WHERE id = $3
         RETURNING id, categoria_id, nombre, descripcion, imagen_url, activo`,
        [subida.secure_url, subida.public_id, id],
      );
      res.json(resultado.rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al subir la imagen.' });
    }
  });
});

// DELETE /api/productos/:id/imagen
// Quita la foto del producto (vuelve al bloque de color de categoría en el
// POS) y la borra de Cloudinary.
router.delete('/productos/:id/imagen', GESTION, async (req, res) => {
  const { id } = req.params;
  try {
    const producto = await pool.query('SELECT id, imagen_public_id FROM productos WHERE id = $1', [
      id,
    ]);
    if (producto.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    const publicId = producto.rows[0].imagen_public_id;
    if (publicId) {
      await borrarImagen(publicId).catch((error) => {
        console.error('No se pudo borrar la imagen de Cloudinary:', error);
      });
    }
    const resultado = await pool.query(
      `UPDATE productos SET imagen_url = NULL, imagen_public_id = NULL WHERE id = $1
       RETURNING id, categoria_id, nombre, descripcion, imagen_url, activo`,
      [id],
    );
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al quitar la imagen.' });
  }
});

// DELETE /api/productos/:id
// Bloqueada (409) si todavía tiene variantes — eliminarlas (o desactivar el
// producto) primero. Nunca se borran en cascada sin que quien edita el menú
// lo vea paso a paso. Si tenía una foto propia, se borra de Cloudinary de
// paso (ya no la referencia ningún producto).
router.delete('/productos/:id', GESTION, async (req, res) => {
  const { id } = req.params;
  try {
    const variantes = await pool.query(
      'SELECT id FROM variantes_producto WHERE producto_id = $1 LIMIT 1',
      [id],
    );
    if (variantes.rows.length > 0) {
      return res.status(409).json({
        error: 'No se puede eliminar: todavía tiene variantes. Elimínalas primero.',
      });
    }
    const producto = await pool.query('SELECT imagen_public_id FROM productos WHERE id = $1', [
      id,
    ]);
    const resultado = await pool.query('DELETE FROM productos WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    if (producto.rows[0]?.imagen_public_id) {
      await borrarImagen(producto.rows[0].imagen_public_id).catch((error) => {
        console.error('No se pudo borrar la imagen de Cloudinary:', error);
      });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el producto.' });
  }
});

// =====================================================================
// VARIANTES
// =====================================================================

// POST /api/productos/:productoId/variantes
router.post('/productos/:productoId/variantes', GESTION, async (req, res) => {
  const { productoId } = req.params;
  const { nombre, precio } = req.body;
  const precioNum = Number(precio);

  if (!nombre?.trim() || !Number.isFinite(precioNum) || precioNum <= 0) {
    return res.status(400).json({ error: 'El nombre y un precio mayor a cero son obligatorios.' });
  }
  try {
    const producto = await pool.query('SELECT id FROM productos WHERE id = $1', [productoId]);
    if (producto.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    const resultado = await pool.query(
      `INSERT INTO variantes_producto (producto_id, nombre, precio, activo)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, producto_id, nombre, precio, activo`,
      [productoId, nombre.trim(), precioNum],
    );
    res.status(201).json({ ...resultado.rows[0], precio: Number(resultado.rows[0].precio) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear la variante.' });
  }
});

// PATCH /api/variantes/:id
router.patch('/variantes/:id', GESTION, async (req, res) => {
  const { id } = req.params;
  const { nombre, precio } = req.body;

  try {
    const actual = await pool.query('SELECT * FROM variantes_producto WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Variante no encontrada.' });
    }
    const varianteActual = actual.rows[0];

    const nuevoNombre = nombre?.trim() || varianteActual.nombre;
    let nuevoPrecio = Number(varianteActual.precio);
    if (precio !== undefined) {
      const precioNum = Number(precio);
      if (!Number.isFinite(precioNum) || precioNum <= 0) {
        return res.status(400).json({ error: 'El precio debe ser mayor a cero.' });
      }
      nuevoPrecio = precioNum;
    }

    const resultado = await pool.query(
      `UPDATE variantes_producto SET nombre = $1, precio = $2 WHERE id = $3
       RETURNING id, producto_id, nombre, precio, activo`,
      [nuevoNombre, nuevoPrecio, id],
    );
    res.json({ ...resultado.rows[0], precio: Number(resultado.rows[0].precio) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al editar la variante.' });
  }
});

// PATCH /api/variantes/:id/activo
router.patch('/variantes/:id/activo', GESTION, async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    const resultado = await pool.query(
      'UPDATE variantes_producto SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo',
      [!!activo, id],
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Variante no encontrada.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar la variante.' });
  }
});

// DELETE /api/variantes/:id
// Bloqueada (409) si ya tiene ventas registradas (orden_detalle) — eso SÍ es
// historial de negocio, nunca se borra. Si solo tenía una receta capturada
// (recetas/receta_insumos/receta_pasos, incluido su tutorial), esa se borra
// junto con la variante: es metadata interna de cómo se prepara, no un
// registro de lo que pasó.
router.delete('/variantes/:id', GESTION, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ventas = await client.query(
      'SELECT id FROM orden_detalle WHERE variante_id = $1 LIMIT 1',
      [id],
    );
    if (ventas.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'No se puede eliminar: ya tiene ventas registradas. Desactívala en su lugar.',
      });
    }

    const receta = await client.query('SELECT id FROM recetas WHERE variante_id = $1', [id]);
    if (receta.rows.length > 0) {
      await client.query('DELETE FROM receta_insumos WHERE receta_id = $1', [receta.rows[0].id]);
      await client.query('DELETE FROM receta_pasos WHERE receta_id = $1', [receta.rows[0].id]);
      await client.query('DELETE FROM recetas WHERE id = $1', [receta.rows[0].id]);
    }

    const resultado = await client.query(
      'DELETE FROM variantes_producto WHERE id = $1 RETURNING id',
      [id],
    );
    if (resultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Variante no encontrada.' });
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar la variante.' });
  } finally {
    client.release();
  }
});

module.exports = router;
