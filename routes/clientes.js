// =============================================================================
// routes/clientes.js — CLIENTES Y PROGRAMA DE LEALTAD (Sprint 4, RF-21 a RF-23)
// =============================================================================
// Reglas de negocio (confirmadas con la titular, 2026-10-15):
//   - Una compra cuenta como "visita" solo si su subtotal es de $100 o más, y
//     solo UNA vez por cliente por día (sin importar cuántas compras haga).
//   - El contador de visitas es un CICLO de 10 que se reinicia: al llegar a
//     la visita #5 del ciclo, esa compra recibe 5% de descuento; al llegar a
//     la #10, recibe 15% Y el contador vuelve a 0 (empieza un ciclo nuevo).
//   - El cómputo de visita/descuento vive en routes/ventas.js (es ahí donde
//     se conoce el subtotal real y se registra la venta); este archivo solo
//     administra el catálogo de clientes (buscar, crear, editar, consultar
//     su historial) — NUNCA calcula ni aplica descuentos.
//
// Endpoints (prefijo /api/clientes, todos exigen sesión):
//   GET    /buscar?q=…        → typeahead del POS (administrador/encargado/cajero)
//   POST   /                  → alta rápida (mismos roles, la usa el POS)
//   GET    /                  → listado completo con visitas (administrador/encargado)
//   GET    /:id               → detalle + historial de lealtad + historial
//                                de COMPRAS reales (RF-21, 2026-10-16) —
//                                (administrador/encargado)
//   PATCH  /:id               → editar nombre/teléfono (administrador/encargado)
// =============================================================================
const express = require('express');
const pool = require('../db');
const { tieneColumna } = require('../utils/esquema');
const { fechaHoyNegocio } = require('../utils/fecha');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { registrarAccion } = require('../utils/bitacora');
const { fechaValida, diaNegocioSql } = require('../utils/fecha');

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);

router.use(verificarToken);

// Roles que pueden buscar/crear un cliente desde el punto de venta — mismos
// roles que ya registran ventas (routes/ventas.js).
const ROLES_POS = ['administrador', 'encargado', 'cajero'];

// GET /api/clientes/buscar?q=texto
// Typeahead del cobro: busca por nombre o teléfono (coincidencia parcial,
// sin importar mayúsculas/acentos exactos). Se registró ANTES de /:id para
// que Express no confunda "buscar" con un id.
router.get('/buscar', requiereRol(...ROLES_POS), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json([]);
  }
  try {
    const resultado = await pool.query(
      `SELECT id, nombre_completo, telefono, visitas_acumuladas
       FROM clientes
       WHERE nombre_completo ILIKE $1 OR telefono ILIKE $1
       ORDER BY nombre_completo
       LIMIT 10`,
      [`%${q}%`],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al buscar clientes.' });
  }
});

