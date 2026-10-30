// =============================================================================
// routes/checklist.js — CHECKLIST DE APERTURA/CIERRE (2026-10-16)
// =============================================================================
// La entrevista con la titular lo pidió explícitamente ("Preguntas de
// cierre y priorización" #12): "El checklist de apertura y cierre (gas,
// luces, limpieza); aunque parece sencillo, es clave para la operación
// diaria." No existía nada de esto en el sistema.
//
// Endpoints (prefijo /api/checklist), todos exigen sesión:
//   GET    /items?tipo=apertura|cierre&todos=1  → catálogo (cualquier rol
//                                                  operativo; ?todos=1 trae
//                                                  también los inactivos,
//                                                  para la pantalla de
//                                                  gestión — admin/encargado)
//   POST   /items                                → crear un item (administrador/encargado)
//   PATCH  /items/:id                             → editar/activar-desactivar (administrador/encargado)
//   GET    /hoy?tipo=apertura|cierre              → catálogo de hoy con su
//                                                    estado (marcado o no)
//   POST   /marcar                                 → marcar un item como hecho HOY
//   DELETE /marcar/:itemId                         → desmarcarlo (por si se equivocaron)
//   GET    /historial?desde=&hasta=&tipo=           → quién marcó qué y
//                                                      cuándo, en cualquier
//                                                      rango (2026-10-16,
//                                                      administrador/encargado)
//
// QUIÉN PUEDE QUÉ: el checklist lo marca quien abre/cierra el negocio —
// según la entrevista, eso puede ser el encargado, el auxiliar de cocina o
// el cajero (nunca solo el titular). Administrar el CATÁLOGO (agregar,
// renombrar, desactivar un paso) y CONSULTAR el historial de días
// anteriores sí quedan reservados a administrador/encargado — mismo
// criterio que el resto de catálogos personalizables y de información de
// supervisión del sistema (categorías de insumo, categorías del menú,
// historial de asistencias).
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { registrarAccion } = require('../utils/bitacora');
const { fechaHoyNegocio, fechaValida } = require('../utils/fecha');

const router = express.Router();

const ROLES_OPERATIVOS = ['administrador', 'encargado', 'cajero', 'auxiliar'];
const TIPOS_VALIDOS = ['apertura', 'cierre'];

router.use(verificarToken);

function tipoValido(tipo) {
  return !tipo || TIPOS_VALIDOS.includes(tipo);
}

