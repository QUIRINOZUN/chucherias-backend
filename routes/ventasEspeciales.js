// =============================================================================
// routes/ventasEspeciales.js — AGENDAR Y COTIZAR (desayunos, comidas, sorpresas)
// =============================================================================
// Endpoints (prefijo /api/ventas-especiales), administrador/encargado/cajero
// — mismos roles que ya cobran en el POS, porque cotizar es parte de atender
// a un cliente en mostrador o por teléfono:
//
//   GET   /?desde=&hasta=&estado=&buscar=   → agenda de cotizaciones, todos
//                                              los filtros opcionales y
//                                              combinables (sin filtros, todo
//                                              el histórico — mismo criterio
//                                              que mermas/reportes).
//   GET   /:id                              → detalle completo, con sus
//                                              productos cotizados.
//   POST  /                                 → crear una cotización (cabecera
//                                              + productos, en una sola
//                                              transacción).
//   PATCH /:id                              → editar cabecera (cliente,
//                                              tipo, fecha/hora, notas,
//                                              estado) y, si llega `items`,
//                                              reemplazar TODOS los
//                                              productos cotizados de una
//                                              vez (mismo patrón de
//                                              reemplazo-completo que ya
//                                              usan routes/horarios.js y
//                                              routes/recetas.js).
//
// CONCEPTO CLAVE: esto NO es una venta real todavía — es una cotización con
// fecha agendada, pensada para planear un pedido grande con anticipación
// (desayuno, comida, sorpresa especial). No toca caja, inventario ni el
// tablero de comandas; si el evento se concreta, se cobra como cualquier
// venta normal desde el POS el día del evento (fuera de alcance aquí, ver
// CLAUDE.md).
//
// REGLA DE ORO (igual que en routes/ventas.js): el precio de cada producto
// NUNCA viene del cliente — el frontend solo manda qué variante y cuántas;
// el precio se lee de variantes_producto en el servidor y se congela en
// venta_especial_detalle.precio_unitario.
// =============================================================================
const express = require("express");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const { fechaValida } = require("../utils/fecha");

const router = express.Router();

const TIPOS_VALIDOS = ["desayuno", "comida", "sorpresa", "otro"];
const ESTADOS_VALIDOS = ["cotizada", "confirmada", "entregada", "cancelada"];
const ROLES_VENTAS_ESPECIALES = ["administrador", "encargado", "cajero"];

router.use(verificarToken);
router.use(requiereRol(...ROLES_VENTAS_ESPECIALES));

function idValido(id) {
  return /^\d+$/.test(id);
}

// Valida y normaliza la lista de productos cotizados contra los precios
// reales de variantes_producto. Lanza { status, mensaje } (capturado por
// quien llama, dentro de su propio try/catch) si algo no es válido — nunca
// devuelve la respuesta HTTP directamente, para poder reutilizarse tanto en
// crear como en editar.
async function resolverItems(ejecutor, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw {
      status: 400,
      mensaje: "La cotización debe incluir al menos un producto.",
    };
  }

  const varianteIds = items.map((item) => item.variante_id);
  if (varianteIds.some((id) => !Number.isInteger(id))) {
    throw { status: 400, mensaje: "Hay un producto inválido en la lista." };
  }
  for (const item of items) {
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      throw {
        status: 400,
        mensaje: "Cada producto necesita una cantidad válida (mayor a cero).",
      };
    }
  }

  const variantesResultado = await ejecutor.query(
    `SELECT id, precio FROM variantes_producto WHERE id = ANY($1::int[])`,
    [varianteIds],
  );
  const precioPorVariante = {};
  for (const fila of variantesResultado.rows) {
    precioPorVariante[fila.id] = Number(fila.precio);
  }
  for (const id of varianteIds) {
    if (precioPorVariante[id] === undefined) {
      throw {
        status: 400,
        mensaje: `El producto con variante ${id} no existe.`,
      };
    }
  }

  const itemsResueltos = items.map((item) => ({
    variante_id: item.variante_id,
    cantidad: item.cantidad,
    precio_unitario: precioPorVariante[item.variante_id],
    notas: item.notas?.trim() || null,
  }));
  const subtotal = itemsResueltos.reduce(
    (suma, item) => suma + item.precio_unitario * item.cantidad,
    0,
  );
  return { itemsResueltos, subtotal };
}

