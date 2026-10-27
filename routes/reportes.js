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
//
// GRÁFICAS (2026-10-22): `ventas.serie_diaria` agrega ventas completadas
// POR DÍA del negocio, para la gráfica de tendencia de la pestaña Ventas —
// es el único corte nuevo que de verdad necesitaba datos adicionales (una
// tendencia necesita una serie, no un solo total). Acotada a los últimos 30
// días que caigan dentro del rango filtrado (`LIMIT 30` antes de reordenar
// ascendente) para que la consulta nunca crezca sin límite si no hay
// filtro de fecha (sin filtros, el resto del reporte sigue siendo TODO el
// histórico — esta serie es la única excepción, acotada a propósito porque
// alimenta un dibujo, no una cifra). El resto de las gráficas de la
// pantalla (inventario/personal/clientes) se arman en el frontend
// reutilizando cifras que esta respuesta ya traía.
//
// RENTABILIDAD (2026-10-27): `rentabilidad.costo_ventas`/`utilidad_bruta`
// son del PERIODO filtrado, calculados contra lo que de verdad se vendió
// (orden_detalle de ventas completadas, líneas no canceladas) — no el costo
// teórico del catálogo. `insumos_sin_costo`/`top_margen_bajo` son otra
// "foto de ahora" (catálogo actual, no el periodo): cuántos insumos
// todavía no tienen costo_unitario capturado, y qué variantes activas
// tienen el margen % más bajo hoy. Una receta con algún insumo sin costo
// capturado nunca suma un costo parcial — se cuenta en `lineas_sin_costo`/
// se excluye de `top_margen_bajo` en vez de mostrar un número engañoso.
// =============================================================================
const express = require("express");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const { diaNegocioSql, fechaValida } = require("../utils/fecha");
const { EXPRESION_EXISTENCIA } = require("../utils/existencia");

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
      serieDiaria,
      insumos,
      mermas,
      empleados,
      asistencias,
      retardos,
      clientesTotal,
      clientesNuevos,
      topClientes,
      costoVentas,
      costosInsumos,
      topMargenBajo,
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

      // ---- Serie diaria de ventas completadas, para la gráfica de
      // tendencia (ver nota de cabecera "GRÁFICAS"). `to_char` para que el
      // driver devuelva texto AAAA-MM-DD y no una fecha que el navegador
      // corra un día por el offset negativo de México (mismo criterio que
      // ya usa cortes_caja/asistencias). ----
      pool.query(
        `SELECT dia, ventas, monto FROM (
           SELECT to_char(${diaNegocioSql("fecha")}, 'YYYY-MM-DD') AS dia,
                  ${diaNegocioSql("fecha")} AS dia_orden,
                  COUNT(*) FILTER (WHERE estado = 'completada')::int AS ventas,
                  COALESCE(SUM(total) FILTER (WHERE estado = 'completada'), 0) AS monto
           FROM ventas
           WHERE ($1::date IS NULL OR ${diaNegocioSql("fecha")} >= $1::date)
             AND ($2::date IS NULL OR ${diaNegocioSql("fecha")} <= $2::date)
           GROUP BY dia, dia_orden
           ORDER BY dia_orden DESC
           LIMIT 30
         ) recientes
         ORDER BY dia_orden ASC`,
        rango,
      ),

      // ---- INVENTARIO (foto de AHORA, no del periodo): cuántos insumos
      // están en o por debajo de su cantidad_minima. Misma expresión de
      // existencia que ya usa routes/insumos.js, compartida desde
      // utils/existencia.js (2026-10-22, ver su comentario). ----
      pool.query(
        `SELECT
           COUNT(*)::int AS total_insumos,
           COUNT(*) FILTER (WHERE existencia <= cantidad_minima)::int AS bajo_minimo
         FROM (
           SELECT i.id, i.cantidad_minima,
             ${EXPRESION_EXISTENCIA} AS existencia
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

      // ---- RENTABILIDAD (2026-10-27) — costo REAL de lo que se vendió en
      // el periodo (no el teórico del catálogo): por cada línea activa
      // (no cancelada) de una venta completada, el costo de su receta =
      // SUM(receta_insumos.cantidad × insumos.costo_unitario), solo si
      // TODOS los insumos de esa receta tienen costo capturado (si falta
      // alguno, o la variante no tiene receta, la línea se cuenta en
      // "lineas_sin_costo" en vez de sumar un costo parcial engañoso). La
      // misma CTE se repite en la consulta de "top_margen_bajo" de abajo
      // (no hay un utils/ que la comparta entre las dos, mismo criterio ya
      // documentado para EXPRESION_EXISTENCIA antes de que existiera
      // utils/existencia.js — si la regla de costo cambia, hay que
      // actualizar las dos). ----
      pool.query(
        `WITH costo_por_receta AS (
           SELECT ri.receta_id,
                  SUM(ri.cantidad * i.costo_unitario) AS costo_unitario_receta,
                  BOOL_AND(i.costo_unitario IS NOT NULL) AS costo_completo
           FROM receta_insumos ri
           JOIN insumos i ON i.id = ri.insumo_id
           GROUP BY ri.receta_id
         )
         SELECT
           COALESCE(SUM(od.cantidad * cpr.costo_unitario_receta)
             FILTER (WHERE cpr.costo_completo), 0) AS costo_ventas,
           COUNT(od.id) FILTER (WHERE cpr.costo_completo)::int AS lineas_con_costo,
           COUNT(od.id) FILTER (WHERE cpr.costo_completo IS NOT TRUE)::int AS lineas_sin_costo
         FROM ventas v
         JOIN orden_detalle od ON od.orden_id = v.orden_id AND od.cancelado = FALSE
         LEFT JOIN recetas r ON r.variante_id = od.variante_id
         LEFT JOIN costo_por_receta cpr ON cpr.receta_id = r.id
         WHERE v.estado = 'completada'
           AND ($1::date IS NULL OR ${diaNegocioSql("v.fecha")} >= $1::date)
           AND ($2::date IS NULL OR ${diaNegocioSql("v.fecha")} <= $2::date)`,
        rango,
      ),

      // Foto de AHORA (no del periodo): cuántos insumos todavía no tienen
      // costo_unitario capturado — mide el avance de la captura, no
      // depende de qué se vendió.
      pool.query(
        `SELECT COUNT(*)::int AS total_insumos,
                COUNT(*) FILTER (WHERE costo_unitario IS NULL)::int AS insumos_sin_costo
         FROM insumos`,
      ),

      // Top 5 productos con MENOR margen % — del CATÁLOGO actual (precio
      // de hoy vs. costo de hoy), no de lo vendido en el periodo; otra
      // "foto de ahora", para decidir qué platillos conviene repreciar.
      // Solo variantes activas con receta completa (si falta el costo de
      // algún insumo, no se puede calcular un margen real).
      pool.query(
        `WITH costo_por_receta AS (
           SELECT ri.receta_id,
                  SUM(ri.cantidad * i.costo_unitario) AS costo_unitario_receta,
                  BOOL_AND(i.costo_unitario IS NOT NULL) AS costo_completo
           FROM receta_insumos ri
           JOIN insumos i ON i.id = ri.insumo_id
           GROUP BY ri.receta_id
         )
         SELECT v.id AS variante_id, v.nombre AS variante_nombre,
                p.nombre AS producto_nombre, v.precio,
                cpr.costo_unitario_receta AS costo,
                ROUND(
                  ((v.precio - cpr.costo_unitario_receta) / v.precio * 100)::numeric, 1
                ) AS margen_porcentaje
         FROM variantes_producto v
         JOIN productos p ON p.id = v.producto_id
         JOIN recetas r ON r.variante_id = v.id
         JOIN costo_por_receta cpr ON cpr.receta_id = r.id AND cpr.costo_completo
         WHERE v.activo = TRUE AND p.activo = TRUE AND v.precio > 0
         ORDER BY margen_porcentaje ASC
         LIMIT 5`,
      ),
    ]);

    res.json({
      periodo: { desde: desde || null, hasta: hasta || null },
      ventas: { ...ventas.rows[0], serie_diaria: serieDiaria.rows },
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
      rentabilidad: (() => {
        const ingresos = Number(ventas.rows[0].monto_total);
        const costoVentasReal = Number(costoVentas.rows[0].costo_ventas);
        const utilidadBruta = ingresos - costoVentasReal;
        return {
          ingresos,
          costo_ventas: costoVentasReal,
          utilidad_bruta: utilidadBruta,
          margen_porcentaje:
            ingresos > 0
              ? Math.round((utilidadBruta / ingresos) * 1000) / 10
              : null,
          lineas_con_costo: costoVentas.rows[0].lineas_con_costo,
          lineas_sin_costo: costoVentas.rows[0].lineas_sin_costo,
          insumos_sin_costo: costosInsumos.rows[0].insumos_sin_costo,
          total_insumos: costosInsumos.rows[0].total_insumos,
          top_margen_bajo: topMargenBajo.rows.map((fila) => ({
            ...fila,
            precio: Number(fila.precio),
            costo: Number(fila.costo),
            margen_porcentaje: Number(fila.margen_porcentaje),
          })),
        };
      })(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar el reporte." });
  }
});

module.exports = router;
