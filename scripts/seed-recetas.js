// =============================================================================
// scripts/seed-recetas.js — RECETAS POR VARIANTE (Módulo de inventario, FASE 1)
// =============================================================================
// ADVERTENCIA — BORRADOR SIN VALIDAR (ver scripts/seed-insumos.js y
// recetario_insumos_por_platillo.txt): cantidades propuestas a partir del
// menú + criterio estándar de cocina, NO confirmadas por quien cocina.
// Cargar esto NO activa ningún descuento automático todavía — eso se conecta
// en una fase aparte (PATCH /api/ordenes/:id/estado al pasar a 'preparando').
// Esto solo deja la relación variante → insumos lista para cuando se
// conecte, y para que Ximena pueda revisar cantidades por variante.
//
// ALCANCE DE ESTA FASE — qué SÍ y qué NO incluye cada receta:
//   Un platillo entra COMPLETO cuando el menú no deja nada a elección del
//   cliente en el momento de pedir (aunque tenga "sabor" — si cada sabor es
//   su propia variante_producto, como Hamburguesa BBQ/Buffalo/Mango Habanero
//   o cada Frappé/Malteada/Smoothie, el sabor YA está resuelto por qué botón
//   se tocó en el POS, así que sí se puede fijar).
//
//   Un platillo entra PARCIAL cuando el cliente elige algo que hoy solo se
//   captura como texto libre en `notas` (una sola variante_producto para
//   varios sabores/ingredientes posibles) — ahí se omite esa línea a
//   propósito, en vez de adivinar un insumo genérico. Quedan marcados abajo
//   en PENDIENTES_FASE2. Eso se resuelve en la Fase 2 (selección
//   estructurada en el POS), tal como se decidió con el usuario.
//
// Re-corrible: si la receta de una variante ya existe, no la duplica; si un
// renglón de receta_insumos ya existe para esa receta+insumo, tampoco.
// Uso: node scripts/seed-recetas.js   (requiere haber corrido seed-insumos.js)
// =============================================================================
require('dotenv').config();
const pool = require('../db');