// POST /api/clientes
// Alta rápida desde el cobro (RF-21): solo nombre es obligatorio, el
// teléfono es opcional pero recomendado (es lo que permite reconocer al
// mismo cliente la próxima vez). Nace con 0 visitas acumuladas.
router.post('/', requiereRol(...ROLES_POS), async (req, res) => {
  const nombreCompleto = (req.body.nombre_completo || '').trim();
  const telefono = (req.body.telefono || '').trim() || null;

  if (!nombreCompleto) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO clientes (nombre_completo, telefono)
       VALUES ($1, $2)
       RETURNING id, nombre_completo, telefono, visitas_acumuladas, fecha_registro`,
      [nombreCompleto, telefono],
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el cliente.' });
  }
});

// A partir de aquí, solo gestión (administrador/encargado) — mismo criterio
// que insumos.js/recetas.js: listar todo y ver el detalle es información de
// gestión, no una acción de mostrador.
router.use(requiereRol('administrador', 'encargado'));

// GET /api/clientes?buscar=texto
// Listado completo para la pantalla de gestión, con un filtro de texto
// opcional (independiente del /buscar de arriba, que es solo para el POS).
router.get('/', async (req, res) => {
  const buscar = (req.query.buscar || '').trim();
  try {
    const resultado = await pool.query(
      buscar
        ? `SELECT id, nombre_completo, telefono, visitas_acumuladas, fecha_registro
           FROM clientes
           WHERE nombre_completo ILIKE $1 OR telefono ILIKE $1
           ORDER BY nombre_completo`
        : `SELECT id, nombre_completo, telefono, visitas_acumuladas, fecha_registro
           FROM clientes
           ORDER BY nombre_completo`,
      buscar ? [`%${buscar}%`] : [],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los clientes.' });
  }
});

// GET /api/clientes/recordatorios?dias=30  (2026-11-16)
// Dos listas para "tratar bien" a la clientela de lealtad:
//   - cumpleanos_mes: quién cumple años este mes (si la columna fecha_nacimiento
//     ya existe; si no, lista vacía y cumpleanos_disponible=false);
//   - inactivos: clientes que ya habían venido pero llevan más de N días (30 por
//     default, entre 7 y 365) sin una visita contada.
// Solo informativo: nunca modifica nada.
router.get('/recordatorios', async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 7), 365);
  try {
    const hayNacimiento = await tieneColumna('clientes', 'fecha_nacimiento');
    let cumpleanos = [];
    if (hayNacimiento) {
      const r = await pool.query(
        `SELECT id, nombre_completo, telefono,
                to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
                EXTRACT(DAY FROM fecha_nacimiento)::int AS dia
         FROM clientes
         WHERE fecha_nacimiento IS NOT NULL
           AND EXTRACT(MONTH FROM fecha_nacimiento) = EXTRACT(MONTH FROM $1::date)
         ORDER BY dia, nombre_completo`,
        [fechaHoyNegocio()],
      );
      cumpleanos = r.rows;
    }
    const inactivos = await pool.query(
      `SELECT c.id, c.nombre_completo, c.telefono, c.visitas_acumuladas,
              MAX(lh.fecha) AS ultima_visita,
              (CURRENT_DATE - MAX(lh.fecha)::date)::int AS dias_sin_venir
       FROM clientes c
       JOIN lealtad_historial lh ON lh.cliente_id = c.id AND lh.tipo_evento = 'visita'
       GROUP BY c.id
       HAVING MAX(lh.fecha) < NOW() - make_interval(days => $1::int)
       ORDER BY ultima_visita DESC
       LIMIT 50`,
      [dias],
    );
    res.json({
      cumpleanos_disponible: hayNacimiento,
      cumpleanos_mes: cumpleanos,
      dias_inactividad: dias,
      inactivos: inactivos.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los recordatorios.' });
  }
});

// GET /api/clientes/:id
// Detalle de un cliente + su historial de lealtad completo (visitas y
// descuentos aplicados, más recientes primero), para poder explicarle a un
// cliente real por qué tiene o no un descuento.
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const colNacimiento = (await tieneColumna('clientes', 'fecha_nacimiento'))
      ? "to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento"
      : 'NULL::text AS fecha_nacimiento';
    const cliente = await pool.query(
      `SELECT id, nombre_completo, telefono, visitas_acumuladas, fecha_registro, ${colNacimiento}
       FROM clientes WHERE id = $1`,
      [id],
    );
    if (cliente.rows.length === 0) {
      return res.status(404).json({ error: 'El cliente no existe.' });
    }

    const historial = await pool.query(
      `SELECT lh.id, lh.tipo_evento, lh.descripcion, lh.fecha, lh.venta_id,
              v.total AS venta_total
       FROM lealtad_historial lh
       LEFT JOIN ventas v ON v.id = lh.venta_id
       WHERE lh.cliente_id = $1
       ORDER BY lh.fecha DESC`,
      [id],
    );

    // RF-21 ("historial de compras") + entrevista ("¿Debe existir
    // historial de compras por cliente? Sí.") — distinto del historial de
    // LEALTAD de arriba (que es solo visitas/descuentos): aquí van las
    // ventas reales de este cliente, con sus productos, sin importar si
    // esa compra llegó a contar como visita (pudo ser menor a $100, o ya
    // había otra visita contada ese mismo día).
    const compras = await pool.query(
      `SELECT v.id, v.fecha, v.subtotal, v.descuento_lealtad, v.total,
              v.metodo_pago, v.estado, o.numero_orden
       FROM ventas v
       JOIN ordenes o ON o.id = v.orden_id
       WHERE o.cliente_id = $1
       ORDER BY v.fecha DESC`,
      [id],
    );

    let itemsPorVenta = {};
    if (compras.rows.length > 0) {
      const ventaIds = compras.rows.map((v) => v.id);
      const items = await pool.query(
        `SELECT v.id AS venta_id, od.cantidad, od.precio_unitario, od.cancelado,
                vp.nombre AS variante_nombre, p.nombre AS producto_nombre
         FROM ventas v
         JOIN orden_detalle od ON od.orden_id = v.orden_id
         JOIN variantes_producto vp ON vp.id = od.variante_id
         JOIN productos p ON p.id = vp.producto_id
         WHERE v.id = ANY($1::int[])`,
        [ventaIds],
      );
      itemsPorVenta = items.rows.reduce((mapa, fila) => {
        if (!mapa[fila.venta_id]) {
          mapa[fila.venta_id] = [];
        }
        mapa[fila.venta_id].push({
          producto: fila.producto_nombre,
          variante: fila.variante_nombre,
          cantidad: fila.cantidad,
          precio_unitario: fila.precio_unitario,
          cancelado: fila.cancelado,
        });
        return mapa;
      }, {});
    }

    const comprasConItems = compras.rows.map((venta) => ({
      ...venta,
      items: itemsPorVenta[venta.id] || [],
    }));

    res.json({
      ...cliente.rows[0],
      historial: historial.rows,
      compras: comprasConItems,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el cliente.' });
  }
});

// PATCH /api/clientes/:id
// Corrige nombre/teléfono (ej. se capturó mal, o el cliente cambió de
// número) — nunca toca visitas_acumuladas, eso solo lo ajusta ventas.js.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const nombreCompleto = (req.body.nombre_completo || '').trim();
  const telefono = (req.body.telefono || '').trim() || null;

  if (!nombreCompleto) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  }

  // Fecha de nacimiento (opcional): undefined = no tocar; ''/null = quitarla.
  const nacimientoRecibido = req.body.fecha_nacimiento;
  let nacimiento;
  if (nacimientoRecibido !== undefined) {
    if (nacimientoRecibido === null || nacimientoRecibido === '') {
      nacimiento = null;
    } else if (fechaValida(nacimientoRecibido) && nacimientoRecibido <= fechaHoyNegocio()) {
      nacimiento = nacimientoRecibido;
    } else {
      return res.status(400).json({ error: 'La fecha de nacimiento no es válida (AAAA-MM-DD, no futura).' });
    }
    if (nacimiento !== null && !(await tieneColumna('clientes', 'fecha_nacimiento'))) {
      return res.status(503).json({ error: 'El cumpleaños todavía no está habilitado en el servidor.' });
    }
  }

  try {
    if (nacimiento !== undefined && (await tieneColumna('clientes', 'fecha_nacimiento'))) {
      await pool.query('UPDATE clientes SET fecha_nacimiento = $1 WHERE id = $2', [nacimiento, id]);
    }
    const resultado = await pool.query(
      `UPDATE clientes SET nombre_completo = $1, telefono = $2
       WHERE id = $3
       RETURNING id, nombre_completo, telefono, visitas_acumuladas, fecha_registro`,
      [nombreCompleto, telefono, id],
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'El cliente no existe.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al editar el cliente.' });
  }
});

// DELETE /api/clientes/historial?desde=&hasta=
// Elimina el historial de LEALTAD (visitas/descuentos aplicados) del rango
// [desde, hasta] (ambos obligatorios) — irreversible. Solo administrador.
// OJO: no toca clientes.visitas_acumuladas — solo borra el REGISTRO de lo
// que pasó, el contador de ciclo de cada cliente se queda como está.
router.delete('/historial', requiereRol('administrador'), async (req, res) => {
  const { desde, hasta } = req.query;

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Debes indicar un rango de fechas (desde y hasta).' });
  }
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (hasta < desde) {
    return res.status(400).json({ error: 'La fecha "hasta" no puede ser anterior a "desde".' });
  }

  try {
    const resultado = await pool.query(
      `DELETE FROM lealtad_historial
         WHERE ${diaNegocioSql('fecha')} >= $1::date AND ${diaNegocioSql('fecha')} <= $2::date
         RETURNING id`,
      [desde, hasta],
    );

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'eliminar_historial',
      detalle: `Lealtad: ${resultado.rows.length} evento(s) del ${desde} al ${hasta}.`,
    });

    res.json({ eliminados: resultado.rows.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el historial de lealtad.' });
  }
});

module.exports = router;
