// Sube las fotos del menú (ico_POS/POS_512/, 512×512 PNG) a Cloudinary y las
// enlaza a cada producto real — 51 ilustraciones propias + 12 fotos reales de
// marca para productos que no se podían ilustrar genéricos sin inventar
// (Cheetos, Doritos, Ruffles, Sabritas, Picachitos, aguas/refrescos
// embotellados). Antes de esto `imagen_url`/`imagen_public_id` estaban vacías
// en todo el catálogo real — el POS mostraba un bloque de color de categoría.
//
// Uso: node scripts/seed-imagenes-productos.js
//
// Es RE-CORRIBLE: vuelve a subir y pisa la imagen de cualquier producto del
// mapeo, sin duplicar nada (cada producto solo tiene una imagen_url/
// imagen_public_id, UPDATE simple). No borra la imagen anterior en
// Cloudinary si ya tenía una de antes (a diferencia de
// POST /api/productos/:id/imagen, que sí lo hace) — este script es para la
// carga inicial masiva, no para el reemplazo cotidiano de una sola foto.
//
// ADVERTENCIA: sube archivos reales a la cuenta de Cloudinary y escribe en la
// base de datos REAL (Neon). Un producto del mapeo que no se encuentre por
// nombre se reporta en consola y el script sigue con los demás — no se
// detiene a medias.
//
// Varios nombres del mapeo tienen MÁS DE UNA fila en `productos` (el menú
// viejo se desactivó en vez de borrarse al cargar el catálogo real — ver
// scripts/seed-catalogo.js) — por eso la búsqueda siempre filtra
// `activo = TRUE`: la imagen es para el producto que de verdad se vende hoy,
// nunca para una versión vieja desactivada que comparte el mismo nombre.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { subirImagen } = require('../utils/cloudinary');

const CARPETA_IMAGENES = path.join(
  'C:', 'Users', 'olmaz', 'Desktop', 'RESIDENCIA', 'CHUCHERIAS', 'ico_POS', 'POS_512',
);
const CARPETA_CLOUDINARY = 'chucherias/productos';

// archivo → nombre EXACTO del producto en la tabla `productos`.
const MAPEO = {
  'alitas.png': 'Alitas',
  'arosdecebolla.png': 'Aros de Cebolla',
  'boneless.png': 'Boneless',
  'combo_hamburgesas.png': 'Combo Hamburguesa',
  'dedosdequeso.png': 'Dedos de Queso',
  'hamburgesabbq.png': 'Hamburguesa BBQ',
  'hamburgesabuffalo.png': 'Hamburguesa Buffalo',
  'hamburgesamangohabanero.png': 'Hamburguesa Mango Habanero',
  'hamburguesapollo.png': 'Hamburguesa de Pollo',
  'hamburguesatradicional.png': 'Hamburguesa Tradicional',
  'papasengajos.png': 'Papas en Gajo',
  'papasfrancesa.png': 'Papas a la Francesa',
  'pepihautes.png': 'Pepihuates',
  'pizzapepperoni.png': 'Pizza Pepperoni',
  'pizzamexicana.png': 'Pizza Mexicana',
  'pizzahawaiana.png': 'Pizza Hawaiana',
  'salchi-papas.png': 'Salchi-Papas',
  'caferocas.png': 'Café a las Rocas',
  'chuchielote.png': 'Chuchi-Elote',
  'clamato.png': 'Clamato Preparado',
  'crepa.png': 'Crepa Sencilla',
  'crepaespecial.png': 'Crepa Especial',
  'elotechorreado.png': 'Elote Chorreado',
  'elotehot.png': 'Elote Hot',
  'esquite.png': 'Esquite',
  'frappe.png': 'Frappé',
  'fresasconcrema.png': 'Fresas con Crema',
  'malteada.png': 'Malteada',
  'manzanaloca.png': 'Manzana Loca',
  'michepapas.png': 'Miche-Papas',
  'minihotcakes.png': 'Minihotcakes',
  'miniwaffles.png': 'Miniwaffles',
  'nachos.png': 'Nachos',
  'papaslocas.png': 'Papas Locas',
  'picamix.png': 'Picamix',
  'pichachitos.png': 'Pichachitos Preparados',
  'pinaloca.png': 'Piña Loca',
  'smoothiecremoso.png': 'Smoothie Cremoso',
  'smoothienatural.png': 'Smoothie Natural',
  'tacoslocos.png': 'Tacos Locos',
  'tornado.png': 'Tornado',
  'tostitielote.png': 'Tostiti-Elote',
  'tostitoscamaron.png': 'Tostitos con Camarón',
  'tostitospreparados.png': 'Tostitos Preparados',
  'waffle.png': 'Waffle Sencillo',
  'waffleespecial.png': 'Waffle Especial',
  'tostitossalsaverde.png': 'Tostitos Salsa Verde',
  'tostitosflaminhot.png': 'Tostitos Flamin Hot',
  'cheetosflaminhot.png': 'Cheetos Flamin Hot',
  'doritosnacho.png': 'Doritos Nacho',
  'rufflesqueso.png': 'Ruffles Queso',
  'doritosdinamita.png': 'Doritos Dinamita',
  'sabritascrujiente.png': 'Sabritas Crujiente',
  'picachitos.png': 'Picachitos',
  'aguapurificada.png': 'Agua Purificada',
  'aguamineral.png': 'Agua Mineral',
  'cocacola.png': 'Coca-Cola',
  'refresco.png': 'Refresco',
  'jarritos.png': 'Jarritos',
  'arizona.png': 'Arizona',
};