// Trae la cabecera + sus productos cotizados (con nombre de producto y
// variante, para no obligar al frontend a cruzarlo contra el catálogo
// completo). `ejecutor` es `pool` o un `client` de una transacción en curso
// (mismo `.query`), para poder reutilizar esto justo después de un
// INSERT/UPDATE sin otra conexión.
async function obtenerVentaEspecialCompleta(ejecutor, id) {
  const cabecera = await ejecutor.query(
    `SELECT ve.id, ve.cliente_nombre, ve.cliente_telefono, ve.cliente_direccion, ve.tipo,
            to_char(ve.fecha_evento, 'YYYY-MM-DD') AS fecha_evento, ve.hora_evento, ve.estado,
            ve.notas, ve.subtotal, ve.creado_por, u.nombre AS creado_por_nombre,
            ve.fecha_creacion, ve.fecha_actualizacion
     FROM ventas_especiales ve
     JOIN usuarios u ON u.id = ve.creado_por
     WHERE ve.id = $1`,
    [id],
  );
  if (cabecera.rows.length === 0) return null;

  const items = await ejecutor.query(
    `SELECT d.id, d.variante_id, vp.nombre AS variante_nombre, p.nombre AS producto_nombre,
            d.cantidad, d.precio_unitario, d.notas
     FROM venta_especial_detalle d
     JOIN variantes_producto vp ON vp.id = d.variante_id
     JOIN productos p ON p.id = vp.producto_id
     WHERE d.venta_especial_id = $1
     ORDER BY d.id`,
    [id],
  );
  return { ...cabecera.rows[0], items: items.rows };
}

// GET /api/ventas-especiales?desde=&hasta=&estado=&buscar=
router.get("/", async (req, res) => {
  const { desde, hasta, estado, buscar } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }
  if (estado && !ESTADOS_VALIDOS.includes(estado)) {
    return res
      .status(400)
      .json({
        error: `El estado debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}.`,
      });
  }

  try {
    const resultado = await pool.query(
      `SELECT ve.id, ve.cliente_nombre, ve.cliente_telefono, ve.tipo,
              to_char(ve.fecha_evento, 'YYYY-MM-DD') AS fecha_evento, ve.hora_evento,
              ve.estado, ve.subtotal,
              COUNT(d.id)::int AS total_items
       FROM ventas_especiales ve
       LEFT JOIN venta_especial_detalle d ON d.venta_especial_id = ve.id
       WHERE ($1::date IS NULL OR ve.fecha_evento >= $1::date)
         AND ($2::date IS NULL OR ve.fecha_evento <= $2::date)
         AND ($3::text IS NULL OR ve.estado = $3::text)
         AND (
           $4::text IS NULL
           OR ve.cliente_nombre ILIKE '%' || $4 || '%'
           OR ve.cliente_telefono ILIKE '%' || $4 || '%'
         )
       GROUP BY ve.id
       ORDER BY ve.fecha_evento ASC, ve.hora_evento ASC NULLS LAST`,
      [desde || null, hasta || null, estado || null, buscar?.trim() || null],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener las ventas especiales." });
  }
});

// GET /api/ventas-especiales/:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }

  try {
    const fila = await obtenerVentaEspecialCompleta(pool, id);
    if (!fila) {
      return res.status(404).json({ error: "Venta especial no encontrada." });
    }
    res.json(fila);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener la venta especial." });
  }
});

// POST /api/ventas-especiales
// Cuerpo esperado:
//   { cliente_nombre, cliente_telefono?, cliente_direccion?, tipo?,
//     fecha_evento, hora_evento?, notas?,
//     items: [{ variante_id, cantidad, notas? }] }
router.post("/", async (req, res) => {
  const {
    cliente_nombre,
    cliente_telefono,
    cliente_direccion,
    fecha_evento,
    hora_evento,
    notas,
    items,
  } = req.body;
  const tipo = req.body.tipo || "otro";

  if (!cliente_nombre?.trim()) {
    return res
      .status(400)
      .json({ error: "El nombre del cliente es obligatorio." });
  }
  if (!fecha_evento || !fechaValida(fecha_evento)) {
    return res
      .status(400)
      .json({ error: "La fecha del evento debe tener el formato AAAA-MM-DD." });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res
      .status(400)
      .json({ error: `El tipo debe ser uno de: ${TIPOS_VALIDOS.join(", ")}.` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { itemsResueltos, subtotal } = await resolverItems(client, items);

    const cabecera = await client.query(
      `INSERT INTO ventas_especiales
         (cliente_nombre, cliente_telefono, cliente_direccion, tipo, fecha_evento,
          hora_evento, notas, subtotal, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        cliente_nombre.trim(),
        cliente_telefono?.trim() || null,
        cliente_direccion?.trim() || null,
        tipo,
        fecha_evento,
        hora_evento || null,
        notas?.trim() || null,
        subtotal,
        req.usuario.id,
      ],
    );
    const ventaEspecialId = cabecera.rows[0].id;

    for (const item of itemsResueltos) {
      await client.query(
        `INSERT INTO venta_especial_detalle (venta_especial_id, variante_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          ventaEspecialId,
          item.variante_id,
          item.cantidad,
          item.precio_unitario,
          item.notas,
        ],
      );
    }

    await client.query("COMMIT");
    res
      .status(201)
      .json(await obtenerVentaEspecialCompleta(client, ventaEspecialId));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: "Error al crear la venta especial." });
  } finally {
    client.release();
  }
});

