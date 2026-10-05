// =============================================================================
// scripts/seed-insumos.js — CATÁLOGO DE INSUMOS (Módulo de inventario, FASE 1)
// =============================================================================
// ADVERTENCIA — BORRADOR SIN VALIDAR (igual que recetario_insumos_por_platillo.txt,
// del cual sale esta lista): las cantidades del recetario que acompaña a este
// catálogo son una PROPUESTA construida a partir del menú + criterio estándar
// de cocina, NO datos confirmados por quien cocina. Este catálogo de insumos
// (nombres y unidad de medida) es el punto de partida para que Ximena lo
// revise — antes de operar el descuento automático en el negocio real hay
// que validar cada nombre, unidad de compra y cantidad mínima con ella.
//
// Incluye TODOS los insumos detectados en el recetario, incluidos los que
// todavía no se conectan a ninguna receta (salsas de alitas/boneless a
// elección, toppings de crepas/waffles, "elige 1 gratis" de algunas
// entradas) — esos se vinculan en la Fase 2 (selección estructurada en el
// POS), pero ya conviene tenerlos dados de alta para cuando llegue ese
// momento. Ver scripts/seed-recetas.js para qué platillos ya tienen receta.
//
// Re-corrible: si el insumo ya existe (por nombre) no lo duplica.
// Uso: node scripts/seed-insumos.js
// =============================================================================
require('dotenv').config();
const pool = require('../db');

