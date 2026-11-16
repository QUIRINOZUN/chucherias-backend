// =============================================================================
// utils/ingenieriaMenu.js — CLASIFICACIÓN DE INGENIERÍA DE MENÚ (función pura)
// =============================================================================
// Recibe las variantes vendidas { unidades, ingreso, margen_unitario | null, ... }
// y devuelve cada una con su `clase` (estrella | caballo | rompecabezas | perro |
// sin_costo) más los umbrales usados. Separada de la ruta para poder probarla
// sin base de datos. Ver la explicación del método en routes/reportes.js.
// =============================================================================
function clasificarMenu(filas) {
  const conCosto = filas.filter((f) => f.margen_unitario !== null);
  const unidadesConCosto = conCosto.reduce((s, f) => s + f.unidades, 0);

  // Umbral de popularidad: 70% de la parte "pareja" que le tocaría a cada una.
  const umbralUnidades = conCosto.length ? (unidadesConCosto / conCosto.length) * 0.7 : 0;
  // Margen promedio PONDERADO por unidades vendidas.
  const margenPromedio = unidadesConCosto
    ? conCosto.reduce((s, f) => s + f.margen_unitario * f.unidades, 0) / unidadesConCosto
    : 0;

  const items = filas.map((f) => {
    if (f.margen_unitario === null) return { ...f, clase: 'sin_costo' };
    const popular = f.unidades >= umbralUnidades;
    const margenAlto = f.margen_unitario >= margenPromedio;
    let clase;
    if (popular) clase = margenAlto ? 'estrella' : 'caballo';
    else clase = margenAlto ? 'rompecabezas' : 'perro';
    return { ...f, clase };
  });

  const conteo = { estrella: 0, caballo: 0, rompecabezas: 0, perro: 0, sin_costo: 0 };
  for (const i of items) conteo[i.clase]++;

  return {
    umbral_unidades: umbralUnidades,
    margen_promedio: margenPromedio,
    conteo,
    total_unidades: filas.reduce((s, f) => s + f.unidades, 0),
    total_ingreso: filas.reduce((s, f) => s + f.ingreso, 0),
    items,
  };
}

module.exports = { clasificarMenu };