// PATCH /api/ventas-especiales/:id
// Edición parcial: cada campo que no llegue (undefined) conserva su valor
// actual. Si llega `items`, reemplaza TODOS los productos cotizados de una
// vez (mismo criterio que PUT /api/horarios/empleado/:id) y recalcula el
// subtotal — nunca se mezcla un item nuevo con los viejos a medias.
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }
  const body = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const actual = await client.query(
      "SELECT * FROM ventas_especiales WHERE id = $1",
      [id],
    );
    if (actual.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Venta especial no encontrada." });
    }
    const actualFila = actual.rows[0];
    // fecha_evento llega de un SELECT * crudo (no de to_char()): es un Date
    // en UTC medianoche. Se convierte a texto AAAA-MM-DD ANTES de usarlo de
    // vuelta en el UPDATE, para no arriesgar que el driver la corra un día
    // (mismo bug ya corregido antes en PATCH /api/asistencias/:id).
    const fechaEventoActualTexto = actualFila.fecha_evento
      .toISOString()
      .slice(0, 10);

    if (body.cliente_nombre !== undefined && !body.cliente_nombre.trim()) {
      throw {
        status: 400,
        mensaje: "El nombre del cliente no puede quedar vacío.",
      };
    }
    if (body.tipo !== undefined && !TIPOS_VALIDOS.includes(body.tipo)) {
      throw {
        status: 400,
        mensaje: `El tipo debe ser uno de: ${TIPOS_VALIDOS.join(", ")}.`,
      };
    }
    if (body.estado !== undefined && !ESTADOS_VALIDOS.includes(body.estado)) {
      throw {
        status: 400,
        mensaje: `El estado debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}.`,
      };
    }
    if (body.fecha_evento !== undefined && !fechaValida(body.fecha_evento)) {
      throw {
        status: 400,
        mensaje: "La fecha del evento debe tener el formato AAAA-MM-DD.",
      };
    }

    let nuevoSubtotal = Number(actualFila.subtotal);
    let itemsResueltos = null;
    if (body.items !== undefined) {
      const resuelto = await resolverItems(client, body.items);
      itemsResueltos = resuelto.itemsResueltos;
      nuevoSubtotal = resuelto.subtotal;
    }

    const nombre =
      body.cliente_nombre !== undefined
        ? body.cliente_nombre.trim()
        : actualFila.cliente_nombre;
    const telefono =
      body.cliente_telefono !== undefined
        ? body.cliente_telefono?.trim() || null
        : actualFila.cliente_telefono;
    const direccion =
      body.cliente_direccion !== undefined
        ? body.cliente_direccion?.trim() || null
        : actualFila.cliente_direccion;
    const tipo = body.tipo !== undefined ? body.tipo : actualFila.tipo;
    const fechaEvento =
      body.fecha_evento !== undefined
        ? body.fecha_evento
        : fechaEventoActualTexto;
    const horaEvento =
      body.hora_evento !== undefined
        ? body.hora_evento || null
        : actualFila.hora_evento;
    const estado = body.estado !== undefined ? body.estado : actualFila.estado;
    const notas =
      body.notas !== undefined ? body.notas?.trim() || null : actualFila.notas;

    await client.query(
      `UPDATE ventas_especiales
       SET cliente_nombre = $1, cliente_telefono = $2, cliente_direccion = $3, tipo = $4,
           fecha_evento = $5, hora_evento = $6, estado = $7, notas = $8, subtotal = $9,
           fecha_actualizacion = NOW()
       WHERE id = $10`,
      [
        nombre,
        telefono,
        direccion,
        tipo,
        fechaEvento,
        horaEvento,
        estado,
        notas,
        nuevoSubtotal,
        id,
      ],
    );

    if (itemsResueltos) {
      await client.query(
        "DELETE FROM venta_especial_detalle WHERE venta_especial_id = $1",
        [id],
      );
      for (const item of itemsResueltos) {
        await client.query(
          `INSERT INTO venta_especial_detalle (venta_especial_id, variante_id, cantidad, precio_unitario, notas)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            item.variante_id,
            item.cantidad,
            item.precio_unitario,
            item.notas,
          ],
        );
      }
    }

    await client.query("COMMIT");
    res.json(await obtenerVentaEspecialCompleta(client, id));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ error: "Error al actualizar la venta especial." });
  } finally {
    client.release();
  }
});

module.exports = router;
