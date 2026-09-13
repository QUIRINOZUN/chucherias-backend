// Script de un solo uso para crear usuarios directamente desde la terminal,
// sin necesidad de tener ya un usuario administrador dentro del sistema
// (es decir, sirve para crear el PRIMER administrador).
//
// Uso:
//   node scripts/crear-usuario.js "Nombre Completo" nombre_usuario contraseña rol
//
// Ejemplo:
//   node scripts/crear-usuario.js "Ximena Pérez" ximena.admin miContrasena123 administrador
//
// Roles válidos: administrador, encargado, cajero, auxiliar

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db');

async function crearUsuario() {
  const [nombre, usuario, contrasena, rolNombre] = process.argv.slice(2);

  if (!nombre || !usuario || !contrasena || !rolNombre) {
    console.log('Uso: node scripts/crear-usuario.js "Nombre Completo" usuario contraseña rol');
    console.log('Roles válidos: administrador, encargado, cajero, auxiliar');
    process.exit(1);
  }

  try {
    // Busca el id del rol por su nombre
    const rolResultado = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);

    if (rolResultado.rows.length === 0) {
      console.error(`El rol "${rolNombre}" no existe. Roles válidos: administrador, encargado, cajero, auxiliar`);
      process.exit(1);
    }

    const rolId = rolResultado.rows[0].id;

    // Verifica que el nombre de usuario no exista ya
    const existe = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (existe.rows.length > 0) {
      console.error(`Ya existe un usuario con el nombre "${usuario}".`);
      process.exit(1);
    }

    const contrasenaHash = await bcrypt.hash(contrasena, 10);

    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, usuario, contrasena_hash, rol_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, nombre, usuario`,
      [nombre, usuario, contrasenaHash, rolId]
    );

    console.log('Usuario creado correctamente:');
    console.log(resultado.rows[0]);
    process.exit(0);
  } catch (error) {
    console.error('Error al crear el usuario:', error.message);
    process.exit(1);
  }
}

crearUsuario();