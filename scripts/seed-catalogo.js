// Puebla el catálogo real de CHUCHERIAS MIX (ver men_chucher_as_mix.txt).
// Reemplaza el seed de datos de prueba original: los productos/variantes
// viejos NO se borran (algunas ventas reales ya los referencian por FK),
// se desactivan (activo = FALSE) y se reemplazan por el menú completo.
//
// "A Granel" queda fuera a propósito: se vende por gramaje/"desde $1.00",
// sin precio fijo, y el sistema siempre calcula el precio del lado del
// servidor — no encaja en el modelo actual hasta que exista precio por peso.
//
// Uso: node scripts/seed-catalogo.js
//
// ADVERTENCIA: escribe en la base de datos REAL (Neon). Corre todo dentro de
// una transacción: si algo falla, no queda nada a medias.
//
// ESTRUCTURA DE ESTE ARCHIVO
//   1. Listas de categorías (sin cambio / renombradas / nuevas).
//   2. PRODUCTOS: el menú completo como datos (categoría, nombre, descripción
//      y las variantes con su precio).
//   3. seed(): la función que aplica esos datos a la base, en 5 pasos.

require('dotenv').config();
const pool = require('../db');

// Categorías que ya existían y se reutilizan tal cual (mismo id, mismo nombre).
const CATEGORIAS_SIN_CAMBIO = ['Hamburguesas', 'Pizzas', 'Crepas y Waffles', 'Bebidas Preparadas'];

// Categorías viejas que se renombran (mismo id, mantiene los productos
// desactivados que tenía antes, pero el nombre pasa a ser el nuevo).
const CATEGORIAS_RENOMBRADAS = {
  'Alitas y Boneless': 'Alitas',
  'Snacks y Botanas': 'Snacks y Clamatos',
};

// Categorías nuevas.
const CATEGORIAS_NUEVAS = [
  'Boneless',
  'Papas y Entradas',
  'Tostitos y Elotes',
  'Frutas Locas',
  'Botanas de Sobre',
  'Bebidas Embotelladas',
];

const SALSAS_ALITAS_BONELESS =
  'Salsas disponibles: Buffalo, Mango Habanero, BBQ Habanero, Parmesano, BBQ Clásica, BBQ Chipotle, Lemon Pepper, BBQ Miel, Buffalo Hot.';

const TOPPINGS_CREPAS =
  'Toppings disponibles: cajeta, lechera, Hershey\'s, mapple, coco, almendra, chispas de chocolate, fresa, plátano, cereza, durazno, nuez, mermelada de zarzamora, mermelada de fresa, mermelada de piña, Nutella, Philadelphia, azúcar glass, galleta Oreo, mazapán, chispas de colores, lunetas.';

