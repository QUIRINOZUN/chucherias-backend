// =============================================================================
// routes/nomina.js — NÓMINA POR HORAS TRABAJADAS (pago del personal)
// =============================================================================
// El titular paga a su personal por HORA TRABAJADA, no un sueldo fijo. Este
// módulo no inventa ningún cálculo nuevo de horas: usa las mismas
// asistencias reales (entrada/salida) que ya alimenta la sub-pestaña "Horas
// trabajadas" de Asistencias — solo le agrega la tarifa por hora de cada
// empleado (empleados.pago_por_hora) y hace la multiplicación en el
// servidor, nunca confiando en ningún total que mande el cliente.
//
//   GET   /?desde=&hasta=&empleado_id=&todos=1
//     Horas trabajadas y pago calculado por empleado en el rango (todos los
//     parámetros opcionales y combinables — sin desde/hasta es TODO el
//     histórico, mismo criterio que mermas/reportes/asistencias). Por
//     default solo empleados activos; ?todos=1 también incluye
//     desactivados (para poder pagar un periodo en el que alguien todavía
//     trabajaba). Solo cuenta turnos CERRADOS (con hora_salida) — un turno
//     sin cerrar nunca se adivina ni se redondea: se reporta aparte
//     (turnos_sin_cerrar) para corregirlo desde Asistencias antes de pagar.
//
//   PATCH /:empleadoId/tarifa
//     Captura o corrige la tarifa por hora de un empleado
//     (empleados.pago_por_hora). Separado de PATCH /api/empleados/:id a
//     propósito: es información salarial, no se edita desde Asistencias →
//     Empleados — vive y se corrige en esta misma pantalla. pago_por_hora
//     en null/''/undefined dentro del body QUITA la tarifa capturada
//     (vuelve a "sin capturar"); cualquier otro valor debe ser un número
//     mayor a cero.
//
// Administrador/encargado — información financiera y de personal (RNF-03),
// mismo criterio que caja/asistencias/reportes.
// =============================================================================
const express = require("express");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const { fechaValida } = require("../utils/fecha");

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol("administrador", "encargado"));

// GET /api/nomina?desde=&hasta=&empleado_id=&todos=1
router.get("/", async (req, res) => {
  const { desde, hasta, empleado_id, todos } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }
  if (empleado_id && !/^\d+$/.test(empleado_id)) {
    return res.status(400).json({ error: "empleado_id debe ser numérico." });
  }

  try {
    // CTE "horas": una fila por empleado (empleados es el lado IZQUIERDO del
    // JOIN, así que un empleado sin ninguna asistencia en el rango de todos
    // modos aparece, con 0 horas) con sus horas reales trabajadas en el
    // rango y cuántos turnos quedaron sin cerrar. El filtro de fecha vive en
    // el ON del JOIN (no en un WHERE aparte) para que una asistencia fuera
    // del rango ni siquiera se junte, en vez de descartarla ya agregada.
    const resultado = await pool.query(
      `WITH horas AS (
         SELECT e.id AS empleado_id, e.nombre, e.puesto, e.pago_por_hora, e.activo,
                COALESCE(ROUND(SUM(
                  EXTRACT(EPOCH FROM (a.hora_salida - a.hora_entrada)) / 3600
                ) FILTER (WHERE a.hora_salida IS NOT NULL), 2), 0) AS horas_trabajadas,
                COUNT(*) FILTER (WHERE a.id IS NOT NULL AND a.hora_salida IS NULL)::int AS turnos_sin_cerrar
         FROM empleados e
         LEFT JOIN asistencias a ON a.empleado_id = e.id
           AND ($1::date IS NULL OR a.fecha >= $1::date)
           AND ($2::date IS NULL OR a.fecha <= $2::date)
         WHERE ($4::boolean IS TRUE OR e.activo = TRUE)
           AND ($3::int IS NULL OR e.id = $3::int)
         GROUP BY e.id, e.nombre, e.puesto, e.pago_por_hora, e.activo
       )
       SELECT *, ROUND(horas_trabajadas * pago_por_hora, 2) AS total_a_pagar
       FROM horas
       ORDER BY nombre`,
      [desde || null, hasta || null, empleado_id || null, todos === "1"],
    );
    res.json({
      periodo: { desde: desde || null, hasta: hasta || null },
      empleados: resultado.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al calcular la nómina." });
  }
});

// PATCH /api/nomina/:empleadoId/tarifa
router.patch("/:empleadoId/tarifa", async (req, res) => {
  const { empleadoId } = req.params;
  const { pago_por_hora } = req.body;

  if (!/^\d+$/.test(empleadoId)) {
    return res
      .status(400)
      .json({ error: "El id del empleado debe ser numérico." });
  }

  // null/''/undefined quita la tarifa capturada; cualquier otro valor debe
  // ser un número mayor a cero (nunca 0 ni negativo).
  let nuevaTarifa = null;
  if (
    pago_por_hora !== null &&
    pago_por_hora !== undefined &&
    pago_por_hora !== ""
  ) {
    nuevaTarifa = Number(pago_por_hora);
    if (!Number.isFinite(nuevaTarifa) || nuevaTarifa <= 0) {
      return res
        .status(400)
        .json({ error: "La tarifa por hora debe ser un número mayor a cero." });
    }
  }

  try {
    const resultado = await pool.query(
      `UPDATE empleados SET pago_por_hora = $1 WHERE id = $2
       RETURNING id AS empleado_id, nombre, puesto, pago_por_hora, activo`,
      [nuevaTarifa, empleadoId],
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado." });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar la tarifa." });
  }
});

module.exports = router;
