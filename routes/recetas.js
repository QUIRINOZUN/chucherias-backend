// =============================================================================
// routes/recetas.js — RECETARIO: INSUMOS QUE LLEVA CADA VARIANTE
// =============================================================================
// Una receta es la lista de insumos (con cantidad) que se descuenta del
// inventario cuando se vende una variante — la consume utils/inventarioOrden.js
// al avanzar una comanda a 'preparando'. Antes solo existía como datos
// cargados a mano con scripts/seed-recetas.js; esta es la primera API para
// leerla y editarla desde la app. Solo administrador/encargado (igual que
// insumos.js: gestión de negocio, no operación de mostrador).
//
// MODELO: 1 receta por VARIANTE (recetas.variante_id es UNIQUE, no hay una
// receta por producto) — un producto con varias variantes (tamaños, combos)
// necesita una fila de receta en cada una, aunque el contenido se repita casi
// igual. Una variante sin fila en `recetas` es un estado válido: "todavía no
// se le captura receta" (no descuenta nada al venderse, no es un error).
//
// Endpoints (prefijo /api/recetas):
//   GET /                      → todas las variantes activas con si ya
//                                 tienen receta y cuántos insumos lleva.
//   GET /variante/:varianteId  → la receta de una variante (lista vacía si
//                                 todavía no tiene).
//   PUT /variante/:varianteId  → reemplaza TODA la receta de una variante de
//                                 una sola vez (mismo patrón que
//                                 routes/horarios.js): crea la fila en
//                                 `recetas` si no existía, borra sus
//                                 receta_insumos y vuelve a insertar solo los
//                                 recibidos.
//
// La unidad de cada línea SIEMPRE es la unidad base del insumo (la misma de
// insumos.unidad_medida) — inventarioOrden.js nunca convierte unidades al
// descontar, así que esta ruta no deja elegir una distinta a la del insumo.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// GET /api/recetas
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT v.id AS variante_id, v.nombre AS variante_nombre, v.precio,
              p.id AS producto_id, p.nombre AS producto_nombre,
              c.nombre AS categoria,
              r.id AS receta_id,
              COUNT(ri.id) AS total_insumos
       FROM variantes_producto v
       JOIN productos p ON p.id = v.producto_id
       JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN recetas r ON r.variante_id = v.id
       LEFT JOIN receta_insumos ri ON ri.receta_id = r.id
       WHERE p.activo = TRUE
       GROUP BY v.id, v.nombre, v.precio, p.id, p.nombre, c.nombre, r.id
       ORDER BY c.nombre, p.nombre, v.precio`,
    );

    const variantes = resultado.rows.map((fila) => ({
      variante_id: fila.variante_id,
      variante_nombre: fila.variante_nombre,
      precio: Number(fila.precio),
      producto_id: fila.producto_id,
      producto_nombre: fila.producto_nombre,
      categoria: fila.categoria,
      tiene_receta: fila.receta_id !== null,
      total_insumos: Number(fila.total_insumos),
    }));

    res.json(variantes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las variantes.' });
  }
});

// GET /api/recetas/variante/:varianteId
router.get('/variante/:varianteId', async (req, res) => {
  const { varianteId } = req.params;
  try {
    const variante = await pool.query('SELECT id FROM variantes_producto WHERE id = $1', [
      varianteId,
    ]);
    if (variante.rows.length === 0) {
      return res.status(404).json({ error: 'Variante no encontrada.' });
    }

    const resultado = await pool.query(
      `SELECT ri.id, ri.insumo_id, i.nombre AS insumo_nombre,
              i.unidad_medida AS insumo_unidad_base, ri.cantidad, ri.unidad_medida
       FROM recetas r
       JOIN receta_insumos ri ON ri.receta_id = r.id
       JOIN insumos i ON i.id = ri.insumo_id
       WHERE r.variante_id = $1
       ORDER BY i.nombre`,
      [varianteId],
    );

    res.json(resultado.rows.map((fila) => ({ ...fila, cantidad: Number(fila.cantidad) })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener la receta.' });
  }
});

// PUT /api/recetas/variante/:varianteId
router.put('/variante/:varianteId', async (req, res) => {
  const { varianteId } = req.params;
  const { insumos } = req.body;

  if (!Array.isArray(insumos)) {
    return res.status(400).json({ error: '"insumos" debe ser una lista.' });
  }
  for (const linea of insumos) {
    const cantidad = Number(linea.cantidad);
    if (!linea.insumo_id || !Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Cada insumo necesita una cantidad mayor a cero.' });
    }
    if (!linea.unidad_medida || !String(linea.unidad_medida).trim()) {
      return res.status(400).json({ error: 'Falta la unidad de medida de un insumo.' });
    }
  }
  const idsInsumo = insumos.map((linea) => linea.insumo_id);
  if (new Set(idsInsumo).size !== idsInsumo.length) {
    return res.status(400).json({ error: 'No puedes repetir el mismo insumo dos veces.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const variante = await client.query('SELECT id FROM variantes_producto WHERE id = $1', [
      varianteId,
    ]);
    if (variante.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Variante no encontrada.' });
    }

    if (idsInsumo.length > 0) {
      const validos = await client.query('SELECT id FROM insumos WHERE id = ANY($1::int[])', [
        idsInsumo,
      ]);
      if (validos.rows.length !== idsInsumo.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Alguno de los insumos no existe.' });
      }
    }

    let receta = await client.query('SELECT id FROM recetas WHERE variante_id = $1', [
      varianteId,
    ]);
    let recetaId;
    if (receta.rows.length === 0) {
      const nueva = await client.query(
        'INSERT INTO recetas (variante_id) VALUES ($1) RETURNING id',
        [varianteId],
      );
      recetaId = nueva.rows[0].id;
    } else {
      recetaId = receta.rows[0].id;
    }

    await client.query('DELETE FROM receta_insumos WHERE receta_id = $1', [recetaId]);
    for (const linea of insumos) {
      await client.query(
        `INSERT INTO receta_insumos (receta_id, insumo_id, cantidad, unidad_medida)
         VALUES ($1, $2, $3, $4)`,
        [recetaId, linea.insumo_id, Number(linea.cantidad), String(linea.unidad_medida).trim()],
      );
    }

    await client.query('COMMIT');

    const resultado = await pool.query(
      `SELECT ri.id, ri.insumo_id, i.nombre AS insumo_nombre,
              i.unidad_medida AS insumo_unidad_base, ri.cantidad, ri.unidad_medida
       FROM receta_insumos ri
       JOIN insumos i ON i.id = ri.insumo_id
       WHERE ri.receta_id = $1
       ORDER BY i.nombre`,
      [recetaId],
    );
    res.json(resultado.rows.map((fila) => ({ ...fila, cantidad: Number(fila.cantidad) })));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al guardar la receta.' });
  } finally {
    client.release();
  }
});

module.exports = router;
