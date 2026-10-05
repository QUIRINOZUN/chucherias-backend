// =============================================================================
// index.js — PUNTO DE ENTRADA DEL BACKEND (Node.js + Express)
// =============================================================================
// Este archivo arranca el servidor de la API de CHUCHERIAS. Hace cuatro cosas,
// en este orden:
//   1. Carga las variables de entorno del archivo .env (conexión a Neon,
//      JWT_SECRET, PORT, CORS_ORIGIN).
//   2. Configura CORS para que solo los sitios autorizados (el frontend en
//      Vercel y el `ng serve` local) puedan llamar a la API.
//   3. Monta cada módulo de rutas bajo su prefijo /api/...
//   4. Escucha peticiones en el puerto configurado.
//
// Desplegado en Render: cada push a `main` lo reinicia automáticamente.
//
// MAPA DE RUTAS (todas devuelven JSON):
//   /api/auth      → login y datos del usuario en sesión       (routes/auth.js)
//   /api/usuarios  → alta, edición y activación de cuentas     (routes/usuarios.js)
//   /api/categorias, /api/productos → catálogo del menú        (routes/catalogo.js)
//   /api/ventas    → registrar, listar y cancelar ventas       (routes/ventas.js)
//   /api/caja      → resumen del día y cortes de caja          (routes/caja.js)
//   /api/ordenes   → comandas y sus estados (Sprint 2)         (routes/ordenes.js)
//   /api/insumos   → inventario: altas, existencias, entradas  (routes/insumos.js)
//   /api/proveedores → catálogo de proveedores                 (routes/proveedores.js)
//   /api/mermas    → consulta consolidada de mermas             (routes/mermas.js)
//   /api/empleados → personal del negocio (Sprint 3)             (routes/empleados.js)
//   /api/asistencias → entradas, salidas e historial (Sprint 3)  (routes/asistencias.js)
// =============================================================================

// Carga el archivo .env ANTES de leer cualquier process.env.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

// Cada archivo de rutas exporta un Router de Express independiente.
const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');
const catalogoRoutes = require('./routes/catalogo');
const ventasRoutes = require('./routes/ventas');
const cajaRoutes = require('./routes/caja');
const ordenesRoutes = require('./routes/ordenes');
const insumosRoutes = require('./routes/insumos');
const proveedoresRoutes = require('./routes/proveedores');
const mermasRoutes = require('./routes/mermas');
const empleadosRoutes = require('./routes/empleados');
const asistenciasRoutes = require('./routes/asistencias');

const app = express();

// -----------------------------------------------------------------------------
// CORS (Cross-Origin Resource Sharing)
// -----------------------------------------------------------------------------
// El navegador bloquea las llamadas del frontend a la API si el servidor no
// declara explícitamente que ese origen está permitido. La lista sale de la
// variable CORS_ORIGIN del .env, separada por comas. Ejemplo:
//   CORS_ORIGIN=http://localhost:4200,http://localhost:4300,https://mi-app.vercel.app
// Si falta un origen en la lista, el frontend recibe un error de CORS aunque
// la API esté funcionando bien.
const origenesPermitidos = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origen) => origen.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // `!origin` cubre herramientas sin origen (curl, Postman, pruebas de
      // servidor a servidor): se dejan pasar. Un navegador siempre envía origen.
      if (!origin || origenesPermitidos.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      }
    },
  })
);

// Convierte automáticamente el cuerpo JSON de cada petición en req.body.
app.use(express.json());

// -----------------------------------------------------------------------------
// Montaje de rutas
// -----------------------------------------------------------------------------
// Autenticación y usuarios (Sprint 1).
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
// El catálogo se monta en /api a secas porque sus rutas ya incluyen
// /categorias y /productos en su propio archivo.
app.use('/api', catalogoRoutes); // expone /api/categorias y /api/productos
// Punto de venta y caja (Sprint 1).
app.use('/api/ventas', ventasRoutes);
app.use('/api/caja', cajaRoutes);
// Comandas: seguimiento de cada pedido en cocina (Sprint 2).
app.use('/api/ordenes', ordenesRoutes);
// Inventario: insumos, existencias calculadas y proveedores.
app.use('/api/insumos', insumosRoutes);
app.use('/api/proveedores', proveedoresRoutes);
// Consulta consolidada de mermas (de producto y de insumo, en un solo lugar).
app.use('/api/mermas', mermasRoutes);
// Control de personal: empleados y sus asistencias (Sprint 3).
app.use('/api/empleados', empleadosRoutes);
app.use('/api/asistencias', asistenciasRoutes);

// -----------------------------------------------------------------------------
// Rutas de diagnóstico (no requieren sesión)
// -----------------------------------------------------------------------------
// Ruta de prueba: confirma que el servidor está vivo
app.get('/', (req, res) => {
  res.json({ mensaje: 'API de CHUCHERIAS funcionando correctamente' });
});

// Ruta de prueba: confirma que la conexión a Neon funciona.
// Útil para "despertar" la base de datos gratuita antes de la primera venta
// del día (Neon duerme tras 5 minutos de inactividad).
app.get('/api/ping-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ conectado: true, hora_servidor: result.rows[0].now });
  } catch (error) {
    console.error(error);
    res.status(500).json({ conectado: false, error: error.message });
  }
});

// Render asigna el puerto por variable de entorno; en local se usa el 3000.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  console.log(`Orígenes permitidos (CORS): ${origenesPermitidos.join(', ') || '(ninguno configurado)'}`);
});
