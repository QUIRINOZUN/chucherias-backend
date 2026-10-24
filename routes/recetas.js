// =============================================================================
// routes/recetas.js — RECETARIO: INSUMOS QUE LLEVA CADA VARIANTE
// =============================================================================
// Una receta es la lista de insumos (con cantidad) que se descuenta del
// inventario cuando se vende una variante — la consume utils/inventarioOrden.js
// al avanzar una comanda a 'preparando'. Antes solo existía como datos
// cargados a mano con scripts/seed-recetas.js; esta es la primera API para
// leerla y editarla desde la app. Solo administrador/encargado (igual que
// insumos.js: gestión de negocio, no operación de mostrador).
//
// MODELO: 1 receta por VARIANTE (recetas.variante_id es UNIQUE, no hay una
// receta por producto) — un producto con varias variantes (tamaños, combos)
// necesita una fila de receta en cada una, aunque el contenido se repita casi
// igual. Una variante sin fila en `recetas` es un estado válido: "todavía no
// se le captura receta" (no descuenta nada al venderse, no es un error).
//
// Endpoints (prefijo /api/recetas):
//   GET /                      → todas las variantes activas con si ya
//                                 tienen receta y cuántos insumos/pasos lleva.
//   GET /variante/:varianteId  → la receta de una variante (lista vacía si
//                                 todavía no tiene).
//   PUT /variante/:varianteId  → reemplaza TODA la receta de una variante de
//                                 una sola vez (mismo patrón que
//                                 routes/horarios.js): crea la fila en
//                                 `recetas` si no existía, borra sus
//                                 receta_insumos y vuelve a insertar solo los
//                                 recibidos.
//   GET /variante/:varianteId/tutorial → los pasos de elaboración de una
//                                 variante, en orden (lista vacía si todavía
//                                 no tiene). Registrada ANTES del
//                                 requiereRol de abajo, a propósito: la
//                                 consume el tablero de Comandas (botón
//                                 "Tutorial"), que ve cualquier rol
//                                 operativo (cajero/auxiliar incluidos), no
//                                 solo administrador/encargado — leer el
//                                 tutorial no es información sensible, es
//                                 justo lo que necesita cocina.
//   PUT /variante/:varianteId/tutorial → reemplaza TODO el tutorial de una
//                                 variante de una sola vez (mismo patrón de
//                                 reemplazo-completo que el PUT de insumos);
//                                 esta SÍ queda detrás de administrador/
//                                 encargado — editar el recetario sigue
//                                 siendo gestión, no operación de cocina.
//   GET /variante/:varianteId/imagen → foto de referencia "así debe quedar"
//                                 (null si no tiene). ABIERTA igual que
//                                 GET .../tutorial — es para quien prepara
//                                 el platillo, no información de gestión.
//   POST/DELETE /variante/:varianteId/imagen → subir/quitar la foto de
//                                 referencia (multipart/form-data, campo
//                                 "imagen"); administrador/encargado, mismo
//                                 patrón que POST /productos/:id/imagen en
//                                 catalogo.js (Cloudinary, multer en
//                                 memoria, borra la anterior al reemplazar).
//
// La unidad de cada línea de insumo SIEMPRE es la unidad base del insumo (la
// misma de insumos.unidad_medida) — inventarioOrden.js nunca convierte
// unidades al descontar, así que esta ruta no deja elegir una distinta a la
// del insumo.
// =============================================================================
const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { verificarToken, requiereRol } = require("../middleware/auth");
const { subirImagen, borrarImagen } = require("../utils/cloudinary");

const router = express.Router();

router.use(verificarToken);

// Mismo límite/criterio que catalogo.js: memoria (no disco, Render no lo
// garantiza), 5 MB de sobra para una foto ya comprimida desde un celular.
const uploadImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("El archivo debe ser una imagen."));
    }
    cb(null, true);
  },
});

// GET /api/recetas/variante/:varianteId/imagen — ANTES del requiereRol de
// abajo, igual que el tutorial: cualquier rol autenticado la puede
// consultar (es para quien prepara el platillo, no información de gestión).
router.get("/variante/:varianteId/imagen", async (req, res) => {
  const { varianteId } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT r.imagen_url FROM recetas r WHERE r.variante_id = $1`,
      [varianteId],
    );
    res.json({ imagen_url: resultado.rows[0]?.imagen_url ?? null });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Error al obtener la imagen de referencia." });
  }
});

// GET /api/recetas/variante/:varianteId/tutorial — ANTES del requiereRol de
// abajo: cualquier rol autenticado puede consultar el tutorial (lo usa
// Comandas, que ve todo el personal operativo). Editar (PUT) sigue
// restringido a administrador/encargado, más abajo en el archivo.
router.get("/variante/:varianteId/tutorial", async (req, res) => {
  const { varianteId } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT rp.id, rp.numero_paso, rp.descripcion
       FROM recetas r
       JOIN receta_pasos rp ON rp.receta_id = r.id
       WHERE r.variante_id = $1
       ORDER BY rp.numero_paso`,
      [varianteId],
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener el tutorial." });
  }
});

