// Script de un solo uso para poblar categorías, productos y variantes
// con una muestra representativa del menú real de CHUCHERIAS, para poder
// probar el punto de venta con datos reales en vez de una base vacía.
//
// Uso: node scripts/seed-catalogo.js

require('dotenv').config();
const pool = require('../db');

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ---- Categorías ----
    const categorias = ['Hamburguesas', 'Pizzas', 'Alitas y Boneless', 'Snacks y Botanas', 'Crepas y Waffles', 'Bebidas Preparadas'];
    const idsCategorias = {};

    for (const nombre of categorias) {
      const resultado = await client.query(
        `INSERT INTO categorias (nombre) VALUES ($1)
         ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
         RETURNING id`,
        [nombre]
      );
      idsCategorias[nombre] = resultado.rows[0].id;
    }

    // ---- Productos y variantes ----
    // Cada producto tiene al menos una variante (aunque sea "Único").
    const productos = [
      {
        categoria: 'Hamburguesas',
        nombre: 'Hamburguesa Tradicional',
        descripcion: 'Carne, tocino, queso amarillo, cebolla morada, tomate, lechuga, mayonesa, cátsup y chiles.',
        variantes: [{ nombre: 'Único', precio: 95 }],
      },
      {
        categoria: 'Hamburguesas',
        nombre: 'Hamburguesa BBQ',
        descripcion: 'Con salsa BBQ y aros de cebolla empanizados.',
        variantes: [{ nombre: 'Único', precio: 105 }],
      },
      {
        categoria: 'Pizzas',
        nombre: 'Pizza Pepperoni',
        descripcion: 'Masa, queso, salsa de tomate y pepperoni.',
        variantes: [{ nombre: 'Individual', precio: 89 }],
      },
      {
        categoria: 'Pizzas',
        nombre: 'Pizza Mexicana',
        descripcion: 'Masa, queso, salsa de tomate, tocino y chiles.',
        variantes: [{ nombre: 'Individual', precio: 92 }],
      },
      {
        categoria: 'Alitas y Boneless',
        nombre: 'Alitas',
        descripcion: 'Con la salsa a elección (BBQ, buffalo, mango habanero, etc.), apio, zanahoria y aderezo ranch.',
        variantes: [
          { nombre: '8 piezas', precio: 110 },
          { nombre: '12 piezas', precio: 150 },
          { nombre: '24 piezas', precio: 280 },
        ],
      },
      {
        categoria: 'Alitas y Boneless',
        nombre: 'Boneless',
        descripcion: 'Con la salsa a elección, apio, zanahoria y aderezo ranch.',
        variantes: [
          { nombre: '125 g', precio: 85 },
          { nombre: '250 g', precio: 140 },
        ],
      },
      {
        categoria: 'Snacks y Botanas',
        nombre: 'Papas Locas',
        descripcion: 'Papas preparadas con toppings a elección.',
        variantes: [{ nombre: 'Único', precio: 65 }],
      },
      {
        categoria: 'Snacks y Botanas',
        nombre: 'Tostitos Preparados',
        descripcion: 'Tostitos con frijoles, salsas, queso y toppings.',
        variantes: [{ nombre: 'Único', precio: 60 }],
      },
      {
        categoria: 'Crepas y Waffles',
        nombre: 'Crepa',
        descripcion: 'Con 3 toppings a elección (cajeta, nutella, fresa, plátano, Oreo, etc.).',
        variantes: [{ nombre: 'Único', precio: 55 }],
      },
      {
        categoria: 'Bebidas Preparadas',
        nombre: 'Smoothie',
        descripcion: 'Preparado con fruta y hielo, sabor a elección.',
        variantes: [
          { nombre: '12 oz', precio: 45 },
          { nombre: '16 oz', precio: 55 },
          { nombre: '32 oz', precio: 75 },
        ],
      },
    ];

    for (const producto of productos) {
      const resultadoProducto = await client.query(
        `INSERT INTO productos (categoria_id, nombre, descripcion, precio_base, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id`,
        [idsCategorias[producto.categoria], producto.nombre, producto.descripcion, producto.variantes[0].precio]
      );
      const productoId = resultadoProducto.rows[0].id;

      for (const variante of producto.variantes) {
        await client.query(
          `INSERT INTO variantes_producto (producto_id, nombre, precio) VALUES ($1, $2, $3)`,
          [productoId, variante.nombre, variante.precio]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Catálogo de prueba creado: ${categorias.length} categorías, ${productos.length} productos.`);
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