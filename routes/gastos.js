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
//   POST   /                     → registrar un gasto
//   PATCH  /:id                  → editar (deja auditoría RNF-02)
//   DELETE /:id                  → eliminar (un gasto no tiene historial
//                                   transaccional que dependa de él, a
//                                   diferencia de una venta — corregir un
//                                   error de captura no necesita el patrón
//                                   de "nunca se borra")
//   DELETE /historial?desde=&hasta= → ELIMINA todos los gastos del rango de
//                                   una vez, irreversible (solo administrador)
// =============================================================================
const express = require("express");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const { fechaValida } = require("../utils/fecha");

const router = express.Router();

const FORMAS_PAGO_VALIDAS = ["efectivo", "transferencia"];

router.use(verificarToken);
router.use(requiereRol("administrador", "encargado"));

function idValido(id) {
  return /^\d+$/.test(id);
}

const SELECT_GASTO = `
  SELECT g.id, g.categoria_id, cg.nombre AS categoria, g.concepto, g.monto,
         to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.forma_pago, g.es_recurrente,
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
router.get("/categorias", async (req, res) => {
  try {
    const resultado = await pool.query(
      "SELECT id, nombre FROM categorias_gasto ORDER BY nombre",
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Error al obtener las categorías de gasto." });
  }
});

// POST /api/gastos/categorias
router.post("/categorias", async (req, res) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) {
    return res
      .status(400)
      .json({ error: "El nombre de la categoría es obligatorio." });
  }
  try {
    const resultado = await pool.query(
      "INSERT INTO categorias_gasto (nombre) VALUES ($1) RETURNING id, nombre",
      [nombre.trim()],
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "Ya existe una categoría con ese nombre." });
    }
    console.error(error);
    res.status(500).json({ error: "Error al crear la categoría de gasto." });
  }
});

// GET /api/gastos?desde=&hasta=&categoria_id=&forma_pago=&proveedor_id=&buscar=
router.get("/", async (req, res) => {
  const { desde, hasta, categoria_id, forma_pago, proveedor_id, buscar } =
    req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }
  if (categoria_id && !idValido(categoria_id)) {
    return res
      .status(400)
      .json({ error: "El id de categoría debe ser numérico." });
  }
  if (proveedor_id && !idValido(proveedor_id)) {
    return res
      .status(400)
      .json({ error: "El id de proveedor debe ser numérico." });
  }
  if (forma_pago && !FORMAS_PAGO_VALIDAS.includes(forma_pago)) {
    return res
      .status(400)
      .json({
        error: `La forma de pago debe ser una de: ${FORMAS_PAGO_VALIDAS.join(", ")}.`,
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
    res.status(500).json({ error: "Error al obtener los gastos." });
  }
});

// POST /api/gastos
// Cuerpo esperado: { categoria_id, concepto, monto, fecha, forma_pago,
//                     es_recurrente?, proveedor_id?, nota? }
router.post("/", async (req, res) => {
  const {
    categoria_id,
    concepto,
    monto,
    fecha,
    forma_pago,
    es_recurrente,
    proveedor_id,
    nota,
  } = req.body;

  if (!Number.isInteger(categoria_id)) {
    return res.status(400).json({ error: "La categoría es obligatoria." });
  }
  if (!concepto?.trim()) {
    return res.status(400).json({ error: "El concepto es obligatorio." });
  }
  if (typeof monto !== "number" || monto <= 0) {
    return res.status(400).json({ error: "El monto debe ser mayor a cero." });
  }
  if (!fecha || !fechaValida(fecha)) {
    return res
      .status(400)
      .json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
  }
  if (!FORMAS_PAGO_VALIDAS.includes(forma_pago)) {
    return res
      .status(400)
      .json({
        error: `La forma de pago debe ser una de: ${FORMAS_PAGO_VALIDAS.join(", ")}.`,
      });
  }
  if (
    proveedor_id !== undefined &&
    proveedor_id !== null &&
    !Number.isInteger(proveedor_id)
  ) {
    return res.status(400).json({ error: "El proveedor es inválido." });
  }

  try {
    const categoria = await pool.query(
      "SELECT id FROM categorias_gasto WHERE id = $1",
      [categoria_id],
    );
    if (categoria.rows.length === 0) {
      return res.status(400).json({ error: "La categoría no existe." });
    }
    if (proveedor_id) {
      const proveedor = await pool.query(
        "SELECT id FROM proveedores WHERE id = $1",
        [proveedor_id],
      );
      if (proveedor.rows.length === 0) {
        return res.status(400).json({ error: "El proveedor no existe." });
      }
    }

    const insertado = await pool.query(
      `INSERT INTO gastos
         (categoria_id, concepto, monto, fecha, forma_pago, es_recurrente, proveedor_id, nota, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        categoria_id,
        concepto.trim(),
        monto,
        fecha,
        forma_pago,
        Boolean(es_recurrente),
        proveedor_id || null,
        nota?.trim() || null,
        req.usuario.id,
      ],
    );
    const fila = await pool.query(`${SELECT_GASTO} WHERE g.id = $1`, [
      insertado.rows[0].id,
    ]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al registrar el gasto." });
  }
});

