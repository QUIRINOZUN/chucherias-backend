// =============================================================================
// routes/asistencias.js — CONTROL DE ASISTENCIAS (Sprint 3)
// =============================================================================
// Endpoints (prefijo /api/asistencias), todos exigen sesión, solo
// administrador/encargado — igual que usuarios/insumos/caja, es información
// de personal, no algo que el propio empleado capture desde su cuenta (ver la
// nota de diseño más abajo).
//
//   GET   /?desde=&hasta=&empleado_id=  → historial con filtros (todos
//                                          opcionales y combinables; sin
//                                          filtros se ve TODO, mismo criterio
//                                          que mermas/cortes de caja)
//   GET   /hoy                          → asistencias de la fecha de HOY del
//                                          negocio (alimenta el panel de
//                                          "marcar entrada/salida")
//   POST  /entrada                      → marca la hora de entrada de un
//                                          empleado, AHORA, en el día de hoy
//   PATCH /:id/salida                   → marca la hora de salida de un
//                                          registro abierto, AHORA
//   POST  /                             → captura manual completa (para un
//                                          día que no se marcó en vivo)
//   PATCH /:id                          → corrige un registro ya existente
//                                          (hora_entrada, hora_salida, fecha,
//                                          observaciones)
//
// NOTA DE DISEÑO (decisión de Sprint 3): no todo empleado tiene una cuenta de
// usuario (`empleados.usuario_id` es opcional — ver routes/empleados.js), así
// que no existe un flujo de "marca tu propia entrada" universal. En su lugar,
// quien abre o cierra el turno de alguien es siempre administrador/encargado
// — el mismo criterio de autoridad que ya usa el resto del sistema (ajustes
// de inventario, retiros de caja, mermas manuales). `registrado_por` guarda
// quién hizo el registro, no de quién es la asistencia.
//
// NO se calculan retardos contra un horario esperado: ese dato (horario por
// empleado) no existe todavía en el modelo — ver CLAUDE.md, pendiente de
// una fase futura si el usuario lo pide.
// =============================================================================
const express = require('express');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { fechaHoyNegocio, horaAhoraNegocioSql, fechaValida } = require('../utils/fecha');

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol('administrador', 'encargado'));

// Columnas comunes de respuesta, con el nombre del empleado y de quien
// registró cada fila (evita repetir el mismo SELECT/JOIN en cada ruta).
// `a.fecha` es DATE: se convierte a texto AAAA-MM-DD con to_char() para que
// el driver no la entregue como un Date en UTC medianoche, que un navegador
// en una zona con offset negativo (como México) mostraría corrida un día
// atrás — el mismo bug que ya se corrigió antes para cortes_caja.fecha.
const SELECT_ASISTENCIA = `
  SELECT a.id, a.empleado_id, e.nombre AS empleado_nombre, e.puesto,
         to_char(a.fecha, 'YYYY-MM-DD') AS fecha,
         a.hora_entrada, a.hora_salida, a.observaciones,
         u.nombre AS registrado_por_nombre
  FROM asistencias a
  JOIN empleados e ON e.id = a.empleado_id
  LEFT JOIN usuarios u ON u.id = a.registrado_por
`;

// GET /api/asistencias?desde=&hasta=&empleado_id=
router.get('/', async (req, res) => {
  const { desde, hasta, empleado_id } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }

  try {
    const resultado = await pool.query(
      `${SELECT_ASISTENCIA}
       WHERE ($1::date IS NULL OR a.fecha >= $1::date)
         AND ($2::date IS NULL OR a.fecha <= $2::date)
         AND ($3::int IS NULL OR a.empleado_id = $3::int)
       ORDER BY a.fecha DESC, a.hora_entrada DESC`,
      [desde || null, hasta || null, empleado_id || null]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las asistencias.' });
  }
});

