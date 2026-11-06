// =============================================================================
// routes/lealtad.js — CONFIGURACIÓN DEL PROGRAMA DE LEALTAD (2026-10-31)
// =============================================================================
// Antes el ciclo de 10 visitas, los escalones (visita 5 = 5%, visita 10 =
// 15%) y el monto mínimo de compra ($100) estaban hardcodeados en
// routes/ventas.js. El usuario pidió poder editarlo todo desde la app, sin
// tocar código — ver migraciones/2026-10-31_lealtad_config.sql.
//
// El CÓMPUTO de la visita/descuento sigue viviendo en routes/ventas.js (ahí
// se conoce el subtotal real de la compra) — este archivo es solo el
// CRUD de la configuración:
//
//   GET    /config              → { ciclo_visitas, monto_minimo_compra }
//                                  (cualquier rol con sesión — el POS lo
//                                  necesita para la vista previa del
//                                  descuento antes de cobrar)
//   PATCH  /config               → editar ciclo/monto mínimo
//                                  (administrador, encargado)
//   GET    /escalones            → lista de escalones, ordenada por visita
//                                  (cualquier rol con sesión — el ticket del
//                                  POS los necesita para dibujar el avance)
//   POST   /escalones            → crear un escalón nuevo
//                                  (administrador, encargado)
//   PATCH  /escalones/:id        → editar un escalón
//                                  (administrador, encargado)
//   DELETE /escalones/:id        → quitar un escalón
//                                  (administrador, encargado)
//
// Mismo criterio de roles que el resto del sistema: leer la configuración es
// casi tan abierto como el resto del catálogo (cualquier cajero necesita
// saber el descuento antes de cobrar); EDITARLA es gestión del negocio,
// mismo nivel que Clientes/Insumos (administrador, encargado) — no se
// restringió a "solo administrador" porque no es un ajuste de sistema (como
// la bitácora o el secreto de JWT), es una regla de negocio que el
// encargado también debe poder ajustar.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();
require('../utils/validarParametros').validarParametrosId(router);

const ROLES_EDICION = ['administrador', 'encargado'];

router.use(verificarToken);

function idValido(id) {
  return /^\d+$/.test(id);
}

// ---------------------------------------------------------------------------
// CONFIG (ciclo de visitas + monto mínimo)
// ---------------------------------------------------------------------------