// Sube UNA imagen y actualiza su producto; no lanza, devuelve
// { ok, archivo, nombre, motivo? } para que el resumen final no dependa de
// try/catch repartido por todos lados.
async function procesarUno(archivo, nombreProducto) {
  const rutaArchivo = path.join(CARPETA_IMAGENES, archivo);
  if (!fs.existsSync(rutaArchivo)) {
    return { ok: false, archivo, nombre: nombreProducto, motivo: 'archivo no encontrado en disco' };
  }

  const productoResultado = await pool.query(
    'SELECT id FROM productos WHERE nombre = $1 AND activo = TRUE',
    [nombreProducto],
  );
  if (productoResultado.rows.length === 0) {
    return { ok: false, archivo, nombre: nombreProducto, motivo: 'producto no encontrado (activo)' };
  }
  if (productoResultado.rows.length > 1) {
    return {
      ok: false,
      archivo,
      nombre: nombreProducto,
      motivo: `${productoResultado.rows.length} productos activos con ese nombre — ambiguo, revisar a mano`,
    };
  }
  const productoId = productoResultado.rows[0].id;

  const buffer = fs.readFileSync(rutaArchivo);
  const subida = await subirImagen(buffer, CARPETA_CLOUDINARY);

  await pool.query('UPDATE productos SET imagen_url = $1, imagen_public_id = $2 WHERE id = $3', [
    subida.secure_url,
    subida.public_id,
    productoId,
  ]);

  return { ok: true, archivo, nombre: nombreProducto, productoId, url: subida.secure_url };
}

async function main() {
  const entradas = Object.entries(MAPEO);
  console.log(`Subiendo ${entradas.length} imágenes...\n`);

  const exitosos = [];
  const fallidos = [];

  for (const [archivo, nombreProducto] of entradas) {
    try {
      const resultado = await procesarUno(archivo, nombreProducto);
      if (resultado.ok) {
        exitosos.push(resultado);
        console.log(`OK   ${archivo} → "${resultado.nombre}" (id ${resultado.productoId})`);
      } else {
        fallidos.push(resultado);
        console.log(`FALLO ${archivo} → "${resultado.nombre}": ${resultado.motivo}`);
      }
    } catch (error) {
      fallidos.push({ archivo, nombre: nombreProducto, motivo: error.message || String(error) });
      console.log(`FALLO ${archivo} → "${nombreProducto}": ${error.message || error}`);
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Subidos correctamente: ${exitosos.length}/${entradas.length}`);
  if (fallidos.length > 0) {
    console.log(`Fallaron: ${fallidos.length}`);
    for (const f of fallidos) {
      console.log(`  - ${f.archivo} ("${f.nombre}"): ${f.motivo}`);
    }
  }

  await pool.end();
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