// GET /api/checklist/items?tipo=&todos=1
router.get('/items', requiereRol(...ROLES_OPERATIVOS), async (req, res) => {
  const { tipo } = req.query;
  if (!tipoValido(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "apertura" o "cierre".' });
  }
  const incluirInactivos = req.query.todos === '1';

  try {
    const condiciones = [];
    const valores = [];
    if (tipo) {
      valores.push(tipo);
      condiciones.push(`tipo = $${valores.length}`);
    }
    if (!incluirInactivos) {
      condiciones.push('activo = TRUE');
    }
    const resultado = await pool.query(
      `SELECT id, tipo, descripcion, orden, activo FROM checklist_items
       ${condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY tipo, orden, id`,
      valores,
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el checklist.' });
  }
});

// GET /api/checklist/hoy?tipo=apertura|cierre
// El catálogo activo de ese tipo, con si ya se marcó hoy, quién y a qué hora.
router.get('/hoy', requiereRol(...ROLES_OPERATIVOS), async (req, res) => {
  const { tipo } = req.query;
  if (!tipoValido(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "apertura" o "cierre".' });
  }

  try {
    const resultado = await pool.query(
      `SELECT ci.id, ci.tipo, ci.descripcion, ci.orden,
              cm.id IS NOT NULL AS marcado,
              u.nombre AS marcado_por_nombre,
              cm.fecha_marcado
       FROM checklist_items ci
       LEFT JOIN checklist_marcas cm ON cm.item_id = ci.id AND cm.fecha = $1
       LEFT JOIN usuarios u ON u.id = cm.marcado_por
       WHERE ci.activo = TRUE ${tipo ? 'AND ci.tipo = $2' : ''}
       ORDER BY ci.tipo, ci.orden, ci.id`,
      tipo ? [fechaHoyNegocio(), tipo] : [fechaHoyNegocio()],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el checklist de hoy.' });
  }
});

// POST /api/checklist/marcar { item_id }
router.post('/marcar', requiereRol(...ROLES_OPERATIVOS), async (req, res) => {
  const { item_id } = req.body;
  if (!Number.isInteger(item_id)) {
    return res.status(400).json({ error: 'item_id es obligatorio.' });
  }

  try {
    const item = await pool.query('SELECT 1 FROM checklist_items WHERE id = $1 AND activo = TRUE', [item_id]);
    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'El paso del checklist no existe.' });
    }

    // ON CONFLICT DO NOTHING: si alguien ya lo marcó hoy, se queda con el
    // primero que lo hizo — no se pisa quién/cuándo por un segundo toque.
    await pool.query(
      `INSERT INTO checklist_marcas (item_id, fecha, marcado_por)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id, fecha) DO NOTHING`,
      [item_id, fechaHoyNegocio(), req.usuario.id],
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al marcar el paso.' });
  }
});

// DELETE /api/checklist/marcar/:itemId — desmarcar HOY (por si se equivocaron).
router.delete('/marcar/:itemId', requiereRol(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    await pool.query('DELETE FROM checklist_marcas WHERE item_id = $1 AND fecha = $2', [
      req.params.itemId,
      fechaHoyNegocio(),
    ]);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al desmarcar el paso.' });
  }
});

// GET /api/checklist/historial?desde=&hasta=&tipo=
// Quién marcó qué y a qué hora, en cualquier rango de fechas (sin filtros,
// TODO el histórico — mismo criterio que routes/mermas.js). A diferencia
// de marcar/desmarcar (cualquier rol operativo), CONSULTAR el historial es
// una acción de supervisión — administrador/encargado, mismo criterio que
// el historial de asistencias o el reporte de mermas (RNF-03).
router.get('/historial', requiereRol('administrador', 'encargado'), async (req, res) => {
  const { desde, hasta, tipo } = req.query;
  if (!tipoValido(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "apertura" o "cierre".' });
  }
  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }

  try {
    const resultado = await pool.query(
      `SELECT cm.id, ci.tipo, ci.descripcion, cm.fecha,
                u.nombre AS marcado_por_nombre, cm.fecha_marcado
         FROM checklist_marcas cm
         JOIN checklist_items ci ON ci.id = cm.item_id
         JOIN usuarios u ON u.id = cm.marcado_por
         WHERE ($1::date IS NULL OR cm.fecha >= $1::date)
           AND ($2::date IS NULL OR cm.fecha <= $2::date)
           AND ($3::text IS NULL OR ci.tipo = $3)
         ORDER BY cm.fecha DESC, cm.fecha_marcado DESC`,
      [desde || null, hasta || null, tipo || null],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el historial.' });
  }
});

// DELETE /api/checklist/historial?desde=&hasta=
// Elimina las marcas de apertura/cierre del rango [desde, hasta] (ambos
// obligatorios) — irreversible. Solo administrador (consultar el historial
// de arriba ya es admin/encargado; esta acción se restringe más).
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
      'DELETE FROM checklist_marcas WHERE fecha >= $1::date AND fecha <= $2::date RETURNING id',
      [desde, hasta],
    );

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'eliminar_historial',
      detalle: `Checklist: ${resultado.rows.length} marca(s) del ${desde} al ${hasta}.`,
    });

    res.json({ eliminados: resultado.rows.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el historial del checklist.' });
  }
});

// A partir de aquí, solo gestión del catálogo (administrador/encargado) —
// personalizar los pasos es una decisión de negocio, no una acción diaria.
router.use(requiereRol('administrador', 'encargado'));

// POST /api/checklist/items { tipo, descripcion, orden? }
router.post('/items', async (req, res) => {
  const descripcion = (req.body.descripcion || '').trim();
  const { tipo } = req.body;
  const orden = Number.isInteger(req.body.orden) ? req.body.orden : 0;

  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "apertura" o "cierre".' });
  }
  if (!descripcion) {
    return res.status(400).json({ error: 'La descripción es obligatoria.' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO checklist_items (tipo, descripcion, orden)
       VALUES ($1, $2, $3)
       RETURNING id, tipo, descripcion, orden, activo`,
      [tipo, descripcion, orden],
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el paso.' });
  }
});

// PATCH /api/checklist/items/:id { descripcion?, orden?, activo? }
router.patch('/items/:id', async (req, res) => {
  const { id } = req.params;
  const campos = [];
  const valores = [];

  if (req.body.descripcion !== undefined) {
    const descripcion = String(req.body.descripcion).trim();
    if (!descripcion) {
      return res.status(400).json({ error: 'La descripción no puede quedar vacía.' });
    }
    valores.push(descripcion);
    campos.push(`descripcion = $${valores.length}`);
  }
  if (req.body.orden !== undefined) {
    valores.push(req.body.orden);
    campos.push(`orden = $${valores.length}`);
  }
  if (req.body.activo !== undefined) {
    valores.push(!!req.body.activo);
    campos.push(`activo = $${valores.length}`);
  }
  if (campos.length === 0) {
    return res.status(400).json({ error: 'No hay nada que actualizar.' });
  }

  try {
    valores.push(id);
    const resultado = await pool.query(
      `UPDATE checklist_items SET ${campos.join(', ')} WHERE id = $${valores.length}
       RETURNING id, tipo, descripcion, orden, activo`,
      valores,
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'El paso no existe.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al editar el paso.' });
  }
});

module.exports = router;
