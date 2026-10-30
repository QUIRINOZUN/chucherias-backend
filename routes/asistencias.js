// =============================================================================
// routes/asistencias.js — CONTROL DE ASISTENCIAS (Sprint 3)
// =============================================================================
// Todo el prefijo /api/asistencias es exclusivo de administrador/encargado
// — es información de personal:
//   GET   /?desde=&hasta=&empleado_id=  → historial con filtros (todos
//                                          opcionales y combinables; sin
//                                          filtros se ve TODO, mismo criterio
//                                          que mermas/cortes de caja)
//   GET   /hoy                          → asistencias de la fecha de HOY del
//                                          negocio (alimenta el panel de
//                                          "marcar entrada/salida" de
//                                          Asistencias, para TODOS los
//                                          empleados)
//   POST  /entrada                      → marca la hora de entrada de un
//                                          empleado, AHORA, en el día de hoy
//   PATCH /:id/salida                   → marca la hora de salida de un
//                                          registro abierto, AHORA
//   POST  /                             → captura manual completa (para un
//                                          día que no se marcó en vivo)
//   PATCH /:id                          → corrige un registro ya existente
//                                          (hora_entrada, hora_salida, fecha,
//                                          observaciones) — deja evidencia
//                                          automática, ver RF-19 abajo
//   GET   /:id/correcciones             → historial de correcciones de ESE
//                                          registro (RF-19)
//   GET   /retardos?desde=&hasta=&empleado_id=
//                                        → RF-20: entradas reales más
//                                          tarde que la hora esperada
//
// Mismo criterio de autoridad que ya usa el resto del sistema (ajustes de
// inventario, retiros de caja, mermas manuales): solo administrador/
// encargado registran o corrigen asistencia, nunca el propio empleado.
//
// 2026-10-11: se retiró el autoservicio (/mi-hoy, /mi-entrada, /mi-salida,
// más la entrada/salida automática al iniciar/cerrar sesión en
// routes/auth.js) a petición del usuario — ver utils/asistenciaAutomatica.js
// (eliminado) y utils/fecha.js (VENTANA_ENTRADA/VENTANA_SALIDA/
// dentroDeVentanaAsistencia, eliminados también por quedar sin uso).
//
// RF-19 (2026-10-13): cada PATCH /:id que de verdad cambia algo (fecha,
// hora_entrada, hora_salida u observaciones) ahora inserta una fila en
// asistencias_historial_correcciones ANTES de aplicar el cambio — con quién
// corrigió, cuándo, y el valor que tenía ESE campo antes. Es un historial
// completo (una fila por corrección), no solo "la última corrección".
//
// RF-20 (2026-10-13): GET /retardos cruza asistencias.hora_entrada contra el
// horario esperado de ese día (excepción de fecha → horario recurrente →
// si no hay ninguno de los dos, ese día no tiene hora esperada y no cuenta
// como retardo). Tolerancia: CUALQUIER minuto tarde cuenta (sin margen) —
// decisión del usuario.
// =============================================================================
const express = require("express");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const {
  fechaHoyNegocio,
  horaAhoraNegocioSql,
  fechaValida,
} = require("../utils/fecha");

const router = express.Router();

router.use(verificarToken);

// true si `id` (de req.params) es un entero positivo real. Sin esto, un id
// no numérico (ej. una ruta vieja/typo) llegaba crudo a una columna
// INTEGER y Postgres lo rechazaba sin que el código lo capturara — 500 en
// vez de un 400 claro.
function idValido(id) {
  return /^\d+$/.test(id);
}
router.use(requiereRol("administrador", "encargado"));

