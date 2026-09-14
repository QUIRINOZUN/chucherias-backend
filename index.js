require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');

const app = express();

// CORS: permite una LISTA de orígenes (desarrollo local + producción en Vercel),
// en vez de uno solo. Se definen separados por coma en la variable de entorno CORS_ORIGIN.
// Ejemplo de valor en Render: http://localhost:4200,https://chucherias-frontend.vercel.app
const origenesPermitidos = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origen) => origen.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite peticiones sin "origin" (como Postman o curl) y las que sí
      // vengan en la lista de orígenes permitidos.
      if (!origin || origenesPermitidos.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      }
    },
  })
);

app.use(express.json());

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);

// Ruta de prueba: confirma que el servidor está vivo
app.get('/', (req, res) => {
  res.json({ mensaje: 'API de CHUCHERIAS funcionando correctamente' });
});

// Ruta de prueba: confirma que la conexión a Neon funciona
app.get('/api/ping-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ conectado: true, hora_servidor: result.rows[0].now });
  } catch (error) {
    console.error(error);
    res.status(500).json({ conectado: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  console.log(`Orígenes permitidos (CORS): ${origenesPermitidos.join(', ') || '(ninguno configurado)'}`);
});