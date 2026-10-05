// =============================================================================
// routes/insumos.js — INVENTARIO: ALTA/EDICIÓN DE INSUMOS Y EXISTENCIAS
// =============================================================================
// Endpoints (prefijo /api/insumos), todos exigen sesión y son solo para
// administrador/encargado (igual que usuarios y caja: gestión de negocio,
// no operación de mostrador — cajero y auxiliar no entran aquí).
//
//   GET   /                 → lista de insumos con existencia calculada y
//                             alerta de mínimo
//   GET   /categorias       → catálogo de categorías de insumo (para agrupar
//                             la lista y para el selector del formulario)
//   GET   /:id/movimientos  → historial de movimientos de un insumo (auditoría)
//   POST  /                 → crear insumo
//   PATCH /:id              → editar insumo (nombre, unidad, mínimo, proveedor)
//   POST  /:id/entrada      → registrar entrada de mercancía (sube existencia)
//   POST  /:id/ajuste       → corrección manual de existencia (+/-, con motivo)
//   POST  /:id/merma        → merma manual de un insumo (RF-13: se cayó,
//                             caducó, etc. — independiente de una venta)
//
// `insumos` NO guarda una existencia aparte: se calcula sumando
// movimientos_inventario (entrada + ajuste − salida − merma). La 'salida' la
// genera automáticamente routes/ordenes.js al pasar una comanda a
// 'preparando' (descuento por receta); la 'merma' por cancelación de venta la
// genera routes/ventas.js (a nivel producto, tabla `mermas`); aquí solo se
// registran entradas, ajustes y mermas manuales A NIVEL INSUMO.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// Expresión SQL compartida: existencia = entrada + ajuste − salida − merma.
const EXPRESION_EXISTENCIA = `COALESCE(SUM(
  CASE
    WHEN m.tipo IN ('entrada', 'ajuste') THEN m.cantidad
    WHEN m.tipo IN ('salida', 'merma') THEN -m.cantidad
    ELSE 0
  END
), 0)`;

// GET /api/insumos
// Lista todos los insumos con su existencia calculada y si está en o por
// debajo de su cantidad_minima (alerta de reabastecimiento).
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT i.id, i.nombre, i.unidad_medida, i.cantidad_minima, i.proveedor_id,
              p.nombre AS proveedor, i.categoria_id, c.nombre AS categoria,
              ${EXPRESION_EXISTENCIA} AS existencia
       FROM insumos i
       LEFT JOIN proveedores p ON p.id = i.proveedor_id
       LEFT JOIN categorias_insumo c ON c.id = i.categoria_id
       LEFT JOIN movimientos_inventario m ON m.insumo_id = i.id
       GROUP BY i.id, p.nombre, c.nombre
       ORDER BY i.nombre`
    );

    // La alerta se calcula aquí (no en SQL) porque ambos valores ya son
    // numéricos de JS tras salir del driver; es más legible que un HAVING.
    const insumos = resultado.rows.map((fila) => ({
      ...fila,
      existencia: Number(fila.existencia),
      cantidad_minima: Number(fila.cantidad_minima),
      alerta: Number(fila.existencia) <= Number(fila.cantidad_minima),
    }));

    res.json(insumos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los insumos.' });
  }
});

// GET /api/insumos/categorias
// Catálogo de categorías de insumo, para agrupar la lista en el frontend y
// para el selector del formulario de alta/edición. Se ordena por id: el
// orden de creación ya sigue un criterio lógico (de cocina a mostrador).
router.get('/categorias', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre FROM categorias_insumo ORDER BY id');
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las categorías de insumo.' });
  }
});

// GET /api/insumos/:id/movimientos
// Historial de movimientos de un insumo (más recientes primero), para
// auditar de dónde salió una existencia. Se limita a los últimos 50.
router.get('/:id/movimientos', async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT m.id, m.tipo, m.cantidad, m.fecha, m.motivo, u.nombre AS responsable
       FROM movimientos_inventario m
       JOIN usuarios u ON u.id = m.responsable_id
       WHERE m.insumo_id = $1
       ORDER BY m.fecha DESC
       LIMIT 50`,
      [id]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los movimientos del insumo.' });
  }
});