router.use(requiereRol("administrador", "encargado"));

// GET /api/recetas
router.get("/", async (req, res) => {
  try {
    // DISTINCT en ambos COUNT: unir receta_insumos Y receta_pasos en la misma
    // consulta multiplica filas (cada insumo × cada paso), así que sin
    // DISTINCT el conteo saldría inflado.
    const resultado = await pool.query(
      `SELECT v.id AS variante_id, v.nombre AS variante_nombre, v.precio,
              p.id AS producto_id, p.nombre AS producto_nombre,
              p.requiere_preparacion,
              c.nombre AS categoria,
              r.id AS receta_id, r.imagen_url, r.fecha_edicion,
              ue.nombre AS editado_por_nombre,
              COUNT(DISTINCT ri.id) AS total_insumos,
              COUNT(DISTINCT rp.id) AS total_pasos
       FROM variantes_producto v
       JOIN productos p ON p.id = v.producto_id
       JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN recetas r ON r.variante_id = v.id
       LEFT JOIN usuarios ue ON ue.id = r.editado_por
       LEFT JOIN receta_insumos ri ON ri.receta_id = r.id
       LEFT JOIN receta_pasos rp ON rp.receta_id = r.id
       WHERE p.activo = TRUE
       GROUP BY v.id, v.nombre, v.precio, p.id, p.nombre, p.requiere_preparacion,
                c.nombre, r.id, r.fecha_edicion, ue.nombre
       ORDER BY c.nombre, p.nombre, v.precio`,
    );

    const variantes = resultado.rows.map((fila) => ({
      variante_id: fila.variante_id,
      variante_nombre: fila.variante_nombre,
      precio: Number(fila.precio),
      producto_id: fila.producto_id,
      producto_nombre: fila.producto_nombre,
      // 2026-10-22: separa en Recetario los platillos que de verdad
      // necesitan receta (se preparan en cocina) de los que no (bebidas
      // embotelladas, botanas de bolsa) — misma bandera que ya decide si
      // la orden pasa por el tablero de Comandas (ver catalogo.js).
      requiere_preparacion: fila.requiere_preparacion,
      categoria: fila.categoria,
      tiene_receta: fila.receta_id !== null,
      total_insumos: Number(fila.total_insumos),
      tiene_tutorial: Number(fila.total_pasos) > 0,
      total_pasos: Number(fila.total_pasos),
      tiene_imagen_referencia: !!fila.imagen_url,
      // RNF-02: quién modificó esta receta (insumos o tutorial) por última
      // vez, y cuándo — null si nunca se ha editado desde que esto se
      // agregó, o si la variante todavía no tiene receta capturada.
      editado_por_nombre: fila.editado_por_nombre,
      fecha_edicion: fila.fecha_edicion,
    }));

    res.json(variantes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener las variantes." });
  }
});

// GET /api/recetas/variante/:varianteId
router.get("/variante/:varianteId", async (req, res) => {
  const { varianteId } = req.params;
  try {
    const variante = await pool.query(
      "SELECT id FROM variantes_producto WHERE id = $1",
      [varianteId],
    );
    if (variante.rows.length === 0) {
      return res.status(404).json({ error: "Variante no encontrada." });
    }

    const resultado = await pool.query(
      `SELECT ri.id, ri.insumo_id, i.nombre AS insumo_nombre,
              i.unidad_medida AS insumo_unidad_base, ri.cantidad, ri.unidad_medida
       FROM recetas r
       JOIN receta_insumos ri ON ri.receta_id = r.id
       JOIN insumos i ON i.id = ri.insumo_id
       WHERE r.variante_id = $1
       ORDER BY i.nombre`,
      [varianteId],
    );

    res.json(
      resultado.rows.map((fila) => ({
        ...fila,
        cantidad: Number(fila.cantidad),
      })),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener la receta." });
  }
});

// PUT /api/recetas/variante/:varianteId
router.put("/variante/:varianteId", async (req, res) => {
  const { varianteId } = req.params;
  const { insumos } = req.body;

  if (!Array.isArray(insumos)) {
    return res.status(400).json({ error: '"insumos" debe ser una lista.' });
  }
  for (const linea of insumos) {
    const cantidad = Number(linea.cantidad);
    if (!linea.insumo_id || !Number.isFinite(cantidad) || cantidad <= 0) {
      return res
        .status(400)
        .json({ error: "Cada insumo necesita una cantidad mayor a cero." });
    }
    if (!linea.unidad_medida || !String(linea.unidad_medida).trim()) {
      return res
        .status(400)
        .json({ error: "Falta la unidad de medida de un insumo." });
    }
  }
  const idsInsumo = insumos.map((linea) => linea.insumo_id);
  if (new Set(idsInsumo).size !== idsInsumo.length) {
    return res
      .status(400)
      .json({ error: "No puedes repetir el mismo insumo dos veces." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const variante = await client.query(
      "SELECT id FROM variantes_producto WHERE id = $1",
      [varianteId],
    );
    if (variante.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Variante no encontrada." });
    }

    if (idsInsumo.length > 0) {
      const validos = await client.query(
        "SELECT id FROM insumos WHERE id = ANY($1::int[])",
        [idsInsumo],
      );
      if (validos.rows.length !== idsInsumo.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Alguno de los insumos no existe." });
      }
    }

    let receta = await client.query(
      "SELECT id FROM recetas WHERE variante_id = $1",
      [varianteId],
    );
    let recetaId;
    if (receta.rows.length === 0) {
      const nueva = await client.query(
        `INSERT INTO recetas (variante_id, editado_por, fecha_edicion)
         VALUES ($1, $2, NOW()) RETURNING id`,
        [varianteId, req.usuario.id],
      );
      recetaId = nueva.rows[0].id;
    } else {
      recetaId = receta.rows[0].id;
      // RNF-02: "modificación de recetas" debe quedar registrada con quién
      // y cuándo.
      await client.query(
        "UPDATE recetas SET editado_por = $1, fecha_edicion = NOW() WHERE id = $2",
        [req.usuario.id, recetaId],
      );
    }

    await client.query("DELETE FROM receta_insumos WHERE receta_id = $1", [
      recetaId,
    ]);
    for (const linea of insumos) {
      await client.query(
        `INSERT INTO receta_insumos (receta_id, insumo_id, cantidad, unidad_medida)
         VALUES ($1, $2, $3, $4)`,
        [
          recetaId,
          linea.insumo_id,
          Number(linea.cantidad),
          String(linea.unidad_medida).trim(),
        ],
      );
    }

    await client.query("COMMIT");

    const resultado = await pool.query(
      `SELECT ri.id, ri.insumo_id, i.nombre AS insumo_nombre,
              i.unidad_medida AS insumo_unidad_base, ri.cantidad, ri.unidad_medida
       FROM receta_insumos ri
       JOIN insumos i ON i.id = ri.insumo_id
       WHERE ri.receta_id = $1
       ORDER BY i.nombre`,
      [recetaId],
    );
    res.json(
      resultado.rows.map((fila) => ({
        ...fila,
        cantidad: Number(fila.cantidad),
      })),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Error al guardar la receta." });
  } finally {
    client.release();
  }
});

// PUT /api/recetas/variante/:varianteId/tutorial
// Reemplaza TODO el tutorial de una variante de una sola vez: mismo patrón
// de reemplazo-completo-en-transacción que el PUT de insumos de arriba (y que
// routes/horarios.js) — crea la fila en `recetas` si no existía, borra sus
// receta_pasos y vuelve a insertar solo los recibidos, numerados en el orden
// en que llegan (1, 2, 3...). Cuerpo: { pasos: ["Primer paso...", "Segundo
// paso...", ...] } — el orden del arreglo ES el orden de preparación.
router.put("/variante/:varianteId/tutorial", async (req, res) => {
  const { varianteId } = req.params;
  const { pasos } = req.body;

  if (!Array.isArray(pasos)) {
    return res.status(400).json({ error: '"pasos" debe ser una lista.' });
  }
  const descripciones = pasos.map((paso) => String(paso ?? "").trim());
  if (descripciones.some((descripcion) => !descripcion)) {
    return res.status(400).json({ error: "Ningún paso puede quedar vacío." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const variante = await client.query(
      "SELECT id FROM variantes_producto WHERE id = $1",
      [varianteId],
    );
    if (variante.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Variante no encontrada." });
    }

    let receta = await client.query(
      "SELECT id FROM recetas WHERE variante_id = $1",
      [varianteId],
    );
    let recetaId;
    if (receta.rows.length === 0) {
      const nueva = await client.query(
        `INSERT INTO recetas (variante_id, editado_por, fecha_edicion)
         VALUES ($1, $2, NOW()) RETURNING id`,
        [varianteId, req.usuario.id],
      );
      recetaId = nueva.rows[0].id;
    } else {
      recetaId = receta.rows[0].id;
      // RNF-02: el tutorial también es parte de la receta — editarlo cuenta
      // como "modificación de recetas".
      await client.query(
        "UPDATE recetas SET editado_por = $1, fecha_edicion = NOW() WHERE id = $2",
        [req.usuario.id, recetaId],
      );
    }

    await client.query("DELETE FROM receta_pasos WHERE receta_id = $1", [
      recetaId,
    ]);
    for (let indice = 0; indice < descripciones.length; indice += 1) {
      await client.query(
        `INSERT INTO receta_pasos (receta_id, numero_paso, descripcion)
         VALUES ($1, $2, $3)`,
        [recetaId, indice + 1, descripciones[indice]],
      );
    }

    await client.query("COMMIT");

    const resultado = await pool.query(
      `SELECT id, numero_paso, descripcion
       FROM receta_pasos
       WHERE receta_id = $1
       ORDER BY numero_paso`,
      [recetaId],
    );
    res.json(resultado.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Error al guardar el tutorial." });
  } finally {
    client.release();
  }
});

// POST /api/recetas/variante/:varianteId/imagen
// Sube (o reemplaza) la foto de referencia "así debe quedar". Crea la fila
// en `recetas` si todavía no existía (igual que insumos/tutorial — no hace
// falta haber capturado nada más primero). Si ya tenía una foto, la
// anterior se borra de Cloudinary tras subir la nueva — "mejor esfuerzo":
// si ese borrado falla no se interrumpe la subida nueva.
router.post("/variante/:varianteId/imagen", (req, res) => {
  uploadImagen.single("imagen")(req, res, async (errorMulter) => {
    if (errorMulter) {
      return res.status(400).json({
        error: errorMulter.message || "No se pudo procesar el archivo.",
      });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'Falta el archivo de imagen (campo "imagen").' });
    }

    const { varianteId } = req.params;
    try {
      const variante = await pool.query(
        "SELECT id FROM variantes_producto WHERE id = $1",
        [varianteId],
      );
      if (variante.rows.length === 0) {
        return res.status(404).json({ error: "Variante no encontrada." });
      }

      let receta = await pool.query(
        "SELECT id, imagen_public_id FROM recetas WHERE variante_id = $1",
        [varianteId],
      );
      let recetaId;
      let publicIdAnterior = null;
      if (receta.rows.length === 0) {
        const nueva = await pool.query(
          "INSERT INTO recetas (variante_id) VALUES ($1) RETURNING id",
          [varianteId],
        );
        recetaId = nueva.rows[0].id;
      } else {
        recetaId = receta.rows[0].id;
        publicIdAnterior = receta.rows[0].imagen_public_id;
      }

      const subida = await subirImagen(req.file.buffer, "chucherias/recetas");

      if (publicIdAnterior) {
        await borrarImagen(publicIdAnterior).catch((error) => {
          console.error(
            "No se pudo borrar la imagen anterior de Cloudinary:",
            error,
          );
        });
      }

      await pool.query(
        "UPDATE recetas SET imagen_url = $1, imagen_public_id = $2 WHERE id = $3",
        [subida.secure_url, subida.public_id, recetaId],
      );
      res.json({ imagen_url: subida.secure_url });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al subir la imagen." });
    }
  });
});

// DELETE /api/recetas/variante/:varianteId/imagen
router.delete("/variante/:varianteId/imagen", async (req, res) => {
  const { varianteId } = req.params;
  try {
    const receta = await pool.query(
      "SELECT id, imagen_public_id FROM recetas WHERE variante_id = $1",
      [varianteId],
    );
    if (receta.rows.length === 0 || !receta.rows[0].imagen_public_id) {
      return res.json({ imagen_url: null });
    }
    await borrarImagen(receta.rows[0].imagen_public_id).catch((error) => {
      console.error("No se pudo borrar la imagen de Cloudinary:", error);
    });
    await pool.query(
      "UPDATE recetas SET imagen_url = NULL, imagen_public_id = NULL WHERE id = $1",
      [receta.rows[0].id],
    );
    res.json({ imagen_url: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al quitar la imagen." });
  }
});

module.exports = router;
