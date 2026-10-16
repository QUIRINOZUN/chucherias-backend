// =============================================================================
// routes/reportes.js — REPORTE CONSOLIDADO (RF-26, Sprint 4 oficial)
// =============================================================================
// Hasta ahora cada dominio (ventas, inventario, personal, clientes/lealtad)
// solo se podía consultar por separado, en su propia pantalla. Este endpoint
// junta un resumen de los 4 en una sola respuesta, para la pantalla
// "Reportes" — es de SOLO LECTURA, no calcula nada que no se pudiera armar
// ya combinando los reportes existentes (ventas, mermas, asistencias,
// clientes), solo evita que el frontend tenga que hacer 5+ llamadas y
// sumarlas él mismo.
//
// GET /api/reportes/resumen?desde=&hasta=
//   Ambos parámetros opcionales y combinables (mismo criterio que
//   routes/mermas.js: sin filtros, el resumen de ventas/mermas/asistencias
//   es de TODO el histórico). Administrador y encargado — información
//   financiera y de personal, RNF-03.
//
// DOS secciones NO dependen del periodo (son una "foto de ahora", no un
// histórico): cuántos insumos están bajo su mínimo (es el inventario de
// HOY, no el de hace un mes) y el top de clientes por visitas acumuladas
// (es el ciclo de lealtad ACTUAL de cada cliente, no cuántas visitas tuvo
// en ese rango). El resto (ventas, mermas, asistencias/retardos, clientes
// nuevos) sí se acota al rango de fechas.
// =============================================================================
const express = require("express");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const { diaNegocioSql, fechaValida } = require("../utils/fecha");

const router = express.Router();

router.use(verificarToken);
router.use(requiereRol("administrador", "encargado"));