// POST /api/insumos
// Crea un insumo nuevo. cantidad_minima es opcional (default 0); proveedor_id
// es opcional (algunos insumos aún no tienen proveedor asignado).
router.post('/', async (req, res) => {
  const { nombre, unidad_medida, cantidad_minima, proveedor_id, categoria_id } = req.body;

  if (!nombre?.trim() || !unidad_medida?.trim()) {
    return res.status(400).json({ error: 'El nombre y la unidad de medida son obligatorios.' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO insumos (nombre, unidad_medida, cantidad_minima, proveedor_id, categoria_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, unidad_medida, cantidad_minima, proveedor_id, categoria_id`,
      [nombre.trim(), unidad_medida.trim(), cantidad_minima || 0, proveedor_id || null, categoria_id || null]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    // 23503 = violación de llave foránea: el proveedor_id o categoria_id no existe.
    if (error.code === '23503') {
      return res.status(400).json({ error: 'El proveedor o la categoría indicados no existen.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al crear el insumo.' });
  }
});

// PATCH /api/insumos/:id
// Edita un insumo existente. Edición parcial: cada campo que no llegue
// conserva su valor actual (mismo patrón que PATCH /api/usuarios/:id).
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, unidad_medida, cantidad_minima, proveedor_id, categoria_id } = req.body;

  try {
    const actual = await pool.query('SELECT * FROM insumos WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Insumo no encontrado.' });
    }
    const insumoActual = actual.rows[0];

    const nuevoNombre = nombre?.trim() || insumoActual.nombre;
    const nuevaUnidad = unidad_medida?.trim() || insumoActual.unidad_medida;
    const nuevoMinimo = cantidad_minima != null ? cantidad_minima : insumoActual.cantidad_minima;
    // proveedor_id/categoria_id pueden mandarse explícitamente en null para
    // quitar el valor, así que se distingue "no vino en el body" (undefined)
    // de "vino vacío".
    const nuevoProveedorId = proveedor_id !== undefined ? proveedor_id || null : insumoActual.proveedor_id;
    const nuevaCategoriaId = categoria_id !== undefined ? categoria_id || null : insumoActual.categoria_id;

    const resultado = await pool.query(
      `UPDATE insumos SET nombre = $1, unidad_medida = $2, cantidad_minima = $3, proveedor_id = $4, categoria_id = $5
       WHERE id = $6
       RETURNING id, nombre, unidad_medida, cantidad_minima, proveedor_id, categoria_id`,
      [nuevoNombre, nuevaUnidad, nuevoMinimo, nuevoProveedorId, nuevaCategoriaId, id]
    );
    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ error: 'El proveedor o la categoría indicados no existen.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el insumo.' });
  }
});

// POST /api/insumos/:id/entrada
// Registra una entrada de mercancía (compra recibida): sube la existencia.
// cantidad debe ser positiva; motivo es opcional (ej. "Compra semanal").
router.post('/:id/entrada', async (req, res) => {
  const { id } = req.params;
  const { cantidad, motivo } = req.body;

  const cantidadNum = Number(cantidad);
  if (!cantidadNum || cantidadNum <= 0) {
    return res.status(400).json({ error: 'La cantidad de la entrada debe ser mayor a cero.' });
  }

  try {
    const insumo = await pool.query('SELECT id FROM insumos WHERE id = $1', [id]);
    if (insumo.rows.length === 0) {
      return res.status(404).json({ error: 'Insumo no encontrado.' });
    }

    const resultado = await pool.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, responsable_id, motivo)
       VALUES ($1, 'entrada', $2, $3, $4)
       RETURNING id, tipo, cantidad, fecha, motivo`,
      [id, cantidadNum, req.usuario.id, motivo?.trim() || 'Entrada de mercancía']
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la entrada.' });
  }
});

// POST /api/insumos/:id/ajuste
// Corrección manual de existencia (ej. conteo físico distinto al calculado,
// producto dañado fuera del flujo de venta). cantidad puede ser positiva o
// negativa, pero no cero; motivo es obligatorio porque es una corrección,
// no una operación de rutina.
router.post('/:id/ajuste', async (req, res) => {
  const { id } = req.params;
  const { cantidad, motivo } = req.body;

  const cantidadNum = Number(cantidad);
  if (!cantidadNum || cantidadNum === 0 || Number.isNaN(cantidadNum)) {
    return res.status(400).json({ error: 'La cantidad del ajuste no puede ser cero.' });
  }
  if (!motivo?.trim()) {
    return res.status(400).json({ error: 'El motivo del ajuste es obligatorio.' });
  }

  try {
    const insumo = await pool.query('SELECT id FROM insumos WHERE id = $1', [id]);
    if (insumo.rows.length === 0) {
      return res.status(404).json({ error: 'Insumo no encontrado.' });
    }

    const resultado = await pool.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, responsable_id, motivo)
       VALUES ($1, 'ajuste', $2, $3, $4)
       RETURNING id, tipo, cantidad, fecha, motivo`,
      [id, cantidadNum, req.usuario.id, motivo.trim()]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el ajuste.' });
  }
});

// POST /api/insumos/:id/merma
// Merma manual de un insumo (RF-13: "registrar mermas y desperdicios de
// forma independiente al inventario regular, indicando causa y responsable")
// — para lo que NO viene de cancelar una venta: se cayó el bote de aceite,
// caducó el queso, etc. A diferencia de un ajuste cualquiera, queda
// clasificada como merma en DOS lugares a la vez, en una sola transacción:
//   - `movimientos_inventario` (tipo 'merma'): es lo que de verdad baja la
//     existencia calculada del insumo.
//   - `mermas` (insumo_id, sin variante_id): el mismo registro financiero/de
//     auditoría que ya usa la cancelación de ventas, pero a nivel insumo en
//     vez de a nivel producto vendido.
// cantidad siempre positiva (cuánto se perdió); motivo obligatorio, como en
// /ajuste.
router.post('/:id/merma', async (req, res) => {
  const { id } = req.params;
  const { cantidad, motivo } = req.body;

  const cantidadNum = Number(cantidad);
  if (!cantidadNum || cantidadNum <= 0) {
    return res.status(400).json({ error: 'La cantidad de la merma debe ser mayor a cero.' });
  }
  if (!motivo?.trim()) {
    return res.status(400).json({ error: 'El motivo de la merma es obligatorio.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insumo = await client.query('SELECT id FROM insumos WHERE id = $1', [id]);
    if (insumo.rows.length === 0) {
      throw { status: 404, mensaje: 'Insumo no encontrado.' };
    }

    const movimiento = await client.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, responsable_id, motivo)
       VALUES ($1, 'merma', $2, $3, $4)
       RETURNING id, tipo, cantidad, fecha, motivo`,
      [id, cantidadNum, req.usuario.id, motivo.trim()]
    );

    await client.query(
      `INSERT INTO mermas (insumo_id, cantidad, motivo, responsable_id)
       VALUES ($1, $2, $3, $4)`,
      [id, cantidadNum, motivo.trim(), req.usuario.id]
    );

    await client.query('COMMIT');
    res.status(201).json(movimiento.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la merma.' });
  } finally {
    client.release();
  }
});

module.exports = router;