// Columnas comunes de respuesta, con el nombre del empleado y de quien
// registró cada fila (evita repetir el mismo SELECT/JOIN en cada ruta).
// `a.fecha` es DATE: se convierte a texto AAAA-MM-DD con to_char() para que
// el driver no la entregue como un Date en UTC medianoche, que un navegador
// en una zona con offset negativo (como México) mostraría corrida un día
// atrás — el mismo bug que ya se corrigió antes para cortes_caja.fecha.
// RF-19: además de los datos de siempre, se agrega un resumen de la ÚLTIMA
// corrección (si tuvo alguna) vía LATERAL — el historial completo vive en
// GET /:id/correcciones, esto es solo para mostrar un aviso discreto en la
// lista sin tener que pedir el historial completo de cada fila.
const SELECT_ASISTENCIA = `
  SELECT a.id, a.empleado_id, e.nombre AS empleado_nombre, e.puesto,
         to_char(a.fecha, 'YYYY-MM-DD') AS fecha,
         a.hora_entrada, a.hora_salida, a.observaciones,
         u.nombre AS registrado_por_nombre,
         ultima_correccion.fecha_correccion AS fecha_ultima_correccion,
         uc.nombre AS ultima_correccion_por_nombre
  FROM asistencias a
  JOIN empleados e ON e.id = a.empleado_id
  LEFT JOIN usuarios u ON u.id = a.registrado_por
  LEFT JOIN LATERAL (
    SELECT corregido_por, fecha_correccion
    FROM asistencias_historial_correcciones hc
    WHERE hc.asistencia_id = a.id
    ORDER BY hc.fecha_correccion DESC
    LIMIT 1
  ) ultima_correccion ON TRUE
  LEFT JOIN usuarios uc ON uc.id = ultima_correccion.corregido_por
`;

// GET /api/asistencias?desde=&hasta=&empleado_id=
router.get("/", async (req, res) => {
  const { desde, hasta, empleado_id } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }

  try {
    const resultado = await pool.query(
      `${SELECT_ASISTENCIA}
       WHERE ($1::date IS NULL OR a.fecha >= $1::date)
         AND ($2::date IS NULL OR a.fecha <= $2::date)
         AND ($3::int IS NULL OR a.empleado_id = $3::int)
       ORDER BY a.fecha DESC, a.hora_entrada DESC`,
      [desde || null, hasta || null, empleado_id || null],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener las asistencias." });
  }
});

// GET /api/asistencias/hoy
// Las asistencias de la fecha de HOY del negocio — es lo que usa la pantalla
// para saber, por cada empleado, si ya tiene una entrada abierta (y mostrar
// "Marcar salida") o no (y mostrar "Marcar entrada").
router.get("/hoy", async (req, res) => {
  try {
    const resultado = await pool.query(
      `${SELECT_ASISTENCIA} WHERE a.fecha = $1::date ORDER BY a.hora_entrada DESC`,
      [fechaHoyNegocio()],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener las asistencias de hoy." });
  }
});

// POST /api/asistencias/entrada
// Marca la entrada de un empleado AHORA, en la fecha de hoy del negocio.
router.post("/entrada", async (req, res) => {
  const { empleado_id, observaciones } = req.body;

  if (!empleado_id) {
    return res.status(400).json({ error: "empleado_id es obligatorio." });
  }

  try {
    const empleado = await pool.query(
      "SELECT id, activo FROM empleados WHERE id = $1",
      [empleado_id],
    );
    if (empleado.rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado." });
    }
    if (!empleado.rows[0].activo) {
      return res.status(400).json({ error: "Ese empleado está desactivado." });
    }

    const hoy = fechaHoyNegocio();

    // No se permite una segunda entrada ABIERTA el mismo día (evita marcar
    // "entrada" dos veces sin haber marcado salida de por medio).
    const abierta = await pool.query(
      "SELECT id FROM asistencias WHERE empleado_id = $1 AND fecha = $2 AND hora_salida IS NULL",
      [empleado_id, hoy],
    );
    if (abierta.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Ese empleado ya tiene una entrada sin salida hoy." });
    }

    const resultado = await pool.query(
      `INSERT INTO asistencias (empleado_id, fecha, hora_entrada, registrado_por, observaciones)
       VALUES ($1, $2::date, ${horaAhoraNegocioSql()}, $3, $4)
       RETURNING id`,
      [empleado_id, hoy, req.usuario.id, observaciones?.trim() || null],
    );

    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [
      resultado.rows[0].id,
    ]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al registrar la entrada." });
  }
});

// PATCH /api/asistencias/:id/salida
// Marca la salida AHORA de un registro que sigue abierto.
router.patch("/:id/salida", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }

  try {
    const actual = await pool.query("SELECT * FROM asistencias WHERE id = $1", [
      id,
    ]);
    if (actual.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Registro de asistencia no encontrado." });
    }
    if (actual.rows[0].hora_salida) {
      return res
        .status(400)
        .json({ error: "Ese registro ya tiene hora de salida." });
    }

    await pool.query(
      `UPDATE asistencias SET hora_salida = ${horaAhoraNegocioSql()} WHERE id = $1`,
      [id],
    );
    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [id]);
    res.json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al registrar la salida." });
  }
});