// GET /api/asistencias/hoy
// Las asistencias de la fecha de HOY del negocio — es lo que usa la pantalla
// para saber, por cada empleado, si ya tiene una entrada abierta (y mostrar
// "Marcar salida") o no (y mostrar "Marcar entrada").
router.get('/hoy', async (req, res) => {
  try {
    const resultado = await pool.query(
      `${SELECT_ASISTENCIA} WHERE a.fecha = $1::date ORDER BY a.hora_entrada DESC`,
      [fechaHoyNegocio()]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las asistencias de hoy.' });
  }
});

// POST /api/asistencias/entrada
// Marca la entrada de un empleado AHORA, en la fecha de hoy del negocio.
router.post('/entrada', async (req, res) => {
  const { empleado_id, observaciones } = req.body;

  if (!empleado_id) {
    return res.status(400).json({ error: 'empleado_id es obligatorio.' });
  }

  try {
    const empleado = await pool.query('SELECT id, activo FROM empleados WHERE id = $1', [
      empleado_id,
    ]);
    if (empleado.rows.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }
    if (!empleado.rows[0].activo) {
      return res.status(400).json({ error: 'Ese empleado está desactivado.' });
    }

    const hoy = fechaHoyNegocio();

    // No se permite una segunda entrada ABIERTA el mismo día (evita marcar
    // "entrada" dos veces sin haber marcado salida de por medio).
    const abierta = await pool.query(
      'SELECT id FROM asistencias WHERE empleado_id = $1 AND fecha = $2 AND hora_salida IS NULL',
      [empleado_id, hoy]
    );
    if (abierta.rows.length > 0) {
      return res.status(400).json({ error: 'Ese empleado ya tiene una entrada sin salida hoy.' });
    }

    const resultado = await pool.query(
      `INSERT INTO asistencias (empleado_id, fecha, hora_entrada, registrado_por, observaciones)
       VALUES ($1, $2::date, ${horaAhoraNegocioSql()}, $3, $4)
       RETURNING id`,
      [empleado_id, hoy, req.usuario.id, observaciones?.trim() || null]
    );

    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [resultado.rows[0].id]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la entrada.' });
  }
});

// PATCH /api/asistencias/:id/salida
// Marca la salida AHORA de un registro que sigue abierto.
router.patch('/:id/salida', async (req, res) => {
  const { id } = req.params;

  try {
    const actual = await pool.query('SELECT * FROM asistencias WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de asistencia no encontrado.' });
    }
    if (actual.rows[0].hora_salida) {
      return res.status(400).json({ error: 'Ese registro ya tiene hora de salida.' });
    }

    await pool.query(
      `UPDATE asistencias SET hora_salida = ${horaAhoraNegocioSql()} WHERE id = $1`,
      [id]
    );
    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [id]);
    res.json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la salida.' });
  }
});

// POST /api/asistencias
// Captura manual completa (ej. para un día que no se marcó en vivo). A
// diferencia de /entrada, aquí SÍ se puede mandar una fecha distinta a hoy.
router.post('/', async (req, res) => {
  const { empleado_id, fecha, hora_entrada, hora_salida, observaciones } = req.body;

  if (!empleado_id || !fecha) {
    return res.status(400).json({ error: 'empleado_id y fecha son obligatorios.' });
  }
  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
  }
  if (hora_entrada && hora_salida && hora_salida <= hora_entrada) {
    return res.status(400).json({ error: 'La hora de salida debe ser posterior a la de entrada.' });
  }

  try {
    const empleado = await pool.query('SELECT id FROM empleados WHERE id = $1', [empleado_id]);
    if (empleado.rows.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    const resultado = await pool.query(
      `INSERT INTO asistencias (empleado_id, fecha, hora_entrada, hora_salida, registrado_por, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        empleado_id,
        fecha,
        hora_entrada || null,
        hora_salida || null,
        req.usuario.id,
        observaciones?.trim() || null,
      ]
    );
    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [resultado.rows[0].id]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la asistencia.' });
  }
});

// PATCH /api/asistencias/:id
// Corrige un registro ya existente (edición parcial: lo que no llega
// conserva su valor actual).
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { fecha, hora_entrada, hora_salida, observaciones } = req.body;

  try {
    const actual = await pool.query('SELECT * FROM asistencias WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de asistencia no encontrado.' });
    }
    const actualFila = actual.rows[0];

    const nuevaFecha = fecha || actualFila.fecha;
    if (fecha && !fechaValida(fecha)) {
      return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' });
    }
    const nuevaEntrada = hora_entrada !== undefined ? hora_entrada || null : actualFila.hora_entrada;
    const nuevaSalida = hora_salida !== undefined ? hora_salida || null : actualFila.hora_salida;
    if (nuevaEntrada && nuevaSalida && nuevaSalida <= nuevaEntrada) {
      return res.status(400).json({ error: 'La hora de salida debe ser posterior a la de entrada.' });
    }
    const nuevasObservaciones =
      observaciones !== undefined ? observaciones?.trim() || null : actualFila.observaciones;

    await pool.query(
      `UPDATE asistencias
       SET fecha = $1, hora_entrada = $2, hora_salida = $3, observaciones = $4
       WHERE id = $5`,
      [nuevaFecha, nuevaEntrada, nuevaSalida, nuevasObservaciones, id]
    );
    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [id]);
    res.json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al corregir la asistencia.' });
  }
});

module.exports = router;
