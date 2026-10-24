// =============================================================================
// utils/existencia.js — EXPRESIÓN SQL COMPARTIDA DE EXISTENCIA DE UN INSUMO
// =============================================================================
// existencia = entrada + ajuste − salida − merma, sumado sobre
// movimientos_inventario. Antes vivía duplicada (routes/insumos.js la tenía
// como constante local, routes/reportes.js la repetía inline, con un
// comentario explícito de que no había un utils/ que la compartiera
// todavía). Se compartió aquí al agregar un tercer uso real en
// routes/catalogo.js (disponibilidad de variantes en el POS, 2026-10-22):
// si esa tercera copia llegara a divergir de las otras dos, un insumo
// podría verse "agotado" en Inventario y "disponible" en el POS al mismo
// tiempo — un desacuerdo que antes no importaba (ambos usos eran de solo
// lectura/reporte) pero que ahora decide si algo se puede vender.
//
// Siempre espera el mismo alias de tabla en la consulta que la usa:
// `i` para insumos, `m` para movimientos_inventario (LEFT JOIN).
const EXPRESION_EXISTENCIA = `COALESCE(SUM(
  CASE
    WHEN m.tipo IN ('entrada', 'ajuste') THEN m.cantidad
    WHEN m.tipo IN ('salida', 'merma') THEN -m.cantidad
    ELSE 0
  END
), 0)`;

module.exports = { EXPRESION_EXISTENCIA };