// POST /api/asistencias
// Captura manual completa (ej. para un día que no se marcó en vivo). A
// diferencia de /entrada, aquí SÍ se puede mandar una fecha distinta a hoy.
router.post("/", async (req, res) => {
  const { empleado_id, fecha, hora_entrada, hora_salida, observaciones } =
    req.body;

  if (!empleado_id || !fecha) {
    return res
      .status(400)
      .json({ error: "empleado_id y fecha son obligatorios." });
  }
  if (!fechaValida(fecha)) {
    return res
      .status(400)
      .json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
  }
  if (hora_entrada && hora_salida && hora_salida <= hora_entrada) {
    return res
      .status(400)
      .json({ error: "La hora de salida debe ser posterior a la de entrada." });
  }

  try {
    const empleado = await pool.query(
      "SELECT id FROM empleados WHERE id = $1",
      [empleado_id],
    );
    if (empleado.rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado." });
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
      ],
    );
    const fila = await pool.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [
      resultado.rows[0].id,
    ]);
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al registrar la asistencia." });
  }
});

// PATCH /api/asistencias/:id
// Corrige un registro ya existente (edición parcial: lo que no llega
// conserva su valor actual). RF-19: si algún campo de verdad cambia, se
// guarda una fila en asistencias_historial_correcciones con el valor que
// tenía ANTES — en la misma transacción que el UPDATE, para que una no
// pueda quedar sin la otra.
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }
  const { fecha, hora_entrada, hora_salida, observaciones } = req.body;

  const client = await pool.connect();
  try {
    const actual = await client.query(
      "SELECT * FROM asistencias WHERE id = $1",
      [id],
    );
    if (actual.rows.length === 0) {
      client.release();
      return res
        .status(404)
        .json({ error: "Registro de asistencia no encontrado." });
    }
    const actualFila = actual.rows[0];

    // to_char() ya deja actualFila.fecha como texto AAAA-MM-DD cuando viene
    // de SELECT_ASISTENCIA, pero aquí es un SELECT * crudo: actualFila.fecha
    // es un objeto Date (medianoche UTC) — se convierte a texto antes de
    // cualquier comparación o reasignación, para no confundir un cambio
    // real con solo una diferencia de formato.
    const fechaAnteriorTexto = actualFila.fecha.toISOString().slice(0, 10);

    const nuevaFecha = fecha || fechaAnteriorTexto;
    if (fecha && !fechaValida(fecha)) {
      client.release();
      return res
        .status(400)
        .json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
    }
    const nuevaEntrada =
      hora_entrada !== undefined
        ? hora_entrada || null
        : actualFila.hora_entrada;
    const nuevaSalida =
      hora_salida !== undefined ? hora_salida || null : actualFila.hora_salida;
    if (nuevaEntrada && nuevaSalida && nuevaSalida <= nuevaEntrada) {
      client.release();
      return res.status(400).json({
        error: "La hora de salida debe ser posterior a la de entrada.",
      });
    }
    const nuevasObservaciones =
      observaciones !== undefined
        ? observaciones?.trim() || null
        : actualFila.observaciones;

    // Las horas pueden llegar como "HH:MM" (del formulario) o ya estar en la
    // base como "HH:MM:SS" — se comparan solo los primeros 5 caracteres para
    // no detectar un "cambio" donde solo cambió el formato.
    const normalizarHora = (h) => (h ? h.slice(0, 5) : null);
    const huboCambio =
      nuevaFecha !== fechaAnteriorTexto ||
      normalizarHora(nuevaEntrada) !==
        normalizarHora(actualFila.hora_entrada) ||
      normalizarHora(nuevaSalida) !== normalizarHora(actualFila.hora_salida) ||
      nuevasObservaciones !== actualFila.observaciones;

    await client.query("BEGIN");

    if (huboCambio) {
      await client.query(
        `INSERT INTO asistencias_historial_correcciones
           (asistencia_id, corregido_por, fecha_anterior, hora_entrada_anterior,
            hora_salida_anterior, observaciones_anteriores)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          req.usuario.id,
          fechaAnteriorTexto,
          actualFila.hora_entrada,
          actualFila.hora_salida,
          actualFila.observaciones,
        ],
      );
    }

    await client.query(
      `UPDATE asistencias
       SET fecha = $1, hora_entrada = $2, hora_salida = $3, observaciones = $4
       WHERE id = $5`,
      [nuevaFecha, nuevaEntrada, nuevaSalida, nuevasObservaciones, id],
    );

    await client.query("COMMIT");

    const fila = await client.query(`${SELECT_ASISTENCIA} WHERE a.id = $1`, [
      id,
    ]);
    res.json(fila.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Error al corregir la asistencia." });
  } finally {
    client.release();
  }
});

// GET /api/asistencias/:id/correcciones
// RF-19: historial completo de correcciones de UN registro (más reciente
// primero) — quién corrigió, cuándo, y qué valor tenía cada campo antes.
router.get("/:id/correcciones", async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: "El id debe ser numérico." });
  }
  try {
    const resultado = await pool.query(
      `SELECT hc.id, hc.fecha_correccion, u.nombre AS corregido_por_nombre,
              to_char(hc.fecha_anterior, 'YYYY-MM-DD') AS fecha_anterior,
              hc.hora_entrada_anterior, hc.hora_salida_anterior,
              hc.observaciones_anteriores
       FROM asistencias_historial_correcciones hc
       JOIN usuarios u ON u.id = hc.corregido_por
       WHERE hc.asistencia_id = $1
       ORDER BY hc.fecha_correccion DESC`,
      [id],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Error al obtener el historial de correcciones." });
  }
});

// GET /api/asistencias/retardos?desde=&hasta=&empleado_id=
// RF-20: asistencias cuya hora_entrada real llegó DESPUÉS de la hora
// esperada de ese día — excepción de fecha (si existe y es 'trabaja') o,
// si no hay excepción, el horario recurrente de ese día de la semana. Un
// día sin excepción 'trabaja' y sin horario recurrente no tiene hora
// esperada: no puede ser "retardo" (no hay contra qué comparar). Sin
// margen de tolerancia: cualquier minuto tarde cuenta (decisión del
// usuario, 2026-10-13).
router.get("/retardos", async (req, res) => {
  const { desde, hasta, empleado_id } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }

  try {
    const resultado = await pool.query(
      `SELECT a.id, a.empleado_id, e.nombre AS empleado_nombre,
              to_char(a.fecha, 'YYYY-MM-DD') AS fecha,
              a.hora_entrada,
              CASE WHEN he.id IS NOT NULL THEN he.hora_entrada ELSE h.hora_entrada END AS hora_esperada,
              ROUND(
                EXTRACT(EPOCH FROM (
                  a.hora_entrada - (CASE WHEN he.id IS NOT NULL THEN he.hora_entrada ELSE h.hora_entrada END)
                )) / 60
              )::int AS minutos_retardo
       FROM asistencias a
       JOIN empleados e ON e.id = a.empleado_id
       LEFT JOIN horario_excepciones he ON he.empleado_id = a.empleado_id AND he.fecha = a.fecha
       LEFT JOIN horarios h ON h.empleado_id = a.empleado_id
         AND h.dia_semana = (ARRAY['domingo','lunes','martes','miercoles','jueves','viernes','sabado'])[EXTRACT(DOW FROM a.fecha)::int + 1]
       WHERE a.hora_entrada IS NOT NULL
         AND ($1::date IS NULL OR a.fecha >= $1::date)
         AND ($2::date IS NULL OR a.fecha <= $2::date)
         AND ($3::int IS NULL OR a.empleado_id = $3::int)
         AND (
           CASE
             WHEN he.id IS NOT NULL THEN he.tipo = 'trabaja' AND a.hora_entrada > he.hora_entrada
             WHEN h.id IS NOT NULL THEN a.hora_entrada > h.hora_entrada
             ELSE FALSE
           END
         )
       ORDER BY a.fecha DESC, a.hora_entrada DESC`,
      [desde || null, hasta || null, empleado_id || null],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al calcular los retardos." });
  }
});

// DELETE /api/asistencias/historial?desde=&hasta=
// Elimina registros de asistencia del rango [desde, hasta] (ambos
// obligatorios) — irreversible. Cascada automática (ON DELETE CASCADE) a
// asistencias_historial_correcciones. Solo administrador (el resto de este
// archivo ya es admin/encargado).
router.delete(
  "/historial",
  requiereRol("administrador"),
  async (req, res) => {
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
        "DELETE FROM asistencias WHERE fecha >= $1::date AND fecha <= $2::date RETURNING id",
        [desde, hasta],
      );
      res.json({ eliminados: resultado.rows.length });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ error: "Error al eliminar el historial de asistencias." });
    }
  },
);

module.exports = router;