// Cada entrada: [varianteId, 'Nombre para el log', [[insumo, cantidad, unidad], ...]]
const RECETAS = [
  // ===================== HAMBURGUESAS =====================
  [16, 'Hamburguesa Tradicional', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Tocino', 20, 'g'], ['Queso amarillo', 20, 'g'], ['Cebolla morada (fileteada)', 15, 'g'],
    ['Jitomate (rodajas)', 30, 'g'], ['Lechuga', 20, 'g'], ['Mayonesa', 15, 'g'],
    ['Salsa cátsup', 15, 'g'], ['Chiles en escabeche', 10, 'g'],
  ]],
  [17, 'Hamburguesa BBQ', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Salsa BBQ (hamburguesa)', 30, 'ml'], ['Aros de cebolla empanizados', 60, 'g'],
    ['Tocino', 20, 'g'], ['Mayonesa', 15, 'g'], ['Queso amarillo', 20, 'g'],
  ]],
  [18, 'Hamburguesa Buffalo', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Salsa Buffalo (hamburguesa)', 30, 'ml'], ['Aros de cebolla empanizados', 60, 'g'],
    ['Tocino', 20, 'g'], ['Mayonesa', 15, 'g'], ['Queso amarillo', 20, 'g'],
  ]],
  [19, 'Hamburguesa Mango Habanero', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Salsa Mango Habanero (hamburguesa)', 30, 'ml'], ['Aros de cebolla empanizados', 60, 'g'],
    ['Tocino', 20, 'g'], ['Mayonesa', 15, 'g'], ['Queso amarillo', 20, 'g'],
  ]],
  [20, 'Hamburguesa de Pollo', [
    ['Pan para hamburguesa', 1, 'u'], ['Pechuga de pollo empanizada (tender)', 130, 'g'],
    ['Queso amarillo', 20, 'g'], ['Cebolla morada (fileteada)', 15, 'g'], ['Lechuga', 20, 'g'],
    ['Jitomate (rodajas)', 30, 'g'], ['Pepinillos', 10, 'g'], ['Aderezo ranch', 20, 'g'],
  ]],
  // Combos = receta de la hamburguesa elegida + papas + refresco (duplicada
  // completa: el esquema no modela "receta que hereda de otra receta").
  [21, 'Combo Hamburguesa Tradicional', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Tocino', 20, 'g'], ['Queso amarillo', 20, 'g'], ['Cebolla morada (fileteada)', 15, 'g'],
    ['Jitomate (rodajas)', 30, 'g'], ['Lechuga', 20, 'g'], ['Mayonesa', 15, 'g'],
    ['Salsa cátsup', 15, 'g'], ['Chiles en escabeche', 10, 'g'],
    ['Papas a la francesa', 100, 'g'], ['Refresco lata/lote 355-400 ml', 1, 'u'],
  ]],
  [22, 'Combo Hamburguesa BBQ', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Salsa BBQ (hamburguesa)', 30, 'ml'], ['Aros de cebolla empanizados', 60, 'g'],
    ['Tocino', 20, 'g'], ['Mayonesa', 15, 'g'], ['Queso amarillo', 20, 'g'],
    ['Papas a la francesa', 100, 'g'], ['Refresco lata/lote 355-400 ml', 1, 'u'],
  ]],
  [23, 'Combo Hamburguesa Buffalo', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Salsa Buffalo (hamburguesa)', 30, 'ml'], ['Aros de cebolla empanizados', 60, 'g'],
    ['Tocino', 20, 'g'], ['Mayonesa', 15, 'g'], ['Queso amarillo', 20, 'g'],
    ['Papas a la francesa', 100, 'g'], ['Refresco lata/lote 355-400 ml', 1, 'u'],
  ]],
  [24, 'Combo Hamburguesa Mango Habanero', [
    ['Pan para hamburguesa', 1, 'u'], ['Carne de res (patty)', 120, 'g'],
    ['Salsa Mango Habanero (hamburguesa)', 30, 'ml'], ['Aros de cebolla empanizados', 60, 'g'],
    ['Tocino', 20, 'g'], ['Mayonesa', 15, 'g'], ['Queso amarillo', 20, 'g'],
    ['Papas a la francesa', 100, 'g'], ['Refresco lata/lote 355-400 ml', 1, 'u'],
  ]],
  [25, 'Combo Hamburguesa de Pollo', [
    ['Pan para hamburguesa', 1, 'u'], ['Pechuga de pollo empanizada (tender)', 130, 'g'],
    ['Queso amarillo', 20, 'g'], ['Cebolla morada (fileteada)', 15, 'g'], ['Lechuga', 20, 'g'],
    ['Jitomate (rodajas)', 30, 'g'], ['Pepinillos', 10, 'g'], ['Aderezo ranch', 20, 'g'],
    ['Papas a la francesa', 100, 'g'], ['Refresco lata/lote 355-400 ml', 1, 'u'],
  ]],

  // ===================== PIZZAS =====================
  [26, 'Pizza Pepperoni', [
    ['Masa de pizza individual', 1, 'u'], ['Salsa para pizza', 40, 'g'],
    ['Queso mozzarella', 80, 'g'], ['Pepperoni', 40, 'g'],
  ]],
  [27, 'Pizza Mexicana', [
    ['Masa de pizza individual', 1, 'u'], ['Salsa para pizza', 40, 'g'],
    ['Queso mozzarella', 80, 'g'], ['Pepperoni', 25, 'g'],
    ['Chile jalapeño (rodajas)', 15, 'g'], ['Tocino', 15, 'g'],
  ]],
  [28, 'Pizza Hawaiana', [
    ['Masa de pizza individual', 1, 'u'], ['Salsa para pizza', 40, 'g'],
    ['Queso mozzarella', 80, 'g'], ['Tocino', 20, 'g'],
    ['Piña en trozos (enlatada)', 40, 'g'], ['Cereza en almíbar', 10, 'g'],
  ]],
  [29, 'Ingrediente Extra para Pizza — Champiñones', [['Champiñones (fileteados)', 30, 'g']]],
  [30, 'Ingrediente Extra para Pizza — Salchicha', [['Salchicha', 30, 'g']]],

  // ===================== ALITAS (parcial: se omite la salsa a elección) ====
  [31, 'Alitas — 12 piezas', [
    ['Alitas de pollo (crudo)', 720, 'g'], ['Apio (bastones)', 20, 'g'],
    ['Zanahoria (bastones)', 20, 'g'], ['Aderezo ranch', 30, 'g'],
  ]],
  [32, 'Alitas — Paquete #1', [
    ['Alitas de pollo (crudo)', 480, 'g'], ['Papas a la francesa', 80, 'g'],
    ['Apio (bastones)', 15, 'g'], ['Zanahoria (bastones)', 15, 'g'],
    ['Aderezo ranch', 30, 'g'], ['Salsa cátsup', 15, 'g'],
  ]],
  [33, 'Alitas — Paquete #2', [
    ['Alitas de pollo (crudo)', 720, 'g'], ['Papas a la francesa', 100, 'g'],
    ['Apio (bastones)', 20, 'g'], ['Zanahoria (bastones)', 20, 'g'],
    ['Aderezo ranch', 30, 'g'], ['Salsa cátsup', 30, 'g'],
  ]],
  // Paquete #3 además deja fuera "papas O aros" (también es elección).
  [34, 'Alitas — Paquete #3', [
    ['Alitas de pollo (crudo)', 1440, 'g'], ['Apio (bastones)', 30, 'g'],
    ['Zanahoria (bastones)', 30, 'g'], ['Aderezo ranch', 60, 'g'], ['Salsa cátsup', 30, 'g'],
  ]],
  [35, 'Alitas — Paquete #4', [
    ['Alitas de pollo (crudo)', 2160, 'g'], ['Papas a la francesa', 200, 'g'],
    ['Aros de cebolla empanizados', 100, 'g'], ['Apio (bastones)', 40, 'g'],
    ['Zanahoria (bastones)', 40, 'g'], ['Aderezo ranch', 90, 'g'], ['Salsa cátsup', 30, 'g'],
  ]],

  // ===================== BONELESS (parcial: se omite la salsa) =====
  [36, 'Boneless — 250 g', [
    ['Pechuga de pollo en trozos (crudo)', 250, 'g'], ['Harina/empanizador', 50, 'g'],
    ['Apio (bastones)', 20, 'g'], ['Zanahoria (bastones)', 20, 'g'], ['Aderezo ranch', 30, 'g'],
  ]],
  [37, 'Boneless — Paquete #1', [
    ['Pechuga de pollo en trozos (crudo)', 125, 'g'], ['Harina/empanizador', 25, 'g'],
    ['Papas a la francesa', 80, 'g'], ['Apio (bastones)', 15, 'g'],
    ['Zanahoria (bastones)', 15, 'g'], ['Aderezo ranch', 30, 'g'], ['Salsa cátsup', 15, 'g'],
  ]],
  [38, 'Boneless — Paquete #2', [
    ['Pechuga de pollo en trozos (crudo)', 250, 'g'], ['Harina/empanizador', 50, 'g'],
    ['Papas a la francesa', 100, 'g'], ['Apio (bastones)', 20, 'g'],
    ['Zanahoria (bastones)', 20, 'g'], ['Aderezo ranch', 30, 'g'], ['Salsa cátsup', 30, 'g'],
  ]],
  [39, 'Boneless — Paquete #3', [
    ['Pechuga de pollo en trozos (crudo)', 250, 'g'], ['Harina/empanizador', 50, 'g'],
    ['Aros de cebolla empanizados', 100, 'g'], ['Apio (bastones)', 20, 'g'],
    ['Zanahoria (bastones)', 20, 'g'], ['Aderezo ranch', 30, 'g'], ['Salsa cátsup', 30, 'g'],
  ]],

  // ===================== PAPAS Y ENTRADAS =====================
  // Papas a la Francesa y Papas en Gajo: se omite el "ingrediente gratis a elección".
  [40, 'Papas a la Francesa', [['Papa corte delgado', 180, 'g'], ['Sal/sazonador', 2, 'g']]],
  [41, 'Papas en Gajo', [['Papa en gajo', 200, 'g'], ['Sal/sazonador', 3, 'g']]],
  [42, 'Salchi-Papas', [
    ['Papas a la francesa', 150, 'g'], ['Salchicha', 100, 'g'], ['Salsa cátsup', 15, 'g'],
    ['Mayonesa', 15, 'g'], ['Chiles curtidos', 10, 'g'],
  ]],
  // Dedos de Queso: precio y receta por PIEZA (orden_detalle.cantidad ya son
  // piezas); se omite el dip a elección.
  [43, 'Dedos de Queso', [['Dedo de queso mozzarella empanizado (crudo)', 1, 'u']]],
  [44, 'Aros de Cebolla', [['Aros de cebolla empanizados', 150, 'g']]],

  // ===================== SNACKS Y CLAMATOS =====================
  // Pepihuates: se omite el tipo de cacahuate a elección (línea principal).
  [45, 'Pepihuates — Chico', [
    ['Limón', 1, 'u'], ['Chamoy', 20, 'ml'], ['Salsa picante', 10, 'ml'], ['Chile en polvo/piquín', 3, 'g'],
  ]],
  [46, 'Pepihuates — Mediano', [
    ['Limón', 1, 'u'], ['Chamoy', 30, 'ml'], ['Salsa picante', 15, 'ml'], ['Chile en polvo/piquín', 5, 'g'],
  ]],
  [47, 'Picamix — Chico', [
    ['Mezcla de dulces/frutas enchiladas', 100, 'g'], ['Chamoy', 20, 'ml'], ['Limón', 1, 'u'],
  ]],
  [48, 'Picamix — Mediano', [
    ['Mezcla de dulces/frutas enchiladas', 150, 'g'], ['Chamoy', 30, 'ml'], ['Limón', 1, 'u'],
  ]],
  [49, 'Pichachitos Preparados', [
    ['Pichachitos (cacahuate japonés)', 80, 'g'], ['Limón', 1, 'u'],
    ['Salsa picante', 10, 'ml'], ['Chamoy', 10, 'ml'],
  ]],
  [50, 'Papas Locas', [
    ['Papas fritas de bolsa', 60, 'g'], ['Dulce enchilado', 20, 'g'],
    ['Chamoy', 20, 'ml'], ['Salsa picante', 10, 'ml'], ['Limón', 1, 'u'],
  ]],
  [51, 'Miche-Papas', [
    ['Papas fritas de bolsa', 60, 'g'], ['Elote desgranado', 50, 'g'],
    ['Salsa clamato/michelada', 60, 'ml'], ['Salsa picante', 10, 'ml'],
    ['Limón', 1, 'u'], ['Chile en polvo/piquín', 3, 'g'],
  ]],
  [52, 'Clamato Preparado', [
    ['Clamato (base)', 350, 'ml'], ['Limón', 1, 'u'], ['Salsa picante', 15, 'ml'],
    ['Sal/sazonador', 3, 'g'], ['Chamoy', 10, 'ml'],
  ]],
  [53, 'Nachos', [
    ['Totopos', 80, 'g'], ['Queso amarillo', 60, 'g'], ['Chile jalapeño (rodajas)', 15, 'g'],
  ]],

  // ===================== TOSTITOS, ELOTES Y BOTANAS PREPARADAS =====================
  [54, 'Tostitos Preparados', [
    ['Tostitos (bolsa, para preparar)', 60, 'g'], ['Limón', 1, 'u'],
    ['Salsa picante', 15, 'ml'], ['Chamoy', 15, 'ml'], ['Chile en polvo/piquín', 3, 'g'],
  ]],
  [55, 'Tostitos con Camarón', [
    ['Tostitos (bolsa, para preparar)', 60, 'g'], ['Camarón cóctel (cocido, pelado)', 80, 'g'],
    ['Salsa clamato/michelada', 60, 'ml'], ['Limón', 1, 'u'], ['Chile en polvo/piquín', 3, 'g'],
    ['Cebolla picada', 10, 'g'], ['Cilantro picado', 5, 'g'],
  ]],
  [56, 'Tostiti-Elote', [
    ['Tostitos (bolsa, para preparar)', 40, 'g'], ['Elote desgranado', 100, 'g'],
    ['Mayonesa', 20, 'g'], ['Queso cotija/parmesano', 15, 'g'],
    ['Chile en polvo/piquín', 3, 'g'], ['Limón', 1, 'u'],
  ]],
  [57, 'Esquite', [
    ['Elote desgranado', 150, 'g'], ['Mayonesa', 20, 'g'], ['Queso cotija/parmesano', 15, 'g'],
    ['Chile en polvo/piquín', 3, 'g'], ['Limón', 1, 'u'],
  ]],
  [58, 'Elote Hot', [
    ['Elote en mazorca', 1, 'u'], ['Mayonesa', 20, 'g'], ['Queso cotija/parmesano', 15, 'g'],
    ['Salsa picante', 5, 'ml'], ['Limón', 1, 'u'],
  ]],
  [59, 'Chuchi-Elote', [
    ['Elote desgranado', 120, 'g'], ['Mayonesa', 20, 'g'], ['Queso cotija/parmesano', 15, 'g'],
    ['Tostitos (bolsa, para preparar)', 20, 'g'], ['Chamoy', 10, 'ml'], ['Chile en polvo/piquín', 3, 'g'],
  ]],
  [60, 'Elote Chorreado', [
    ['Elote desgranado', 150, 'g'], ['Queso amarillo', 60, 'g'], ['Mayonesa', 20, 'g'],
    ['Tocino', 15, 'g'], ['Chile en polvo/piquín', 3, 'g'],
  ]],

  // ===================== FRUTAS LOCAS Y ESPECIALES =====================
  [61, 'Manzana Loca', [
    ['Manzana', 1, 'u'], ['Chamoy', 30, 'ml'], ['Chile en polvo/piquín', 3, 'g'],
    ['Dulce enchilado', 20, 'g'], ['Limón', 1, 'u'],
  ]],
  [62, 'Piña Loca', [
    ['Piña (fresca)', 300, 'g'], ['Chamoy', 40, 'ml'], ['Chile en polvo/piquín', 5, 'g'],
    ['Dulce enchilado', 30, 'g'], ['Limón', 1, 'u'],
  ]],
  // Tornado: se omiten sazonador y dip, ambos a elección.
  [63, 'Tornado', [['Papa tornado (espiral, cruda)', 1, 'u']]],
  [64, 'Tacos Locos (3 piezas)', [
    ['Fruta variada (mango, sandía, jícama)', 250, 'g'], ['Chamoy', 30, 'ml'],
    ['Chile en polvo/piquín', 5, 'g'], ['Limón', 1, 'u'],
  ]],
  [65, 'Fresas con Crema — Sencillas', [['Fresa', 200, 'g'], ['Crema batida', 60, 'g']]],
  [66, 'Fresas con Crema — Chantillí', [
    ['Fresa', 200, 'g'], ['Crema chantillí', 80, 'g'], ['Leche condensada (Lechera)', 20, 'g'],
  ]],
  [67, 'Fresas con Crema — Ice Cream', [
    ['Fresa', 150, 'g'], ['Helado de vainilla', 100, 'g'], ['Crema batida', 40, 'g'],
  ]],

  // ===================== CREPAS, WAFFLES Y HOTCAKES =====================
  // Sencillas: se omite el topping a elección (queda solo la base).
  [68, 'Crepa Sencilla', [['Masa de crepa (preparada)', 1, 'u']]],
  [69, 'Waffle Sencillo', [['Waffle (preparado)', 1, 'u']]],
  [70, 'Minihotcakes (14 piezas)', [
    ['Mezcla para hotcakes (preparada)', 200, 'g'], ['Mantequilla', 10, 'g'], ['Miel maple', 30, 'g'],
  ]],
  [71, 'Miniwaffles (2 piezas)', [
    ['Mezcla para waffle (preparada)', 150, 'g'], ['Azúcar glass', 5, 'g'], ['Miel maple', 20, 'g'],
  ]],
  // Especiales: se omiten los 3 toppings a elección (queda base + helado).
  [72, 'Crepa Especial', [['Masa de crepa (preparada)', 1, 'u'], ['Helado de vainilla', 50, 'g']]],
  [73, 'Waffle Especial', [['Waffle (preparado)', 1, 'u'], ['Helado de vainilla', 50, 'g']]],

  // ===================== MALTEADAS (el sabor ya es la variante) =====
  [74, 'Malteada Fresa', [
    ['Helado de vainilla', 150, 'g'], ['Leche entera', 150, 'ml'],
    ['Jarabe de fresa', 30, 'g'], ['Crema batida', 15, 'g'],
  ]],
  [75, 'Malteada Vainilla', [
    ['Helado de vainilla', 150, 'g'], ['Leche entera', 150, 'ml'], ['Crema batida', 15, 'g'],
  ]],
  [76, 'Malteada Oreo', [
    ['Helado de vainilla', 150, 'g'], ['Leche entera', 150, 'ml'],
    ['Galleta Oreo molida', 30, 'g'], ['Crema batida', 15, 'g'],
  ]],
  [77, 'Malteada Chocolate', [
    ['Helado de vainilla', 150, 'g'], ['Leche entera', 150, 'ml'],
    ['Jarabe de chocolate', 30, 'g'], ['Crema batida', 15, 'g'],
  ]],

  // ===================== SMOOTHIE NATURAL (el sabor ya es la variante) =====
  [78, 'Smoothie Natural — Mango', [
    ['Jarabe/pulpa de mango', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [79, 'Smoothie Natural — Fresa', [
    ['Fresa', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [80, 'Smoothie Natural — Piña', [
    ['Jarabe/pulpa de piña', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [81, 'Smoothie Natural — Sandía', [
    ['Jarabe/pulpa de sandía', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [82, 'Smoothie Natural — Tamarindo', [
    ['Jarabe/pulpa de tamarindo', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [83, 'Smoothie Natural — Limón', [
    ['Jarabe/pulpa de limón', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [84, 'Smoothie Natural — Picafresa', [
    ['Jarabe/pulpa de picafresa', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [85, 'Smoothie Natural — Icee Cereza', [
    ['Jarabe Icee cereza', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],
  [86, 'Smoothie Natural — Icee Mora Azul', [
    ['Jarabe Icee mora azul', 150, 'g'], ['Hielo', 100, 'g'], ['Agua o jugo base', 100, 'ml'], ['Azúcar', 15, 'g'],
  ]],

  // ===================== SMOOTHIE CREMOSO (el sabor ya es la variante) =====
  [87, 'Smoothie Cremoso — Nutella', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Nutella', 40, 'g'], ['Hielo', 80, 'g'],
  ]],
  [88, 'Smoothie Cremoso — Oreo', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Galleta Oreo molida', 40, 'g'], ['Hielo', 80, 'g'],
  ]],
  [89, 'Smoothie Cremoso — Fresa', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Fresa', 40, 'g'], ['Hielo', 80, 'g'],
  ]],
  [90, 'Smoothie Cremoso — Cajeta', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Cajeta', 40, 'g'], ['Hielo', 80, 'g'],
  ]],
  [91, 'Smoothie Cremoso — Gansito', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Pastelito Gansito (relleno)', 40, 'g'], ['Hielo', 80, 'g'],
  ]],
  [92, 'Smoothie Cremoso — Mazapán', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Mazapán', 40, 'g'], ['Hielo', 80, 'g'],
  ]],
  [93, 'Smoothie Cremoso — Zarzamora', [
    ['Base cremosa (leche + helado)', 200, 'ml'], ['Mermelada de zarzamora', 40, 'g'], ['Hielo', 80, 'g'],
  ]],

  // ===================== CAFÉ Y FRAPPÉ (el sabor ya es la variante) =====
  [94, 'Café a las Rocas', [
    ['Café concentrado', 60, 'ml'], ['Leche entera', 100, 'ml'], ['Hielo', 100, 'g'], ['Azúcar', 15, 'g'],
  ]],
  [95, 'Frappé Regular', [
    ['Café concentrado', 80, 'ml'], ['Leche entera', 100, 'ml'], ['Hielo', 150, 'g'], ['Crema batida', 15, 'g'],
  ]],
  [96, 'Frappé Moka', [
    ['Café concentrado', 80, 'ml'], ['Leche entera', 100, 'ml'], ['Hielo', 150, 'g'],
    ['Jarabe moka', 30, 'ml'], ['Crema batida', 15, 'g'],
  ]],
  [97, 'Frappé Vainilla', [
    ['Café concentrado', 80, 'ml'], ['Leche entera', 100, 'ml'], ['Hielo', 150, 'g'],
    ['Jarabe vainilla', 30, 'ml'], ['Crema batida', 15, 'g'],
  ]],
  [98, 'Frappé Caramelo', [
    ['Café concentrado', 80, 'ml'], ['Leche entera', 100, 'ml'], ['Hielo', 150, 'g'],
    ['Jarabe caramelo', 30, 'ml'], ['Crema batida', 15, 'g'],
  ]],

  // ===================== BOTANAS DE SOBRE (empaque completo, 1 a 1) =====
  [99, 'Tostitos Salsa Verde', [['Tostitos Salsa Verde (sobre)', 1, 'u']]],
  [100, 'Tostitos Flamin Hot', [['Tostitos Flamin Hot (sobre)', 1, 'u']]],
  [101, 'Cheetos Flamin Hot', [['Cheetos Flamin Hot (sobre)', 1, 'u']]],
  [102, 'Doritos Nacho', [['Doritos Nacho (sobre)', 1, 'u']]],
  [103, 'Ruffles Queso', [['Ruffles Queso (sobre)', 1, 'u']]],
  [104, 'Doritos Dinamita', [['Doritos Dinamita (sobre)', 1, 'u']]],
  [105, 'Sabritas Crujiente', [['Sabritas Crujiente (sobre)', 1, 'u']]],
  [106, 'Picachitos', [['Picachitos (sobre)', 1, 'u']]],

  // ===================== BEBIDAS EMBOTELLADAS (empaque completo, 1 a 1) ===
  [107, 'Agua Purificada 500 ml', [['Agua Purificada 500 ml (botella)', 1, 'u']]],
  [108, 'Agua Purificada 1 Lt', [['Agua Purificada 1 Lt (botella)', 1, 'u']]],
  [109, 'Agua Mineral 600 ml', [['Agua Mineral 600 ml (botella)', 1, 'u']]],
  [110, 'Coca-Cola 600 ml', [['Coca-Cola 600 ml (botella)', 1, 'u']]],
  [111, 'Refresco 600 ml', [['Refresco 600 ml (botella)', 1, 'u']]],
  [112, 'Refresco lata/lote', [['Refresco lata/lote 355-400 ml', 1, 'u']]],
  [113, 'Jarritos 355 ml', [['Jarritos 355 ml (botella)', 1, 'u']]],
  [114, 'Arizona 591 ml', [['Arizona 591 ml (botella)', 1, 'u']]],
];

// Variantes que NO quedaron con receta completa en esta fase, y por qué —
// para que no parezca un olvido. Se completan en la Fase 2 (selección
// estructurada de "elección" en el POS): 31-35 y 36-39 (falta la salsa de
// alitas/boneless), 40-41 (ingrediente gratis a elección), 43-44 (dip a
// elección), 45-46 (tipo de cacahuate), 63 (sazonador y dip), 68-69 y 72-73
// (topping de crepa/waffle a elección). Todas ESTAS SÍ tienen una receta
// PARCIAL cargada arriba (lo fijo, sin lo que se elige), no están vacías.

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let recetasCreadas = 0;
    let lineasCreadas = 0;
    let lineasOmitidas = 0;

    for (const [varianteId, nombre, items] of RECETAS) {
      // Una receta por variante (recetas.variante_id es UNIQUE).
      let receta = await client.query('SELECT id FROM recetas WHERE variante_id = $1', [varianteId]);
      let recetaId;
      if (receta.rows.length === 0) {
        const nueva = await client.query(
          'INSERT INTO recetas (variante_id) VALUES ($1) RETURNING id',
          [varianteId]
        );
        recetaId = nueva.rows[0].id;
        recetasCreadas++;
      } else {
        recetaId = receta.rows[0].id;
      }

      for (const [insumoNombre, cantidad, unidad] of items) {
        const insumo = await client.query('SELECT id FROM insumos WHERE nombre = $1', [insumoNombre]);
        if (insumo.rows.length === 0) {
          throw new Error(
            `Insumo "${insumoNombre}" (receta de "${nombre}", variante ${varianteId}) no existe. ` +
            `¿Ya corriste seed-insumos.js?`
          );
        }
        const insumoId = insumo.rows[0].id;

        const yaExiste = await client.query(
          'SELECT id FROM receta_insumos WHERE receta_id = $1 AND insumo_id = $2',
          [recetaId, insumoId]
        );
        if (yaExiste.rows.length > 0) {
          lineasOmitidas++;
          continue;
        }

        await client.query(
          `INSERT INTO receta_insumos (receta_id, insumo_id, cantidad, unidad_medida)
           VALUES ($1, $2, $3, $4)`,
          [recetaId, insumoId, cantidad, unidad]
        );
        lineasCreadas++;
      }
    }

    await client.query('COMMIT');
    console.log(
      `Recetas: ${recetasCreadas} nuevas (${RECETAS.length} variantes con receta cargada). ` +
      `Líneas de receta_insumos: ${lineasCreadas} nuevas, ${lineasOmitidas} ya existían.`
    );
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al poblar recetas:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

seed();