// { nombre, unidad_medida } — unidad_medida: 'g' | 'ml' | 'u'
const INSUMOS = [
  // ---- Proteínas ----
  ['Carne de res (patty)', 'g'],
  ['Pechuga de pollo empanizada (tender)', 'g'],
  ['Alitas de pollo (crudo)', 'g'],
  ['Pechuga de pollo en trozos (crudo)', 'g'],
  ['Tocino', 'g'],
  ['Salchicha', 'g'],
  ['Camarón cóctel (cocido, pelado)', 'g'],
  ['Dedo de queso mozzarella empanizado (crudo)', 'u'],

  // ---- Panes, masas y mezclas ----
  ['Pan para hamburguesa', 'u'],
  ['Masa de pizza individual', 'u'],
  ['Masa de crepa (preparada)', 'u'],
  ['Waffle (preparado)', 'u'],
  ['Mezcla para hotcakes (preparada)', 'g'],
  ['Mezcla para waffle (preparada)', 'g'],
  ['Harina/empanizador', 'g'],

  // ---- Lácteos y helado ----
  ['Queso amarillo', 'g'],
  ['Queso mozzarella', 'g'],
  ['Queso cotija/parmesano', 'g'],
  ['Crema batida', 'g'],
  ['Crema chantillí', 'g'],
  ['Leche condensada (Lechera)', 'g'],
  ['Leche entera', 'ml'],
  ['Mantequilla', 'g'],
  ['Helado de vainilla', 'g'],

  // ---- Verduras y frutas frescas ----
  ['Cebolla morada (fileteada)', 'g'],
  ['Jitomate (rodajas)', 'g'],
  ['Lechuga', 'g'],
  ['Pepinillos', 'g'],
  ['Apio (bastones)', 'g'],
  ['Zanahoria (bastones)', 'g'],
  ['Chile jalapeño (rodajas)', 'g'],
  ['Champiñones (fileteados)', 'g'],
  ['Elote desgranado', 'g'],
  ['Elote en mazorca', 'u'],
  ['Cebolla picada', 'g'],
  ['Cilantro picado', 'g'],
  ['Manzana', 'u'],
  ['Piña (fresca)', 'g'],
  ['Piña en trozos (enlatada)', 'g'],
  ['Fresa', 'g'],
  ['Plátano', 'g'],
  ['Fruta variada (mango, sandía, jícama)', 'g'],
  ['Limón', 'u'],
  ['Papa corte delgado', 'g'],
  ['Papa en gajo', 'g'],
  ['Papa tornado (espiral, cruda)', 'u'],

  // ---- Salsas y condimentos FIJOS (van igual sin importar la variante) ----
  ['Mayonesa', 'g'],
  ['Salsa cátsup', 'g'],
  ['Salsa para pizza', 'g'],
  ['Pepperoni', 'g'],
  ['Aderezo ranch', 'g'],
  ['Chiles en escabeche', 'g'],
  ['Chile en polvo/piquín', 'g'],
  ['Salsa picante', 'ml'],
  ['Chamoy', 'ml'],
  ['Sal/sazonador', 'g'],
  ['Salsa clamato/michelada', 'ml'],
  ['Clamato (base)', 'ml'],
  ['Chiles curtidos', 'g'],
  ['Cereza en almíbar', 'g'],

  // ---- Salsas de hamburguesa (aquí SÍ es fija: cada sabor es su propia
  //      variante_producto — Hamburguesa BBQ, Buffalo, Mango Habanero) ----
  ['Salsa BBQ (hamburguesa)', 'ml'],
  ['Salsa Buffalo (hamburguesa)', 'ml'],
  ['Salsa Mango Habanero (hamburguesa)', 'ml'],

  // ---- Empanizados y guarniciones ----
  ['Papas a la francesa', 'g'],
  ['Aros de cebolla empanizados', 'g'],
  ['Totopos', 'g'],
  ['Tostitos (bolsa, para preparar)', 'g'],

  // ---- Dulces y snacks base ----
  ['Cacahuate (japonés/salado/enchilado)', 'g'], // genérico, sin usar (ver los 3 de abajo)
  ['Cacahuate japonés', 'g'],
  ['Cacahuate salado', 'g'],
  ['Cacahuate enchilado', 'g'],
  ['Mezcla de dulces/frutas enchiladas', 'g'],
  ['Pichachitos (cacahuate japonés)', 'g'],
  ['Papas fritas de bolsa', 'g'],
  ['Dulce enchilado', 'g'],
  ['Azúcar', 'g'],
  ['Azúcar glass', 'g'],
  ['Miel maple', 'g'],

  // ---- Bebidas base y jarabes (aquí también es fijo: frappé/malteada/
  //      smoothie tienen una variante_producto por sabor) ----
  ['Café concentrado', 'ml'],
  ['Jarabe moka', 'ml'],
  ['Jarabe vainilla', 'ml'],
  ['Jarabe caramelo', 'ml'],
  ['Hielo', 'g'],
  ['Agua o jugo base', 'ml'],
  ['Base cremosa (leche + helado)', 'ml'],
  ['Jarabe/pulpa de limón', 'g'],
  ['Jarabe de fresa', 'g'],
  ['Jarabe de chocolate', 'g'],
  ['Galleta Oreo molida', 'g'],
  ['Nutella', 'g'],
  ['Cajeta', 'g'],
  ['Mazapán', 'g'],
  ['Mermelada de zarzamora', 'g'],
  ['Pastelito Gansito (relleno)', 'g'],
  ['Jarabe/pulpa de mango', 'g'],
  ['Jarabe/pulpa de piña', 'g'],
  ['Jarabe/pulpa de sandía', 'g'],
  ['Jarabe/pulpa de tamarindo', 'g'],
  ['Jarabe/pulpa de picafresa', 'g'],
  ['Jarabe Icee cereza', 'g'],
  ['Jarabe Icee mora azul', 'g'],

  // ---- PENDIENTES DE FASE 2 (elección real del cliente en el POS) ----
  // Salsas de alitas/boneless: una sola variante_producto por paquete, el
  // sabor se elige al ordenar — no se puede fijar en la receta todavía.
  ['Salsa Buffalo (alitas/boneless)', 'ml'],
  ['Salsa Mango Habanero (alitas/boneless)', 'ml'],
  ['Salsa BBQ Habanero', 'ml'],
  ['Salsa Parmesano (alitas/boneless)', 'ml'],
  ['Salsa BBQ Clásica', 'ml'],
  ['Salsa BBQ Chipotle', 'ml'],
  ['Salsa Lemon Pepper', 'ml'],
  ['Salsa BBQ Miel', 'ml'],
  ['Salsa Buffalo Hot', 'ml'],
  // Toppings de crepas/waffles: se elige 1 (o 3, en las "especiales") por orden.
  ['Hershey\'s (jarabe de chocolate)', 'g'],
  ['Coco rallado', 'g'],
  ['Almendra', 'g'],
  ['Chispas de chocolate', 'g'],
  ['Nuez', 'g'],
  ['Durazno (en almíbar)', 'g'],
  ['Mermelada de fresa', 'g'],
  ['Mermelada de piña', 'g'],
  ['Queso crema Philadelphia', 'g'],
  ['Chispas de colores', 'g'],
  ['Lunetas', 'g'],
  // "Elige 1 gratis" de entradas (papas, dedos de queso, aros de cebolla,
  // tipo de cacahuate de pepihuates, sazonador de tornado).
  ['Queso parmesano (espolvorear)', 'g'],

  // ---- Empaque completo (botanas de sobre y bebidas embotelladas): el
  //      "insumo" es la bolsa/botella entera tal como se compra. Nombres
  //      iguales al producto para que la receta sea 1 línea = 1 pieza. ----
  ['Tostitos Salsa Verde (sobre)', 'u'],
  ['Tostitos Flamin Hot (sobre)', 'u'],
  ['Cheetos Flamin Hot (sobre)', 'u'],
  ['Doritos Nacho (sobre)', 'u'],
  ['Ruffles Queso (sobre)', 'u'],
  ['Doritos Dinamita (sobre)', 'u'],
  ['Sabritas Crujiente (sobre)', 'u'],
  ['Picachitos (sobre)', 'u'],
  ['Agua Purificada 500 ml (botella)', 'u'],
  ['Agua Purificada 1 Lt (botella)', 'u'],
  ['Agua Mineral 600 ml (botella)', 'u'],
  ['Coca-Cola 600 ml (botella)', 'u'],
  ['Refresco 600 ml (botella)', 'u'],
  ['Refresco lata/lote 355-400 ml', 'u'],
  ['Jarritos 355 ml (botella)', 'u'],
  ['Arizona 591 ml (botella)', 'u'],
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let creados = 0;
    let existentes = 0;

    for (const [nombre, unidad] of INSUMOS) {
      const yaExiste = await client.query('SELECT id FROM insumos WHERE nombre = $1', [nombre]);
      if (yaExiste.rows.length > 0) {
        existentes++;
        continue;
      }
      // cantidad_minima en 0 a propósito: todavía no hay existencias reales
      // ni umbrales de reorden confirmados por Ximena.
      await client.query(
        `INSERT INTO insumos (nombre, unidad_medida, cantidad_minima, proveedor_id)
         VALUES ($1, $2, 0, NULL)`,
        [nombre, unidad]
      );
      creados++;
    }

    await client.query('COMMIT');
    console.log(`Insumos: ${creados} creados, ${existentes} ya existían. Total en catálogo: ${INSUMOS.length}.`);
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al poblar insumos:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

seed();
