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
//
// 2026-10-11: "los usuarios son empleados" (decisión del usuario) — toda
// cuenta que NO sea administrador se asume ligada a un empleado real (para
// que aparezca en Asistencias sin el paso manual de ir a Empleados y ligarla
// a mano, que ya había causado confusión antes — ver CLAUDE.md). El
// administrador sigue sin empleado (no lleva asistencia, mismo criterio de
// siempre). El repartidor (sin cuenta de acceso) sigue dándose de alta
// directo desde Asistencias → Empleados, sin usuario_id — esto NO cambia.
//   - POST   /  crea el empleado ligado junto con la cuenta, en una
//     transacción (si el empleado falla, la cuenta tampoco se crea).
//   - PATCH  /:id  sincroniza el nombre al empleado ligado; si el rol pasa
//     A administrador desactiva su empleado (ya no lleva asistencia, sin
//     perder su historial); si el rol pasa DE administrador a otro rol y no
//     tenía empleado, se le crea uno (o se reactiva el que ya tenía).
//   - PATCH  /:id/activo  espeja el mismo activo/inactivo en el empleado
//     ligado — una cuenta desactivada no debe seguir viéndose "activa" en
//     Asistencias.
//   - DELETE /:id  intenta borrar también su empleado ligado (dentro de la
//     misma transacción) — si ese empleado YA tiene historial de asistencia
//     propio (asistencias/horarios/excepciones), la operación completa se
//     rechaza con el mismo 409 de siempre, igual que si la cuenta tuviera
//     historial directo.
// =============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verificarToken, requiereRol } = require('../middleware/auth');
const { registrarAccion } = require('../utils/bitacora');
const { fechaHoyNegocio } = require('../utils/fecha');

// Puesto por default al auto-crear el empleado de una cuenta nueva — el
// administrador/encargado lo puede editar después desde Asistencias →
// Empleados si hace falta algo más específico.
const PUESTO_POR_ROL = {
  encargado: 'Encargado',
  cajero: 'Cajero',
  auxiliar: 'Auxiliar de cocina',
};

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
       ORDER BY u.nombre`,
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los usuarios.' });
  }
});

// POST /api/usuarios
// Crea un nuevo usuario. Solo el administrador puede dar de alta cuentas (RF-24).
// Si el rol NO es administrador, se crea también su empleado ligado (ver nota
// "los usuarios son empleados" al inicio del archivo), en la misma transacción.
router.post('/', requiereRol('administrador'), async (req, res) => {
  const { nombre, usuario, contrasena, rol_id } = req.body;

  // Los cuatro campos son obligatorios al crear.
  if (!nombre || !usuario || !contrasena || !rol_id) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El nombre de usuario debe ser único: se consulta antes de insertar para
    // dar un mensaje claro (409 Conflict) en vez de un error de la base.
    const yaExiste = await client.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (yaExiste.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
    }

    const rolFila = await client.query('SELECT nombre FROM roles WHERE id = $1', [rol_id]);
    if (rolFila.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El rol indicado no existe.' });
    }
    const nombreRol = rolFila.rows[0].nombre;

    // Se cifra la contraseña (10 rondas de bcrypt) antes de guardarla.
    const contrasenaHash = await bcrypt.hash(contrasena, 10);

    // La cuenta nace activa. RETURNING devuelve la fila creada SIN el hash.
    const resultado = await client.query(
      `INSERT INTO usuarios (nombre, usuario, contrasena_hash, rol_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, nombre, usuario, rol_id, activo, fecha_creacion`,
      [nombre, usuario, contrasenaHash, rol_id],
    );
    const nuevoUsuario = resultado.rows[0];

    // El administrador no lleva asistencia — cualquier otro rol sí, así que
    // se le crea su empleado ligado de una vez (sin esto, "no veo
    // asistencias" volvería a pasar hasta que alguien lo ligue a mano).
    if (nombreRol !== 'administrador') {
      await client.query(
        `INSERT INTO empleados (nombre, puesto, fecha_ingreso, usuario_id, activo)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [nombre, PUESTO_POR_ROL[nombreRol] || nombreRol, fechaHoyNegocio(), nuevoUsuario.id],
      );
    }

    await client.query('COMMIT');
    res.status(201).json(nuevoUsuario);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al crear el usuario.' });
  } finally {
    client.release();
  }
});