// El menú real como datos. Cada entrada es un producto:
//   { categoria, nombre, descripcion, variantes: [{ nombre, precio }] }
// Lo que el cliente compra es una VARIANTE (tamaño/paquete) y cada una lleva su
// precio; productos con una sola presentación usan la variante "Único".
// Para cambiar un precio o agregar un producto, se edita aquí y se vuelve a
// correr el script (no duplica lo que ya existe).
const PRODUCTOS = [
  // ---- Hamburguesas ----
  {
    categoria: 'Hamburguesas',
    nombre: 'Hamburguesa Tradicional',
    descripcion:
      'Carne cocida al gusto, tocino, queso amarillo, cebolla morada, tomate, lechuga, mayonesa, salsa cátsup y chiles.',
    variantes: [{ nombre: 'Único', precio: 60 }],
  },
  {
    categoria: 'Hamburguesas',
    nombre: 'Hamburguesa BBQ',
    descripcion:
      'Carne cocida al gusto, bañada en salsa BBQ, aros de cebolla empanizados, tocino, mayonesa y queso amarillo.',
    variantes: [{ nombre: 'Único', precio: 68 }],
  },
  {
    categoria: 'Hamburguesas',
    nombre: 'Hamburguesa Buffalo',
    descripcion:
      'Carne cocida al gusto, bañada en salsa Buffalo, aros de cebolla empanizados, tocino, mayonesa y queso amarillo.',
    variantes: [{ nombre: 'Único', precio: 68 }],
  },
  {
    categoria: 'Hamburguesas',
    nombre: 'Hamburguesa Mango Habanero',
    descripcion:
      'Carne cocida al gusto, bañada en salsa mango habanero, aros de cebolla empanizados, tocino, mayonesa y queso amarillo.',
    variantes: [{ nombre: 'Único', precio: 68 }],
  },
  {
    categoria: 'Hamburguesas',
    nombre: 'Hamburguesa de Pollo',
    descripcion: 'Pollo tender, queso amarillo, cebolla morada, lechuga, tomate, pepinillos, aderezo ranch.',
    variantes: [{ nombre: 'Único', precio: 75 }],
  },
  {
    categoria: 'Hamburguesas',
    nombre: 'Combo Hamburguesa',
    descripcion: 'Hamburguesa de tu elección + papas fritas + refresco en lata.',
    variantes: [
      { nombre: 'Tradicional', precio: 90 },
      { nombre: 'BBQ', precio: 95 },
      { nombre: 'Buffalo', precio: 95 },
      { nombre: 'Mango Habanero', precio: 95 },
      { nombre: 'Pollo', precio: 105 },
    ],
  },

  // ---- Pizzas ----
  {
    categoria: 'Pizzas',
    nombre: 'Pizza Pepperoni',
    descripcion: 'Masa, queso y pepperoni.',
    variantes: [{ nombre: 'Individual', precio: 75 }],
  },
  {
    categoria: 'Pizzas',
    nombre: 'Pizza Mexicana',
    descripcion: 'Pepperoni, chiles, tocino.',
    variantes: [{ nombre: 'Individual', precio: 75 }],
  },
  {
    categoria: 'Pizzas',
    nombre: 'Pizza Hawaiana',
    descripcion: 'Tocino, piña, cereza.',
    variantes: [{ nombre: 'Individual', precio: 75 }],
  },
  {
    categoria: 'Pizzas',
    nombre: 'Ingrediente Extra para Pizza',
    descripcion: 'Se agrega a cualquier pizza.',
    variantes: [
      { nombre: 'Champiñones', precio: 10 },
      { nombre: 'Salchicha', precio: 10 },
    ],
  },

  // ---- Alitas ----
  {
    categoria: 'Alitas',
    nombre: 'Alitas',
    descripcion: `Acompañadas con baritas de apio, zanahoria y aderezo ranch. ${SALSAS_ALITAS_BONELESS}`,
    variantes: [
      { nombre: '12 piezas (solo alitas)', precio: 130 },
      { nombre: 'Paquete #1 · 8 pz + papas + vegetales + 1 dip', precio: 100 },
      { nombre: 'Paquete #2 · 12 pz + papas + vegetales + 2 dips', precio: 150 },
      { nombre: 'Paquete #3 · 24 pz + papas o aros + vegetales + 3 dips', precio: 300 },
      { nombre: 'Paquete #4 · 36 pz + papas + aros + vegetales + 4 dips', precio: 450 },
    ],
  },

  // ---- Boneless ----
  {
    categoria: 'Boneless',
    nombre: 'Boneless',
    descripcion: `Acompañados con baritas de apio, zanahoria y aderezo ranch. ${SALSAS_ALITAS_BONELESS}`,
    variantes: [
      { nombre: '250 gramos (solo)', precio: 125 },
      { nombre: 'Paquete #1 · 125g + papas + vegetales + 1 dip', precio: 90 },
      { nombre: 'Paquete #2 · 250g + papas + vegetales + 2 dips', precio: 135 },
      { nombre: 'Paquete #3 · 250g + aros de cebolla + vegetales + 2 dips', precio: 145 },
    ],
  },

  // ---- Papas y Entradas ----
  {
    categoria: 'Papas y Entradas',
    nombre: 'Papas a la Francesa',
    descripcion: 'Corte delgado. Incluye 1 ingrediente gratis: cátsup, parmesano, queso amarillo, ranch o tocino.',
    variantes: [{ nombre: 'Único', precio: 46 }],
  },
  {
    categoria: 'Papas y Entradas',
    nombre: 'Papas en Gajo',
    descripcion: 'Papa frita sazonada con aderezo, queso amarillo o parmesano.',
    variantes: [{ nombre: 'Único', precio: 55 }],
  },
  {
    categoria: 'Papas y Entradas',
    nombre: 'Salchi-Papas',
    descripcion: 'Papas a la francesa con trozos de salchicha frita, cátsup, mayonesa y chiles curtidos.',
    variantes: [{ nombre: 'Único', precio: 60 }],
  },
  {
    categoria: 'Papas y Entradas',
    nombre: 'Dedos de Queso',
    descripcion: 'Deditos de queso mozzarella empanizados con ranch o cátsup. Mínimo 3 piezas.',
    variantes: [{ nombre: 'Pieza', precio: 19 }],
  },
  {
    categoria: 'Papas y Entradas',
    nombre: 'Aros de Cebolla',
    descripcion: 'Crujientes aros empanizados con aderezo ranch o cátsup.',
    variantes: [{ nombre: 'Único', precio: 55 }],
  },

  // ---- Snacks y Clamatos ----
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Pepihuates',
    descripcion: 'Cacahuate diferente con costo extra +$5.00.',
    variantes: [
      { nombre: 'Chico', precio: 40 },
      { nombre: 'Mediano', precio: 50 },
    ],
  },
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Picamix',
    descripcion: '',
    variantes: [
      { nombre: 'Chico', precio: 40 },
      { nombre: 'Mediano', precio: 50 },
    ],
  },
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Pichachitos Preparados',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 35 }],
  },
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Papas Locas',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 55 }],
  },
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Miche-Papas',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 70 }],
  },
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Clamato Preparado',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 65 }],
  },
  {
    categoria: 'Snacks y Clamatos',
    nombre: 'Nachos',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 46 }],
  },

  // ---- Tostitos y Elotes ----
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Tostitos Preparados',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 55 }],
  },
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Tostitos con Camarón',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 80 }],
  },
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Tostiti-Elote',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 55 }],
  },
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Esquite',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 30 }],
  },
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Elote Hot',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 50 }],
  },
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Chuchi-Elote',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 60 }],
  },
  {
    categoria: 'Tostitos y Elotes',
    nombre: 'Elote Chorreado',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 70 }],
  },

  // ---- Frutas Locas ----
  {
    categoria: 'Frutas Locas',
    nombre: 'Manzana Loca',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 65 }],
  },
  {
    categoria: 'Frutas Locas',
    nombre: 'Piña Loca',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 100 }],
  },
  {
    categoria: 'Frutas Locas',
    nombre: 'Tornado',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 50 }],
  },
  {
    categoria: 'Frutas Locas',
    nombre: 'Tacos Locos',
    descripcion: '',
    variantes: [{ nombre: '3 piezas', precio: 55 }],
  },
  {
    categoria: 'Frutas Locas',
    nombre: 'Fresas con Crema',
    descripcion: '',
    variantes: [
      { nombre: 'Sencillas', precio: 55 },
      { nombre: 'Chantillí', precio: 65 },
      { nombre: 'Ice Cream (con helado)', precio: 60 },
    ],
  },

  // ---- Crepas y Waffles ----
  {
    categoria: 'Crepas y Waffles',
    nombre: 'Crepa Sencilla',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 55 }],
  },
  {
    categoria: 'Crepas y Waffles',
    nombre: 'Waffle Sencillo',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 58 }],
  },
  {
    categoria: 'Crepas y Waffles',
    nombre: 'Minihotcakes',
    descripcion: '',
    variantes: [{ nombre: '14 piezas', precio: 50 }],
  },
  {
    categoria: 'Crepas y Waffles',
    nombre: 'Miniwaffles',
    descripcion: '',
    variantes: [{ nombre: '2 piezas', precio: 50 }],
  },
  {
    categoria: 'Crepas y Waffles',
    nombre: 'Crepa Especial',
    descripcion: `3 ingredientes + helado. ${TOPPINGS_CREPAS}`,
    variantes: [{ nombre: 'Único', precio: 60 }],
  },
  {
    categoria: 'Crepas y Waffles',
    nombre: 'Waffle Especial',
    descripcion: `3 ingredientes + helado. ${TOPPINGS_CREPAS}`,
    variantes: [{ nombre: 'Único', precio: 68 }],
  },

  // ---- Bebidas Preparadas ----
  {
    categoria: 'Bebidas Preparadas',
    nombre: 'Malteada',
    descripcion: 'Cremosa.',
    variantes: [
      { nombre: 'Fresa', precio: 50 },
      { nombre: 'Vainilla', precio: 50 },
      { nombre: 'Oreo', precio: 50 },
      { nombre: 'Chocolate', precio: 50 },
    ],
  },
  {
    categoria: 'Bebidas Preparadas',
    nombre: 'Smoothie Natural',
    descripcion: '',
    variantes: [
      { nombre: 'Mango', precio: 50 },
      { nombre: 'Fresa', precio: 50 },
      { nombre: 'Piña', precio: 50 },
      { nombre: 'Sandía', precio: 50 },
      { nombre: 'Tamarindo', precio: 50 },
      { nombre: 'Limón', precio: 50 },
      { nombre: 'Picafresa', precio: 50 },
      { nombre: 'Icee Cereza', precio: 50 },
      { nombre: 'Icee Mora Azul', precio: 50 },
    ],
  },
  {
    categoria: 'Bebidas Preparadas',
    nombre: 'Smoothie Cremoso',
    descripcion: '',
    variantes: [
      { nombre: 'Nutella', precio: 55 },
      { nombre: 'Oreo', precio: 55 },
      { nombre: 'Fresa', precio: 55 },
      { nombre: 'Cajeta', precio: 55 },
      { nombre: 'Gansito', precio: 55 },
      { nombre: 'Mazapán', precio: 55 },
      { nombre: 'Zarzamora', precio: 55 },
    ],
  },
  {
    categoria: 'Bebidas Preparadas',
    nombre: 'Café a las Rocas',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 50 }],
  },
  {
    categoria: 'Bebidas Preparadas',
    nombre: 'Frappé',
    descripcion: '',
    variantes: [
      { nombre: 'Regular', precio: 55 },
      { nombre: 'Moka', precio: 55 },
      { nombre: 'Vainilla', precio: 55 },
      { nombre: 'Caramelo', precio: 55 },
    ],
  },

  // ---- Botanas de Sobre ----
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Tostitos Salsa Verde',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Tostitos Flamin Hot',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Cheetos Flamin Hot',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Doritos Nacho',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Ruffles Queso',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Doritos Dinamita',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Sabritas Crujiente',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 20 }],
  },
  {
    categoria: 'Botanas de Sobre',
    nombre: 'Picachitos',
    descripcion: '',
    variantes: [{ nombre: 'Único', precio: 13 }],
  },

  // ---- Bebidas Embotelladas ----
  {
    categoria: 'Bebidas Embotelladas',
    nombre: 'Agua Purificada',
    descripcion: '',
    variantes: [
      { nombre: '500 ml', precio: 15 },
      { nombre: '1 Lt', precio: 20 },
    ],
  },
  {
    categoria: 'Bebidas Embotelladas',
    nombre: 'Agua Mineral',
    descripcion: '',
    variantes: [{ nombre: '600 ml', precio: 25 }],
  },
  {
    categoria: 'Bebidas Embotelladas',
    nombre: 'Coca-Cola',
    descripcion: '',
    variantes: [{ nombre: '600 ml', precio: 28 }],
  },
  {
    categoria: 'Bebidas Embotelladas',
    nombre: 'Refresco',
    descripcion: 'Pepsi, Squirt, Mirinda, etc. — indica el sabor en notas.',
    variantes: [
      { nombre: '600 ml', precio: 26 },
      { nombre: 'Lata/Lote 355-400 ml', precio: 22 },
    ],
  },
  {
    categoria: 'Bebidas Embotelladas',
    nombre: 'Jarritos',
    descripcion: 'Piña, mandarina, etc. — indica el sabor en notas.',
    variantes: [{ nombre: '355 ml', precio: 22 }],
  },
  {
    categoria: 'Bebidas Embotelladas',
    nombre: 'Arizona',
    descripcion: 'Mango, sandía, kiwi-fresa — indica el sabor en notas.',
    variantes: [{ nombre: '591 ml', precio: 28 }],
  },
];

