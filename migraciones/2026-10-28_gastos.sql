-- Gastos generales del negocio (2026-10-28): renta, servicios, mantenimiento,
-- compras no ligadas a una venta ni a un insumo de receta. Cierra la foto
-- financiera que ya dan Ventas (ingresos), Costeo (costo de insumos) y
-- Nómina (costo de mano de obra) — hasta ahora el sistema no tenía dónde
-- capturar el resto de lo que sale del negocio.
--
-- DECISIÓN DE ALCANCE (confirmada con el usuario antes de construir):
--   1. Deliberadamente AISLADO de movimientos_caja/corte de caja, mismo
--      criterio que ya usa ventas_especiales con caja/inventario/comandas:
--      si un gasto se paga en efectivo HOY, eso se sigue registrando como
--      "retiro" en Caja (ya existe) — aquí solo se anota en qué se usó el
--      dinero, sin importar fecha o forma de pago. Nunca genera un
--      movimiento de caja automático.
--   2. categoria_id es editable desde la app (igual que categorias_insumo
--      en Inventario) — nunca categorías fijas en código.
--   3. proveedor_id es opcional — reusa la tabla `proveedores` ya existente
--      (antes solo la usaba Inventario), sin construir todavía una pantalla
--      de "Proveedores y compras" completa.
--   4. es_recurrente es solo una ETIQUETA informativa (para filtrar/sumar
--      "cuánto gasto fijo tengo al mes" en Reportes) — este backend no tiene
--      ningún mecanismo de tareas programadas, así que nunca genera gastos
--      solo.
--   5. Solo administrador/encargado pueden ver o registrar (RNF-03,
--      información financiera — mismo criterio que insumos, movimientos de
--      caja, nómina y reportes).
CREATE TABLE IF NOT EXISTS categorias_gasto (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS gastos (
    id              SERIAL PRIMARY KEY,
    categoria_id    INTEGER NOT NULL REFERENCES categorias_gasto(id),
    concepto        VARCHAR(150) NOT NULL,
    monto           NUMERIC(10,2) NOT NULL CHECK (monto > 0),
    -- La fecha REAL del gasto (ej. el recibo de luz de la quincena pasada),
    -- no necesariamente la fecha en que se captura.
    fecha           DATE NOT NULL,
    -- Mismo enum que ya usa ventas.metodo_pago — sin "tarjeta": el negocio
    -- real no cobra con tarjeta todavía (ver CLAUDE.md, impresión/terminales
    -- de pago fuera de alcance).
    forma_pago      VARCHAR(20) NOT NULL CHECK (forma_pago IN ('efectivo','transferencia')),
    es_recurrente   BOOLEAN NOT NULL DEFAULT FALSE,
    proveedor_id    INTEGER REFERENCES proveedores(id),
    nota            VARCHAR(500),
    registrado_por  INTEGER NOT NULL REFERENCES usuarios(id),
    fecha_registro  TIMESTAMP NOT NULL DEFAULT NOW(),
    -- RNF-02 (mismo criterio ya aplicado a variantes_producto/recetas): un
    -- gasto editado deja rastro de quién y cuándo.
    editado_por     INTEGER REFERENCES usuarios(id),
    fecha_edicion   TIMESTAMP
);

-- Catálogo inicial sugerido — editable después desde la app, no es una
-- lista fija (mismo criterio que categorias_insumo/checklist_items).
INSERT INTO categorias_gasto (nombre) VALUES
    ('Renta'),
    ('Servicios (luz, agua, gas)'),
    ('Mantenimiento de equipo'),
    ('Insumos no alimenticios'),
    ('Sueldos y bonos extra'),
    ('Otro')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);