// PATCH /api/usuarios/:id
// Edita nombre, usuario, contraseña y/o rol de una cuenta existente. Solo el
// administrador (RF-24). La contraseña es opcional: si no se manda, se deja
// la actual sin cambios (así no hay que reescribirla en cada edición).
//
// Sincroniza el empleado ligado (ver nota "los usuarios son empleados"):
// el nombre siempre se refleja; si el rol cambia DE/A administrador, el
// empleado se desactiva o se crea/reactiva según corresponda.
router.patch('/:id', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { nombre, usuario, contrasena, rol_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Se carga la cuenta actual: cada campo que no llegue en la petición
    // conserva su valor de hoy (edición parcial).
    const actual = await client.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
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
      const yaExiste = await client.query('SELECT id FROM usuarios WHERE usuario = $1 AND id != $2', [
        nuevoUsuario,
        id,
      ]);
      if (yaExiste.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
      }
    }

    // Por defecto se conserva el hash actual; solo se reemplaza si llegó una
    // contraseña nueva válida (mínimo 6 caracteres).
    let nuevoHash = usuarioActual.contrasena_hash;
    if (contrasena) {
      if (contrasena.length < 6) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      }
      nuevoHash = await bcrypt.hash(contrasena, 10);
    }

    const resultado = await client.query(
      `UPDATE usuarios SET nombre = $1, usuario = $2, rol_id = $3, contrasena_hash = $4
       WHERE id = $5
       RETURNING id, nombre, usuario, rol_id, activo, fecha_creacion`,
      [nuevoNombre, nuevoUsuario, nuevoRolId, nuevoHash, id],
    );
    const usuarioActualizado = resultado.rows[0];

    // Sincroniza con el empleado ligado (si existe) o resuelve el cambio de
    // rol de/hacia administrador — ver nota del encabezado del archivo.
    if (nuevoRolId !== usuarioActual.rol_id) {
      const [rolNuevoFila, rolViejoFila] = await Promise.all([
        client.query('SELECT nombre FROM roles WHERE id = $1', [nuevoRolId]),
        client.query('SELECT nombre FROM roles WHERE id = $1', [usuarioActual.rol_id]),
      ]);
      const nombreRolNuevo = rolNuevoFila.rows[0]?.nombre;
      const nombreRolViejo = rolViejoFila.rows[0]?.nombre;
      const empleadoLigado = await client.query('SELECT id, activo FROM empleados WHERE usuario_id = $1', [id]);

      if (nombreRolNuevo === 'administrador' && empleadoLigado.rows.length > 0) {
        // Ahora es administrador: ya no lleva asistencia. Se desactiva su
        // empleado sin perder el historial (nunca se borra, ver PATCH /activo).
        await client.query('UPDATE empleados SET activo = FALSE WHERE id = $1', [empleadoLigado.rows[0].id]);
      } else if (nombreRolViejo === 'administrador' && nombreRolNuevo !== 'administrador') {
        if (empleadoLigado.rows.length > 0) {
          // Ya tenía un empleado (vínculo manual previo, poco común) — se
          // reactiva en vez de crear uno duplicado.
          await client.query('UPDATE empleados SET activo = TRUE WHERE id = $1', [empleadoLigado.rows[0].id]);
        } else {
          await client.query(
            `INSERT INTO empleados (nombre, puesto, fecha_ingreso, usuario_id, activo)
             VALUES ($1, $2, $3, $4, TRUE)`,
            [nuevoNombre, PUESTO_POR_ROL[nombreRolNuevo] || nombreRolNuevo, fechaHoyNegocio(), id],
          );
        }
      }
    }

    // El nombre siempre se refleja en el empleado ligado (si tiene uno),
    // para que Asistencias nunca muestre un nombre viejo tras un rename.
    if (nuevoNombre !== usuarioActual.nombre) {
      await client.query('UPDATE empleados SET nombre = $1 WHERE usuario_id = $2', [nuevoNombre, id]);
    }

    await client.query('COMMIT');
    res.json(usuarioActualizado);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
  } finally {
    client.release();
  }
});

// PATCH /api/usuarios/:id/activo
// Activa o desactiva una cuenta. Solo el administrador (RF-24).
// Una cuenta desactivada no puede iniciar sesión (ver routes/auth.js), pero
// su historial permanece intacto. Se espeja el mismo activo/inactivo en el
// empleado ligado (si tiene uno) — una cuenta desactivada no debe seguir
// viéndose "activa" en Asistencias.
router.patch('/:id/activo', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body; // true o false

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resultado = await client.query(
      `UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, usuario, activo`,
      [activo, id],
    );

    if (resultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    await client.query('UPDATE empleados SET activo = $1 WHERE usuario_id = $2', [activo, id]);

    await client.query('COMMIT');
    res.json(resultado.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
  } finally {
    client.release();
  }
});

// DELETE /api/usuarios/:id
// Elimina una cuenta de verdad — solo funciona si nunca se usó (ver nota de
// diseño al inicio del archivo). Si tiene cualquier historial, Postgres
// rechaza el borrado por sus llaves foráneas y aquí se traduce a un 409 con
// un mensaje que sugiere desactivarla en su lugar.
//
// Ahora que toda cuenta no-administrador nace con un empleado ligado, borrar
// SOLO la cuenta ya no basta: el empleado seguiría ahí (huérfano) o, peor,
// su FK (empleados.usuario_id) bloquearía el DELETE con un 409 aunque la
// cuenta nunca se haya usado de verdad. Por eso se borra el empleado ligado
// PRIMERO, en la misma transacción — si ESE empleado ya tiene su propio
// historial (asistencias/horarios/excepciones), la operación completa se
// rechaza igual que si la cuenta tuviera historial directo.
router.delete('/:id', requiereRol('administrador'), async (req, res) => {
  const { id } = req.params;

  // Nadie se elimina a sí mismo — ni siquiera un administrador de prueba sin
  // historial, para no quedarse sin sesión a mitad de la operación.
  if (Number(id) === req.usuario.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empleadoLigado = await client.query('SELECT id FROM empleados WHERE usuario_id = $1', [id]);
    if (empleadoLigado.rows.length > 0) {
      await client.query('DELETE FROM empleados WHERE id = $1', [empleadoLigado.rows[0].id]);
    }

    const resultado = await client.query('DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre, usuario', [id]);
    if (resultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    await client.query('COMMIT');

    registrarAccion({
      usuarioId: req.usuario.id,
      usuarioNombre: req.usuario.nombre,
      accion: 'eliminar_usuario',
      detalle: `${resultado.rows[0].nombre} (@${resultado.rows[0].usuario}).`,
    });

    res.json({ id: resultado.rows[0].id, eliminado: true });
  } catch (error) {
    await client.query('ROLLBACK');
    // 23503 = foreign_key_violation: la cuenta (o su empleado ligado) ya
    // tiene historial (ventas, cortes, asistencias, etc.) en alguna de las
    // tablas que la referencian.
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar: esta cuenta ya tiene historial registrado. Desactívala en su lugar.',
      });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar el usuario.' });
  } finally {
    client.release();
  }
});

module.exports = router;
