// =============================================================================
// utils/validarParametros.js — IDs NUMÉRICOS EN LA URL
// =============================================================================
// Un id no numérico en la URL (ej. /api/ventas/abc/cancelar) llegaba hasta
// Postgres, que lo rechazaba con un error de tipo y la API respondía 500.
// `router.param` corre antes de cualquier ruta que lleve ese parámetro, así que
// una sola llamada por router da un 400 claro en todas ellas.
const PARAMETROS_ID = ['id', 'itemId', 'empleadoId', 'varianteId', 'productoId'];

function validarParametrosId(router) {
  for (const nombre of PARAMETROS_ID) {
    router.param(nombre, (req, res, next, valor) => {
      if (!/^\d{1,9}$/.test(valor)) {
        return res.status(400).json({ error: 'El identificador en la URL debe ser un número.' });
      }
      next();
    });
  }
}

module.exports = { validarParametrosId };
