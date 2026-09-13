require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');

const app = express();

// CORS: solo permite peticiones desde el frontend configurado
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
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
});