// PATCH /api/gastos/:id — edición parcial; campos ausentes conservan su
// valor actual. Deja auditoría (RNF-02) solo si algo de verdad cambió.
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }
  const body = req.body;

  try {
    const actual = await pool.query("SELECT * FROM gastos WHERE id = $1", [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Gasto no encontrado." });
    }
    const fila = actual.rows[0];

    if (body.categoria_id !== undefined) {
      if (!Number.isInteger(body.categoria_id)) {
        return res.status(400).json({ error: "La categoría es inválida." });
      }
      const categoria = await pool.query(
        "SELECT id FROM categorias_gasto WHERE id = $1",
        [body.categoria_id],
      );
      if (categoria.rows.length === 0) {
        return res.status(400).json({ error: "La categoría no existe." });
      }
    }
    if (body.concepto !== undefined && !body.concepto.trim()) {
      return res
        .status(400)
        .json({ error: "El concepto no puede quedar vacío." });
    }
    if (
      body.monto !== undefined &&
      (typeof body.monto !== "number" || body.monto <= 0)
    ) {
      return res.status(400).json({ error: "El monto debe ser mayor a cero." });
    }
    if (body.fecha !== undefined && !fechaValida(body.fecha)) {
      return res
        .status(400)
        .json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
    }
    if (
      body.forma_pago !== undefined &&
      !FORMAS_PAGO_VALIDAS.includes(body.forma_pago)
    ) {
      return res
        .status(400)
        .json({
          error: `La forma de pago debe ser una de: ${FORMAS_PAGO_VALIDAS.join(", ")}.`,
        });
    }
    if (
      body.proveedor_id !== undefined &&
      body.proveedor_id !== null &&
      !Number.isInteger(body.proveedor_id)
    ) {
      return res.status(400).json({ error: "El proveedor es inválido." });
    }
    if (body.proveedor_id) {
      const proveedor = await pool.query(
        "SELECT id FROM proveedores WHERE id = $1",
        [body.proveedor_id],
      );
      if (proveedor.rows.length === 0) {
        return res.status(400).json({ error: "El proveedor no existe." });
      }
    }

    const categoriaId =
      body.categoria_id !== undefined ? body.categoria_id : fila.categoria_id;
    const concepto =
      body.concepto !== undefined ? body.concepto.trim() : fila.concepto;
    const monto = body.monto !== undefined ? body.monto : Number(fila.monto);
    const fecha =
      body.fecha !== undefined
        ? body.fecha
        : fila.fecha.toISOString().slice(0, 10);
    const formaPago =
      body.forma_pago !== undefined ? body.forma_pago : fila.forma_pago;
    const esRecurrente =
      body.es_recurrente !== undefined
        ? Boolean(body.es_recurrente)
        : fila.es_recurrente;
    const proveedorId =
      body.proveedor_id !== undefined
        ? body.proveedor_id || null
        : fila.proveedor_id;
    const nota =
      body.nota !== undefined ? body.nota?.trim() || null : fila.nota;

    const huboCambio =
      categoriaId !== fila.categoria_id ||
      concepto !== fila.concepto ||
      monto !== Number(fila.monto) ||
      fecha !== fila.fecha.toISOString().slice(0, 10) ||
      formaPago !== fila.forma_pago ||
      esRecurrente !== fila.es_recurrente ||
      proveedorId !== fila.proveedor_id ||
      nota !== fila.nota;

    await pool.query(
      `UPDATE gastos
       SET categoria_id = $1, concepto = $2, monto = $3, fecha = $4, forma_pago = $5,
           es_recurrente = $6, proveedor_id = $7, nota = $8,
           editado_por = CASE WHEN $9 THEN $10 ELSE editado_por END,
           fecha_edicion = CASE WHEN $9 THEN NOW() ELSE fecha_edicion END
       WHERE id = $11`,
      [
        categoriaId,
        concepto,
        monto,
        fecha,
        formaPago,
        esRecurrente,
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
    res.status(500).json({ error: "Error al actualizar el gasto." });
  }
});

// DELETE /api/gastos/historial?desde=&hasta=
// Elimina TODOS los gastos del rango [desde, hasta] (ambos obligatorios) de
// una vez — irreversible. Solo administrador (el resto del archivo ya es
// admin/encargado; esta acción se restringe más). Registrada ANTES de
// DELETE /:id para que Express no intente leer "historial" como un id.
router.delete("/historial", requiereRol("administrador"), async (req, res) => {
  const { desde, hasta } = req.query;

  if (!desde || !hasta) {
    return res
      .status(400)
      .json({ error: "Debes indicar un rango de fechas (desde y hasta)." });
  }
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }
  if (hasta < desde) {
    return res
      .status(400)
      .json({ error: 'La fecha "hasta" no puede ser anterior a "desde".' });
  }

  try {
    const resultado = await pool.query(
      "DELETE FROM gastos WHERE fecha >= $1::date AND fecha <= $2::date RETURNING id",
      [desde, hasta],
    );
    res.json({ eliminados: resultado.rows.length });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Error al eliminar el historial de gastos." });
  }
});

// DELETE /api/gastos/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }
  try {
    const resultado = await pool.query(
      "DELETE FROM gastos WHERE id = $1 RETURNING id",
      [id],
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: "Gasto no encontrado." });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al eliminar el gasto." });
  }
});

module.exports = router;
