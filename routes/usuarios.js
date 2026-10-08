// =============================================================================
// routes/usuarios.js — GESTIÓN DE CUENTAS DE PERSONAL (Sprint 1, RF-24)
// =============================================================================
// Endpoints (prefijo /api/usuarios), todos exigen sesión:
//   GET    /roles        → catálogo de roles para el formulario  (administrador)
//   GET    /              → lista de usuarios                     (administrador, encargado)
//   POST   /              → crear cuenta                          (administrador)
//   PATCH  /:id          → editar nombre, usuario, rol, contraseña (administrador)
//   PATCH  /:id/activo   → activar / desactivar cuenta           (administrador)
//   DELETE /:id          → eliminar cuenta, SOLO si nunca se usó (administrador)
//
// REGLAS
//   - Solo el administrador crea, edita, desactiva o elimina cuentas.
//   - El camino normal para "retirar" una cuenta sigue siendo desactivarla
//     (activo = FALSE): conserva su historial de ventas, cortes, asistencias,
//     etc. DELETE es la excepción — pensado para una cuenta creada por error
//     o de prueba que nunca llegó a usarse. `usuarios` tiene FK entrantes
//     desde 9 tablas (empleados, asistencias, ventas, cortes_caja, órdenes,
//     movimientos de caja/inventario, mermas) sin ON DELETE CASCADE, así que
//     Postgres rechaza el DELETE solo (error 23503) si la cuenta ya tiene
//     cualquier historial — se traduce aquí a un mensaje claro (409) en vez
//     de dejar pasar el error crudo de la base.
//   - El nombre de usuario es único (409 si ya existe).
//   - Las contraseñas se guardan cifradas con bcrypt; jamás se devuelven.
// =============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');

const router = express.Router();

// Todas las rutas de este archivo requieren estar autenticado.
router.use(verificarToken);

// GET /api/usuarios/roles
// Catálogo de roles disponibles, para el formulario de alta de usuarios.
// Solo el administrador da de alta usuarios, así que solo él lo necesita.
router.get('/roles', requiereRol('administrador'), async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los roles.' });
  }
});

// GET /api/usuarios
// Lista los usuarios del sistema. Visible para administrador y encargado.
// No incluye contrasena_hash. También la usa la pantalla de caja para llenar
// el filtro "Usuario" del historial de cortes.
router.get('/', requiereRol('administrador', 'encargado'), async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.activo, u.fecha_creacion, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       ORDER BY u.nombre`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los usuarios.' });
  }
});

// POST /api/usuarios
// Crea un nuevo usuario. Solo el administrador puede dar de alta cuentas (RF-24).
router.post('/', requiereRol('administrador'), async (req, res) => {
  const { nombre, usuario, contrasena, rol_id } = req.body;

  // Los cuatro campos son obligatorios al crear.
  if (!nombre || !usuario || !contrasena || !rol_id) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    // El nombre de usuario debe ser único: se consulta antes de insertar para
    // dar un mensaje claro (409 Conflict) en vez de un error de la base.
    const yaExiste = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (yaExiste.rows.length > 0) {
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
    }

    // Se cifra la contraseña (10 rondas de bcrypt) antes de guardarla.
    const contrasenaHash = await bcrypt.hash(contrasena, 10);

    // La cuenta nace activa. RETURNING devuelve la fila creada SIN el hash.
    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, usuario, contrasena_hash, rol_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, nombre, usuario, rol_id, activo, fecha_creacion`,
      [nombre, usuario, contrasenaHash, rol_id]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el usuario.' });
  }
});

// PATCH /api/usuarios/:id
// Edita nombre, usuario, contraseña y/o rol de una cuenta existente. Solo el
// administrador (RF-24). La contraseña es opcional: si no se manda, se deja
// la actual sin cambios (así no hay que reescribirla en cada edición).
router.patch('/:id', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { nombre, usuario, contrasena, rol_id } = req.body;

  try {
    // Se carga la cuenta actual: cada campo que no llegue en la petición
    // conserva su valor de hoy (edición parcial).
    const actual = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    const usuarioActual = actual.rows[0];

    // `?.trim() ||` ignora textos vacíos o solo espacios y cae al valor actual.
    const nuevoNombre = nombre?.trim() || usuarioActual.nombre;
    const nuevoUsuario = usuario?.trim() || usuarioActual.usuario;
    const nuevoRolId = rol_id || usuarioActual.rol_id;

    // Solo si el nombre de usuario cambia se comprueba que nadie MÁS lo tenga
    // (`id != $2` excluye a la propia cuenta que se está editando).
    if (nuevoUsuario !== usuarioActual.usuario) {
      const yaExiste = await pool.query(
        'SELECT id FROM usuarios WHERE usuario = $1 AND id != $2',
        [nuevoUsuario, id]
      );
      if (yaExiste.rows.length > 0) {
        return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
      }
    }

    // Por defecto se conserva el hash actual; solo se reemplaza si llegó una
    // contraseña nueva válida (mínimo 6 caracteres).
    let nuevoHash = usuarioActual.contrasena_hash;
    if (contrasena) {
      if (contrasena.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      }
      nuevoHash = await bcrypt.hash(contrasena, 10);
    }

    const resultado = await pool.query(
      `UPDATE usuarios SET nombre = $1, usuario = $2, rol_id = $3, contrasena_hash = $4
       WHERE id = $5
       RETURNING id, nombre, usuario, rol_id, activo, fecha_creacion`,
      [nuevoNombre, nuevoUsuario, nuevoRolId, nuevoHash, id]
    );

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
  }
});

// PATCH /api/usuarios/:id/activo
// Activa o desactiva una cuenta. Solo el administrador (RF-24).
// Una cuenta desactivada no puede iniciar sesión (ver routes/auth.js), pero
// su historial permanece intacto.
router.patch('/:id/activo', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body; // true o false

  try {
    const resultado = await pool.query(
      `UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, usuario, activo`,
      [activo, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
  }
});

// DELETE /api/usuarios/:id
// Elimina una cuenta de verdad — solo funciona si nunca se usó (ver nota de
// diseño al inicio del archivo). Si tiene cualquier historial, Postgres
// rechaza el borrado por sus llaves foráneas y aquí se traduce a un 409 con
// un mensaje que sugiere desactivarla en su lugar.
router.delete('/:id', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;

  // Nadie se elimina a sí mismo — ni siquiera un administrador de prueba sin
  // historial, para no quedarse sin sesión a mitad de la operación.
  if (Number(id) === req.usuario.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }

  try {
    const resultado = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    res.json({ id: resultado.rows[0].id, eliminado: true });
  } catch (error) {
    // 23503 = foreign_key_violation: la cuenta ya tiene historial (ventas,
    // cortes, asistencias, etc.) en alguna de las tablas que la referencian.
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar: esta cuenta ya tiene historial registrado. Desactívala en su lugar.',
      });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el usuario.' });
  }
});

module.exports = router;