// Aplica el catálogo a la base de datos. Todo ocurre en UNA transacción
// (BEGIN ... COMMIT): ante cualquier error se hace ROLLBACK y la base queda
// exactamente como estaba antes de correr el script.
async function seed() {
  // Conexión exclusiva del pool: necesaria para poder usar transacciones.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // `idsCategorias` recuerda el id de cada categoría por nombre para usarlo
    // al insertar los productos en el paso 5.
    // 1. Categorías sin cambio: aseguran que existan (ya deberían).
    const idsCategorias = {};
    for (const nombre of CATEGORIAS_SIN_CAMBIO) {
      const r = await client.query(
        `INSERT INTO categorias (nombre) VALUES ($1)
         ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
         RETURNING id`,
        [nombre]
      );
      idsCategorias[nombre] = r.rows[0].id;
    }

    // 2. Categorías renombradas: mismo id, nombre nuevo. Los productos viejos
    // que tenían se desactivan más abajo junto con el resto.
    for (const [viejo, nuevo] of Object.entries(CATEGORIAS_RENOMBRADAS)) {
      const r = await client.query(
        `UPDATE categorias SET nombre = $1 WHERE nombre = $2 RETURNING id`,
        [nuevo, viejo]
      );
      if (r.rows.length > 0) {
        idsCategorias[nuevo] = r.rows[0].id;
      } else {
        // Ya se había renombrado en una corrida anterior del script.
        const existente = await client.query('SELECT id FROM categorias WHERE nombre = $1', [nuevo]);
        idsCategorias[nuevo] = existente.rows[0].id;
      }
    }

    // 3. Categorías nuevas.
    for (const nombre of CATEGORIAS_NUEVAS) {
      const r = await client.query(
        `INSERT INTO categorias (nombre) VALUES ($1)
         ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
         RETURNING id`,
        [nombre]
      );
      idsCategorias[nombre] = r.rows[0].id;
    }

    // 4. Desactiva TODOS los productos activos actuales (el menú de prueba
    // original). No se borran: algunas ventas reales ya los referencian.
    await client.query('UPDATE productos SET activo = FALSE WHERE activo = TRUE');

    // 5. Inserta el menú real completo. Se salta cualquier producto que ya
    // exista con ese nombre en esa categoría (para poder re-correr el script
    // sin duplicar si algo falla a la mitad).
    let productosCreados = 0;
    let variantesCreadas = 0;

    for (const producto of PRODUCTOS) {
      const categoriaId = idsCategorias[producto.categoria];
      if (!categoriaId) {
        throw new Error(`Categoría desconocida: ${producto.categoria}`);
      }

      const yaExiste = await client.query(
        'SELECT id FROM productos WHERE categoria_id = $1 AND nombre = $2 AND activo = TRUE',
        [categoriaId, producto.nombre]
      );
      if (yaExiste.rows.length > 0) {
        continue;
      }

      // `precio_base` de productos es solo referencia (la primera variante);
      // el precio que se cobra siempre sale de variantes_producto.
      const precioBase = producto.variantes[0].precio;
      const resultadoProducto = await client.query(
        `INSERT INTO productos (categoria_id, nombre, descripcion, precio_base, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id`,
        [categoriaId, producto.nombre, producto.descripcion || null, precioBase]
      );
      const productoId = resultadoProducto.rows[0].id;
      productosCreados++;

      for (const variante of producto.variantes) {
        await client.query(
          `INSERT INTO variantes_producto (producto_id, nombre, precio) VALUES ($1, $2, $3)`,
          [productoId, variante.nombre, variante.precio]
        );
        variantesCreadas++;
      }
    }

    await client.query('COMMIT');
    console.log(
      `Catálogo real cargado: ${Object.keys(idsCategorias).length} categorías, ${productosCreados} productos nuevos, ${variantesCreadas} variantes.`
    );
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al poblar el catálogo:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

seed();
