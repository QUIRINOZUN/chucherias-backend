// =============================================================================
// routes/horarios.js — HORARIO SEMANAL POR EMPLEADO (Sprint 3)
// =============================================================================
// Endpoints (prefijo /api/horarios), solo administrador/encargado — mismo
// criterio que empleados/asistencias, es información de personal.
//
//   GET /?empleado_id=   → horario semanal (todos, o de un empleado)
//   PUT /empleado/:id    → reemplaza COMPLETO el horario semanal de ese
//                          empleado (pensado para un calendario donde se
//                          edita la semana entera y se guarda de una vez)
//
// `horarios` es un horario RECURRENTE: una fila por cada día de la semana
// que el empleado trabaja (sin fila = libre ese día), sin fecha propia — se
// repite cada semana hasta que alguien lo vuelva a guardar. Por ahora solo
// es informativo (para que el administrador/encargado lo consulten); no
// calcula retardos contra `asistencias.hora_entrada` todavía — ver
// CLAUDE.md, pendiente de una fase futura si el usuario lo pide.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

// El negocio opera martes a domingo (cerrado lunes) — ver CLAUDE.md. Se
// valida contra esta lista en vez de solo el CHECK de la base, para dar un
// mensaje claro en vez de un error 500 si llega un día inválido.
const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// GET /api/horarios?empleado_id=
router.get('/', async (req, res) => {
  const { empleado_id } = req.query;
  try {
    const resultado = await pool.query(
      `SELECT h.id, h.empleado_id, e.nombre AS empleado_nombre, h.dia_semana,
              h.hora_entrada, h.hora_salida
       FROM horarios h
       JOIN empleados e ON e.id = h.empleado_id
       WHERE ($1::int IS NULL OR h.empleado_id = $1::int)
       ORDER BY e.nombre, h.id`,
      [empleado_id || null]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los horarios.' });
  }
});

// PUT /api/horarios/empleado/:empleadoId
// Reemplaza TODO el horario semanal de un empleado: body =
// { dias: [{ dia_semana, hora_entrada, hora_salida }, ...] } — solo los días
// que trabaja; un día que no venga en la lista queda libre (se borra si ya
// tenía horario). Reemplazar completo (en vez de ir día por día) evita
// tener que sincronizar altas/bajas/ediciones por separado desde un
// calendario donde se edita la semana entera de una vez.
router.put('/empleado/:empleadoId', async (req, res) => {
  const { empleadoId } = req.params;
  const { dias } = req.body;

  if (!Array.isArray(dias)) {
    return res.status(400).json({ error: '"dias" debe ser una lista.' });
  }

  for (const dia of dias) {
    if (!DIAS_VALIDOS.includes(dia.dia_semana)) {
      return res.status(400).json({ error: `Día inválido: "${dia.dia_semana}".` });
    }
    if (!dia.hora_entrada || !dia.hora_salida) {
      return res
        .status(400)
        .json({ error: `Faltan horas para "${dia.dia_semana}".` });
    }
    if (dia.hora_salida <= dia.hora_entrada) {
      return res
        .status(400)
        .json({ error: `En "${dia.dia_semana}" la salida debe ser posterior a la entrada.` });
    }
  }
  // Un día no debe repetirse dos veces en la misma lista (el UNIQUE de la
  // base lo impediría de todos modos, pero así se da un mensaje claro).
  const diasRepetidos = dias.map((d) => d.dia_semana);
  if (new Set(diasRepetidos).size !== diasRepetidos.length) {
    return res.status(400).json({ error: 'No puedes repetir el mismo día dos veces.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empleado = await client.query('SELECT id FROM empleados WHERE id = $1', [empleadoId]);
    if (empleado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    await client.query('DELETE FROM horarios WHERE empleado_id = $1', [empleadoId]);
    for (const dia of dias) {
      await client.query(
        `INSERT INTO horarios (empleado_id, dia_semana, hora_entrada, hora_salida)
         VALUES ($1, $2, $3, $4)`,
        [empleadoId, dia.dia_semana, dia.hora_entrada, dia.hora_salida]
      );
    }

    await client.query('COMMIT');

    const resultado = await pool.query(
      `SELECT id, empleado_id, dia_semana, hora_entrada, hora_salida
       FROM horarios WHERE empleado_id = $1 ORDER BY id`,
      [empleadoId]
    );
    res.json(resultado.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al guardar el horario.' });
  } finally {
    client.release();
  }
});

module.exports = router;
