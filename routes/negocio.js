// =============================================================================
// routes/negocio.js — DATOS DEL ESTABLECIMIENTO PARA LOS TICKETS (2026-11-10)
// =============================================================================
//   GET    /api/negocio        → cualquier rol con sesión (el POS y Caja lo usan al imprimir)
//   PATCH  /api/negocio        → solo administrador: nombre, titular, RFC, dirección, teléfono,
//                                horario y leyenda
//   POST   /api/negocio/logo   → solo administrador: sube/reemplaza el logotipo (campo "imagen")
//   DELETE /api/negocio/logo   → solo administrador: vuelve al logotipo original
// Viven en config_negocio (una sola fila, id = 1). Si la migración aún no se corrió, GET
// responde los valores de siempre para que imprimir nunca se rompa.
// =============================================================================
const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { subirImagen, borrarImagen } = require('../utils/cloudinary');

const router = express.Router();
router.use(verificarToken);

const POR_DEFECTO = {
  nombre: 'Chucherías Mix',
  titular: 'Reyna Ximena Morales Berumen',
  rfc: '',
  direccion: 'Av. 5 de Mayo #400, Francisco I. Madero, Durango',
  telefono: '677 883 1025',
  horario: 'Martes a domingo, 2:00 pm a 9:30 pm',
  leyenda: 'Ticket de venta. No es comprobante fiscal.',
  logo_url: null,
};

const LIMITES = { nombre: 80, titular: 120, rfc: 20, direccion: 200, telefono: 30, horario: 120, leyenda: 160 };

async function leerNegocio() {
  try {
    const r = await pool.query(
      `SELECT nombre, titular, rfc, direccion, telefono, horario, leyenda, logo_url, logo_public_id
       FROM config_negocio WHERE id = 1`,
    );
    if (!r.rows.length) return { ...POR_DEFECTO, logo_public_id: null };
    const f = r.rows[0];
    const salida = { logo_public_id: f.logo_public_id };
    for (const clave of Object.keys(POR_DEFECTO)) {
      salida[clave] = f[clave] ?? POR_DEFECTO[clave];
    }
    return salida;
  } catch {
    return { ...POR_DEFECTO, logo_public_id: null };
  }
}

// El public_id de Cloudinary es un dato interno: nunca viaja al navegador.
const publico = ({ logo_public_id, ...resto }) => resto;

router.get('/', async (req, res) => {
  res.json(publico(await leerNegocio()));
});

router.patch('/', requiereRol('administrador'), async (req, res) => {
  const cambios = {};
  for (const [campo, max] of Object.entries(LIMITES)) {
    if (req.body[campo] === undefined) continue;
    if (typeof req.body[campo] !== 'string') {
      return res.status(400).json({ error: `"${campo}" debe ser texto.` });
    }
    const valor = req.body[campo].trim();
    if (valor.length > max) {
      return res.status(400).json({ error: `"${campo}" no puede pasar de ${max} caracteres.` });
    }
    cambios[campo] = valor;
  }
  if (cambios.nombre !== undefined && !cambios.nombre) {
    return res.status(400).json({ error: 'El nombre del negocio no puede quedar vacío.' });
  }
  const campos = Object.keys(cambios);
  if (!campos.length) {
    return res.status(400).json({ error: 'No se envió ningún dato para cambiar.' });
  }
  try {
    await pool.query(`INSERT INTO config_negocio (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await pool.query(
      `UPDATE config_negocio SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = 1`,
      campos.map((c) => cambios[c]),
    );
    res.json(publico(await leerNegocio()));
  } catch (error) {
    console.error('Error al guardar los datos del negocio:', error);
    res.status(500).json({ error: 'No se pudieron guardar los datos del negocio.' });
  }
});

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('El archivo debe ser una imagen.')),
});

router.post('/logo', requiereRol('administrador'), (req, res) => {
  uploadLogo.single('imagen')(req, res, async (errorMulter) => {
    if (errorMulter) return res.status(400).json({ error: errorMulter.message });
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "imagen").' });
    try {
      const anterior = (await leerNegocio()).logo_public_id;
      const subida = await subirImagen(req.file.buffer, 'chucherias/marca');
      await pool.query(`INSERT INTO config_negocio (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
      await pool.query(`UPDATE config_negocio SET logo_url = $1, logo_public_id = $2 WHERE id = 1`, [
        subida.secure_url,
        subida.public_id,
      ]);
      if (anterior) {
        await borrarImagen(anterior).catch((e) => console.error('No se pudo quitar el logo anterior:', e.message));
      }
      res.json(publico(await leerNegocio()));
    } catch (error) {
      console.error('Error al subir el logotipo:', error);
      res.status(500).json({ error: 'No se pudo subir el logotipo.' });
    }
  });
});

router.delete('/logo', requiereRol('administrador'), async (req, res) => {
  try {
    const anterior = (await leerNegocio()).logo_public_id;
    await pool.query(`UPDATE config_negocio SET logo_url = NULL, logo_public_id = NULL WHERE id = 1`);
    if (anterior) await borrarImagen(anterior).catch(() => {});
    res.json(publico(await leerNegocio()));
  } catch (error) {
    console.error('Error al quitar el logotipo:', error);
    res.status(500).json({ error: 'No se pudo quitar el logotipo.' });
  }
});

module.exports = router;
