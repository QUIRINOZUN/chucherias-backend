// =============================================================================
// scripts/seed-categorias-insumo.js — CATEGORÍAS DE INSUMO (inventario)
// =============================================================================
// Crea el catálogo de categorías de INSUMOS (distinto de `categorias`, que es
// el de productos del menú — dominios separados a propósito) y le asigna a
// cada insumo ya existente su categoría, agrupando por el mismo criterio que
// ya usaban los comentarios de scripts/seed-insumos.js (proteínas, panes,
// lácteos, etc.) — aquí se vuelve un dato real en la base, no un comentario.
//
// Re-corrible: las categorías se crean solo si no existen (por nombre) y a
// cada insumo se le asigna su categoría solo si coincide por nombre exacto.
// Al final reporta cualquier insumo de la base que haya quedado SIN
// categoría (no debería haber ninguno si la base viene de seed-insumos.js
// sin insumos agregados a mano todavía).
//
// Requiere la migración migraciones/2026-09-30_categorias_insumo.sql ya
// corrida (crea la tabla categorias_insumo y la columna insumos.categoria_id).
//
// Uso: node scripts/seed-categorias-insumo.js
// =============================================================================
require('dotenv').config();
const pool = require('../db');

// Mismo orden lógico que seed-insumos.js: de la cocina hacia el mostrador.
const CATEGORIAS = [
  {
    nombre: 'Proteínas',
    insumos: [
      'Carne de res (patty)',
      'Pechuga de pollo empanizada (tender)',
      'Alitas de pollo (crudo)',
      'Pechuga de pollo en trozos (crudo)',
      'Tocino',
      'Salchicha',
      'Camarón cóctel (cocido, pelado)',
      'Dedo de queso mozzarella empanizado (crudo)',
    ],
  },
  {
    nombre: 'Panes, masas y mezclas',
    insumos: [
      'Pan para hamburguesa',
      'Masa de pizza individual',
      'Masa de crepa (preparada)',
      'Waffle (preparado)',
      'Mezcla para hotcakes (preparada)',
      'Mezcla para waffle (preparada)',
      'Harina/empanizador',
    ],
  },
  {
    nombre: 'Lácteos y helado',
    insumos: [
      'Queso amarillo',
      'Queso mozzarella',
      'Queso cotija/parmesano',
      'Crema batida',
      'Crema chantillí',
      'Leche condensada (Lechera)',
      'Leche entera',
      'Mantequilla',
      'Helado de vainilla',
    ],
  },
  {
    nombre: 'Verduras y frutas',
    insumos: [
      'Cebolla morada (fileteada)',
      'Jitomate (rodajas)',
      'Lechuga',
      'Pepinillos',
      'Apio (bastones)',
      'Zanahoria (bastones)',
      'Chile jalapeño (rodajas)',
      'Champiñones (fileteados)',
      'Elote desgranado',
      'Elote en mazorca',
      'Cebolla picada',
      'Cilantro picado',
      'Manzana',
      'Piña (fresca)',
      'Piña en trozos (enlatada)',
      'Fresa',
      'Plátano',
      'Fruta variada (mango, sandía, jícama)',
      'Limón',
      'Papa corte delgado',
      'Papa en gajo',
      'Papa tornado (espiral, cruda)',
    ],
  },
  {
    nombre: 'Salsas y condimentos',
    insumos: [
      'Mayonesa',
      'Salsa cátsup',
      'Salsa para pizza',
      'Pepperoni',
      'Aderezo ranch',
      'Chiles en escabeche',
      'Chile en polvo/piquín',
      'Salsa picante',
      'Chamoy',
      'Sal/sazonador',
      'Salsa clamato/michelada',
      'Clamato (base)',
      'Chiles curtidos',
      'Cereza en almíbar',
      'Salsa BBQ (hamburguesa)',
      'Salsa Buffalo (hamburguesa)',
      'Salsa Mango Habanero (hamburguesa)',
      'Salsa Buffalo (alitas/boneless)',
      'Salsa Mango Habanero (alitas/boneless)',
      'Salsa BBQ Habanero',
      'Salsa Parmesano (alitas/boneless)',
      'Salsa BBQ Clásica',
      'Salsa BBQ Chipotle',
      'Salsa Lemon Pepper',
      'Salsa BBQ Miel',
      'Salsa Buffalo Hot',
      'Queso parmesano (espolvorear)',
    ],
  },
  {
    nombre: 'Empanizados y guarniciones',
    insumos: [
      'Papas a la francesa',
      'Aros de cebolla empanizados',
      'Totopos',
      'Tostitos (bolsa, para preparar)',
    ],
  },
  {
    nombre: 'Dulces, snacks y toppings',
    insumos: [
      'Cacahuate (japonés/salado/enchilado)',
      'Cacahuate japonés',
      'Cacahuate salado',
      'Cacahuate enchilado',
      'Mezcla de dulces/frutas enchiladas',
      'Pichachitos (cacahuate japonés)',
      'Papas fritas de bolsa',
      'Dulce enchilado',
      'Azúcar',
      'Azúcar glass',
      'Miel maple',
      "Hershey's (jarabe de chocolate)",
      'Coco rallado',
      'Almendra',
      'Chispas de chocolate',
      'Nuez',
      'Durazno (en almíbar)',
      'Mermelada de fresa',
      'Mermelada de piña',
      'Queso crema Philadelphia',
      'Chispas de colores',
      'Lunetas',
    ],
  },
  {
    nombre: 'Bebidas base y jarabes',
    insumos: [
      'Café concentrado',
      'Jarabe moka',
      'Jarabe vainilla',
      'Jarabe caramelo',
      'Hielo',
      'Agua o jugo base',
      'Base cremosa (leche + helado)',
      'Jarabe/pulpa de limón',
      'Jarabe de fresa',
      'Jarabe de chocolate',
      'Galleta Oreo molida',
      'Nutella',
      'Cajeta',
      'Mazapán',
      'Mermelada de zarzamora',
      'Pastelito Gansito (relleno)',
      'Jarabe/pulpa de mango',
      'Jarabe/pulpa de piña',
      'Jarabe/pulpa de sandía',
      'Jarabe/pulpa de tamarindo',
      'Jarabe/pulpa de picafresa',
      'Jarabe Icee cereza',
      'Jarabe Icee mora azul',
    ],
  },
  {
    nombre: 'Empaque y bebidas embotelladas',
    insumos: [
      'Tostitos Salsa Verde (sobre)',
      'Tostitos Flamin Hot (sobre)',
      'Cheetos Flamin Hot (sobre)',
      'Doritos Nacho (sobre)',
      'Ruffles Queso (sobre)',
      'Doritos Dinamita (sobre)',
      'Sabritas Crujiente (sobre)',
      'Picachitos (sobre)',
      'Agua Purificada 500 ml (botella)',
      'Agua Purificada 1 Lt (botella)',
      'Agua Mineral 600 ml (botella)',
      'Coca-Cola 600 ml (botella)',
      'Refresco 600 ml (botella)',
      'Refresco lata/lote 355-400 ml',
      'Jarritos 355 ml (botella)',
      'Arizona 591 ml (botella)',
    ],
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let categoriasCreadas = 0;
    let insumosAsignados = 0;
    let insumosNoEncontrados = [];

    for (const { nombre, insumos } of CATEGORIAS) {
      let categoriaId;
      const existente = await client.query('SELECT id FROM categorias_insumo WHERE nombre = $1', [nombre]);
      if (existente.rows.length > 0) {
        categoriaId = existente.rows[0].id;
      } else {
        const creada = await client.query(
          'INSERT INTO categorias_insumo (nombre) VALUES ($1) RETURNING id',
          [nombre]
        );
        categoriaId = creada.rows[0].id;
        categoriasCreadas++;
      }

      for (const nombreInsumo of insumos) {
        const resultado = await client.query(
          'UPDATE insumos SET categoria_id = $1 WHERE nombre = $2 RETURNING id',
          [categoriaId, nombreInsumo]
        );
        if (resultado.rows.length === 0) {
          insumosNoEncontrados.push(nombreInsumo);
        } else {
          insumosAsignados++;
        }
      }
    }

    // Insumos que existen en la base pero no aparecieron en ningún grupo de
    // arriba (ej. dados de alta a mano desde la pantalla de Inventario
    // después de este seed) — se reportan para categorizarlos manualmente.
    const sinCategoria = await client.query('SELECT nombre FROM insumos WHERE categoria_id IS NULL ORDER BY nombre');

    await client.query('COMMIT');

    console.log(`Categorías creadas: ${categoriasCreadas} (de ${CATEGORIAS.length} en total).`);
    console.log(`Insumos categorizados en esta corrida: ${insumosAsignados}.`);
    if (insumosNoEncontrados.length > 0) {
      console.log(`Nombres del mapa que NO coincidieron con ningún insumo (revisar ortografía): ${insumosNoEncontrados.join(', ')}`);
    }
    if (sinCategoria.rows.length > 0) {
      console.log(`Insumos en la base SIN categoría (${sinCategoria.rows.length}): ${sinCategoria.rows.map((r) => r.nombre).join(', ')}`);
    } else {
      console.log('Todos los insumos de la base quedaron categorizados.');
    }
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al poblar categorías de insumo:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

seed();
