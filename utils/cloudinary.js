// =============================================================================
// utils/cloudinary.js — CONFIGURACIÓN DE CLOUDINARY (2026-10-09)
// =============================================================================
// Un solo lugar que configura el SDK con las credenciales de la cuenta
// (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET en .env, nunca en el código ni
// en git). Lo usa routes/catalogo.js para subir/borrar la foto de un
// producto. Si las credenciales no están configuradas, el SDK simplemente
// fallará al primer intento de subida con un error claro del propio
// Cloudinary — no se valida aquí a propósito, para no duplicar el mensaje.
// =============================================================================
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Sube un buffer (archivo recibido en memoria vía multer) a Cloudinary y
// devuelve { secure_url, public_id }. Se usa un stream en vez de guardar un
// archivo temporal en disco: más simple, y Render/Vercel no garantizan
// almacenamiento persistente en disco de todos modos.
function subirImagen(buffer, carpeta) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: carpeta }, (error, resultado) => {
      if (error) {
        return reject(error);
      }
      resolve(resultado);
    });
    stream.end(buffer);
  });
}

// Borra una imagen por su public_id. Se usa "mejor esfuerzo" (quien la llama
// decide si ignora el error) — nunca debe tumbar el flujo principal de
// reemplazar o quitar una foto solo porque el borrado de la anterior falló.
function borrarImagen(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

module.exports = { cloudinary, subirImagen, borrarImagen };