// GET /api/lealtad/config
router.get('/config', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT ciclo_visitas, monto_minimo_compra, editado_por, u.nombre AS editado_por_nombre, fecha_edicion
       FROM lealtad_config l
       LEFT JOIN usuarios u ON u.id = l.editado_por
       WHERE l.id = 1`,
    );
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener la configuración de lealtad.' });
  }
});

// PATCH /api/lealtad/config — Cuerpo: { ciclo_visitas?, monto_minimo_compra? }
router.patch('/config', requiereRol(...ROLES_EDICION), async (req, res) => {
  const { ciclo_visitas, monto_minimo_compra } = req.body;

  if (ciclo_visitas !== undefined && (!Number.isInteger(ciclo_visitas) || ciclo_visitas <= 0)) {
    return res.status(400).json({ error: 'El largo del ciclo debe ser un número entero mayor a cero.' });
  }
  if (monto_minimo_compra !== undefined && (typeof monto_minimo_compra !== 'number' || monto_minimo_compra < 0)) {
    return res.status(400).json({ error: 'El monto mínimo no puede ser negativo.' });
  }

  try {
    const actual = await pool.query('SELECT ciclo_visitas FROM lealtad_config WHERE id = 1');
    const cicloNuevo = ciclo_visitas !== undefined ? ciclo_visitas : actual.rows[0].ciclo_visitas;

    // Si el ciclo se acorta, ningún escalón existente puede quedar más allá
    // del nuevo largo — se rechaza en vez de dejar un escalón "inalcanzable"
    // en silencio (ej. bajar el ciclo a 8 con un escalón capturado en la
    // visita 10).
    if (ciclo_visitas !== undefined) {
      const fueraDeRango = await pool.query(
        'SELECT visita_numero FROM lealtad_escalones WHERE visita_numero > $1 ORDER BY visita_numero',
        [cicloNuevo],
      );
      if (fueraDeRango.rows.length > 0) {
        return res.status(400).json({
          error: `Hay escalones capturados más allá de la visita ${cicloNuevo} (ej. visita ${fueraDeRango.rows[0].visita_numero}). Edítalos o elimínalos antes de acortar el ciclo.`,
        });
      }
    }

    await pool.query(
      `UPDATE lealtad_config
       SET ciclo_visitas = $1, monto_minimo_compra = $2, editado_por = $3, fecha_edicion = NOW()
       WHERE id = 1`,
      [
        cicloNuevo,
        monto_minimo_compra !== undefined ? monto_minimo_compra : actual.rows[0].monto_minimo_compra,
        req.usuario.id,
      ],
    );
    const resultado = await pool.query(
      `SELECT ciclo_visitas, monto_minimo_compra, editado_por, u.nombre AS editado_por_nombre, fecha_edicion
       FROM lealtad_config l
       LEFT JOIN usuarios u ON u.id = l.editado_por
       WHERE l.id = 1`,
    );
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar la configuración de lealtad.' });
  }
});

// ---------------------------------------------------------------------------
// ESCALONES (en qué visita, qué % de descuento)
// ---------------------------------------------------------------------------
const SELECT_ESCALON = `
  SELECT e.id, e.visita_numero, e.porcentaje_descuento, e.descripcion,
         e.editado_por, u.nombre AS editado_por_nombre, e.fecha_edicion
  FROM lealtad_escalones e
  LEFT JOIN usuarios u ON u.id = e.editado_por
`;

// GET /api/lealtad/escalones
router.get('/escalones', async (req, res) => {
  try {
    const resultado = await pool.query(`${SELECT_ESCALON} ORDER BY e.visita_numero`);
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los escalones de lealtad.' });
  }
});

// Valida visita_numero/porcentaje contra el ciclo vigente. Lanza
// { status, mensaje } — quien llama decide cómo responder.
async function validarEscalon({ visita_numero, porcentaje_descuento }) {
  if (!Number.isInteger(visita_numero) || visita_numero <= 0) {
    throw { status: 400, mensaje: 'El número de visita debe ser un entero mayor a cero.' };
  }
  if (typeof porcentaje_descuento !== 'number' || porcentaje_descuento <= 0 || porcentaje_descuento > 100) {
    throw { status: 400, mensaje: 'El porcentaje de descuento debe ser mayor a 0 y hasta 100.' };
  }
  const config = await pool.query('SELECT ciclo_visitas FROM lealtad_config WHERE id = 1');
  const ciclo = config.rows[0].ciclo_visitas;
  if (visita_numero > ciclo) {
    throw {
      status: 400,
      mensaje: `El ciclo actual dura ${ciclo} visitas — no se puede capturar un escalón en la visita ${visita_numero}.`,
    };
  }
}

// POST /api/lealtad/escalones — Cuerpo: { visita_numero, porcentaje_descuento, descripcion? }
router.post('/escalones', requiereRol(...ROLES_EDICION), async (req, res) => {
  try {
    await validarEscalon(req.body);
    const resultado = await pool.query(
      `INSERT INTO lealtad_escalones (visita_numero, porcentaje_descuento, descripcion, editado_por, fecha_edicion)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [req.body.visita_numero, req.body.porcentaje_descuento, req.body.descripcion?.trim() || null, req.usuario.id],
    );
    const fila = await pool.query(`${SELECT_ESCALON} WHERE e.id = $1`, [resultado.rows[0].id]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un escalón capturado para esa visita.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al crear el escalón de lealtad.' });
  }
});

// PATCH /api/lealtad/escalones/:id
router.patch('/escalones/:id', requiereRol(...ROLES_EDICION), async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: 'El id debe ser numérico.' });
  }
  try {
    const actual = await pool.query('SELECT * FROM lealtad_escalones WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Escalón no encontrado.' });
    }
    const fila = actual.rows[0];
    const visitaNumero = req.body.visita_numero !== undefined ? req.body.visita_numero : fila.visita_numero;
    const porcentaje =
      req.body.porcentaje_descuento !== undefined ? req.body.porcentaje_descuento : Number(fila.porcentaje_descuento);
    await validarEscalon({ visita_numero: visitaNumero, porcentaje_descuento: porcentaje });

    const descripcion = req.body.descripcion !== undefined ? req.body.descripcion?.trim() || null : fila.descripcion;

    await pool.query(
      `UPDATE lealtad_escalones
       SET visita_numero = $1, porcentaje_descuento = $2, descripcion = $3, editado_por = $4, fecha_edicion = NOW()
       WHERE id = $5`,
      [visitaNumero, porcentaje, descripcion, req.usuario.id, id],
    );
    const resultado = await pool.query(`${SELECT_ESCALON} WHERE e.id = $1`, [id]);
    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.mensaje });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un escalón capturado para esa visita.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el escalón de lealtad.' });
  }
});

// DELETE /api/lealtad/escalones/:id
router.delete('/escalones/:id', requiereRol(...ROLES_EDICION), async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: 'El id debe ser numérico.' });
  }
  try {
    const resultado = await pool.query('DELETE FROM lealtad_escalones WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Escalón no encontrado.' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el escalón de lealtad.' });
  }
});

module.exports = router;