router.get("/resumen", async (req, res) => {
  const { desde, hasta } = req.query;

  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return res
      .status(400)
      .json({ error: "Las fechas deben tener el formato AAAA-MM-DD." });
  }

  // $1/$2 son `desde`/`hasta` en TODAS las queries de abajo (null = sin ese
  // límite) — null en vez de undefined, porque `pg` no castea undefined.
  const rango = [desde || null, hasta || null];

  try {
    const [
      ventas,
      insumos,
      mermas,
      empleados,
      asistencias,
      retardos,
      clientesTotal,
      clientesNuevos,
      topClientes,
    ] = await Promise.all([
      // ---- VENTAS: solo cuenta lo COMPLETADO para los montos; las
      // canceladas se cuentan aparte, nunca suman a monto_total. ----
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE estado = 'completada')::int AS total_ventas,
           COALESCE(SUM(total) FILTER (WHERE estado = 'completada'), 0) AS monto_total,
           COALESCE(SUM(total) FILTER (WHERE estado = 'completada' AND metodo_pago = 'efectivo'), 0) AS monto_efectivo,
           COALESCE(SUM(total) FILTER (WHERE estado = 'completada' AND metodo_pago = 'transferencia'), 0) AS monto_transferencia,
           COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas,
           COALESCE(SUM(descuento_lealtad) FILTER (WHERE estado = 'completada'), 0) AS descuento_lealtad_total
         FROM ventas
         WHERE ($1::date IS NULL OR ${diaNegocioSql("fecha")} >= $1::date)
           AND ($2::date IS NULL OR ${diaNegocioSql("fecha")} <= $2::date)`,
        rango,
      ),

      // ---- INVENTARIO (foto de AHORA, no del periodo): cuántos insumos
      // están en o por debajo de su cantidad_minima. Misma expresión de
      // existencia que ya usa routes/insumos.js (entrada/ajuste suman,
      // salida/merma restan) — duplicada aquí a propósito: no hay un
      // utils/ que la exporte todavía, y moverla implicaría tocar
      // insumos.js, fuera del alcance de este reporte de solo lectura. ----
      pool.query(
        `SELECT
           COUNT(*)::int AS total_insumos,
           COUNT(*) FILTER (WHERE existencia <= cantidad_minima)::int AS bajo_minimo
         FROM (
           SELECT i.id, i.cantidad_minima,
             COALESCE(SUM(
               CASE
                 WHEN m.tipo IN ('entrada', 'ajuste') THEN m.cantidad
                 WHEN m.tipo IN ('salida', 'merma') THEN -m.cantidad
                 ELSE 0
               END
             ), 0) AS existencia
           FROM insumos i
           LEFT JOIN movimientos_inventario m ON m.insumo_id = i.id
           GROUP BY i.id, i.cantidad_minima
         ) existencias`,
      ),

      // ---- MERMAS del periodo (producto + insumo, mismo criterio que
      // routes/mermas.js: solo las de insumo con valor_unitario capturado
      // suman a mermas_valor_total). ----
      pool.query(
        `SELECT
           COUNT(*)::int AS mermas_total,
           COALESCE(SUM(valor_unitario * cantidad) FILTER (WHERE valor_unitario IS NOT NULL), 0) AS mermas_valor_total
         FROM mermas
         WHERE ($1::date IS NULL OR ${diaNegocioSql("fecha")} >= $1::date)
           AND ($2::date IS NULL OR ${diaNegocioSql("fecha")} <= $2::date)`,
        rango,
      ),

      // ---- PERSONAL: empleados activos es una foto de AHORA; asistencias
      // y retardos sí se acotan al periodo. `asistencias.fecha` ya es DATE
      // (el día del negocio se resuelve al capturar la asistencia, no aquí
      // — no hace falta diaNegocioSql sobre una columna que ya es fecha). ----
      pool.query(
        `SELECT COUNT(*)::int AS empleados_activos FROM empleados WHERE activo = TRUE`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS asistencias_registradas
         FROM asistencias
         WHERE ($1::date IS NULL OR fecha >= $1::date)
           AND ($2::date IS NULL OR fecha <= $2::date)`,
        rango,
      ),
      // Mismo criterio de "hora esperada" (excepción de fecha → horario
      // recurrente → sin horario = nunca cuenta) que
      // GET /api/asistencias/retardos — duplicado aquí porque ese endpoint
      // devuelve las FILAS para la pantalla de Asistencias, y este reporte
      // solo necesita el total; si la regla de retardos cambia, hay que
      // actualizar los dos lugares.
      pool.query(
        `SELECT COUNT(*)::int AS retardos
         FROM asistencias a
         LEFT JOIN horario_excepciones he ON he.empleado_id = a.empleado_id AND he.fecha = a.fecha
         LEFT JOIN horarios h ON h.empleado_id = a.empleado_id
           AND h.dia_semana = (ARRAY['domingo','lunes','martes','miercoles','jueves','viernes','sabado'])[EXTRACT(DOW FROM a.fecha)::int + 1]
         WHERE a.hora_entrada IS NOT NULL
           AND ($1::date IS NULL OR a.fecha >= $1::date)
           AND ($2::date IS NULL OR a.fecha <= $2::date)
           AND (
             CASE
               WHEN he.id IS NOT NULL THEN he.tipo = 'trabaja' AND a.hora_entrada > he.hora_entrada
               WHEN h.id IS NOT NULL THEN a.hora_entrada > h.hora_entrada
               ELSE FALSE
             END
           )`,
        rango,
      ),

      // ---- CLIENTES Y LEALTAD ----
      pool.query(`SELECT COUNT(*)::int AS total_clientes FROM clientes`),
      pool.query(
        `SELECT COUNT(*)::int AS nuevos_en_periodo
         FROM clientes
         WHERE ($1::date IS NULL OR ${diaNegocioSql("fecha_registro")} >= $1::date)
           AND ($2::date IS NULL OR ${diaNegocioSql("fecha_registro")} <= $2::date)`,
        rango,
      ),
      // Top 5 por visitas del ciclo ACTUAL (no es "quién visitó más en el
      // periodo" — es "quién está más cerca de su próximo descuento ahora
      // mismo"), por eso no se filtra por fecha. Se excluyen los de 0
      // visitas (clientes recién registrados, sin ninguna compra todavía).
      pool.query(
        `SELECT id, nombre_completo, telefono, visitas_acumuladas
         FROM clientes
         WHERE visitas_acumuladas > 0
         ORDER BY visitas_acumuladas DESC, nombre_completo
         LIMIT 5`,
      ),
    ]);

    res.json({
      periodo: { desde: desde || null, hasta: hasta || null },
      ventas: ventas.rows[0],
      inventario: {
        ...insumos.rows[0],
        ...mermas.rows[0],
      },
      personal: {
        ...empleados.rows[0],
        ...asistencias.rows[0],
        ...retardos.rows[0],
      },
      clientes: {
        ...clientesTotal.rows[0],
        ...clientesNuevos.rows[0],
        top_clientes: topClientes.rows,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar el reporte." });
  }
});

module.exports = router;
