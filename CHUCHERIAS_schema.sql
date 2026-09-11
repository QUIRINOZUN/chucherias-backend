-- =========================================================
-- CHUCHERIAS - Esquema de base de datos (PostgreSQL / Neon)
-- Actividad 6: Diseño e implementación de la base de datos
-- =========================================================

-- ===================== USUARIOS Y PERSONAL =====================

CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(30) NOT NULL UNIQUE  -- administrador, encargado, cajero, auxiliar
);

CREATE TABLE usuarios (
    id                 SERIAL PRIMARY KEY,
    nombre             VARCHAR(100) NOT NULL,
    usuario            VARCHAR(50)  NOT NULL UNIQUE,
    contrasena_hash    VARCHAR(255) NOT NULL,
    rol_id             INTEGER NOT NULL REFERENCES roles(id),
    activo             BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE empleados (
    id             SERIAL PRIMARY KEY,
    usuario_id     INTEGER UNIQUE REFERENCES usuarios(id),
    nombre         VARCHAR(100) NOT NULL,
    puesto         VARCHAR(50)  NOT NULL,   -- cajero, auxiliar de cocina, repartidor, encargado
    fecha_ingreso  DATE NOT NULL,
    activo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE asistencias (
    id              SERIAL PRIMARY KEY,
    empleado_id     INTEGER NOT NULL REFERENCES empleados(id),
    fecha           DATE NOT NULL,
    hora_entrada    TIME,
    hora_salida     TIME,
    registrado_por  INTEGER REFERENCES usuarios(id),
    observaciones   VARCHAR(255)
);

-- ===================== CATÁLOGO Y RECETARIO =====================

CREATE TABLE categorias (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(50) NOT NULL UNIQUE   -- hamburguesas, pizzas, alitas y boneless, snacks, bebidas, etc.
);

CREATE TABLE productos (
    id            SERIAL PRIMARY KEY,
    categoria_id  INTEGER NOT NULL REFERENCES categorias(id),
    nombre        VARCHAR(100) NOT NULL,
    descripcion   TEXT,
    precio_base   NUMERIC(10,2) NOT NULL,
    imagen_url    VARCHAR(255),             -- URL de Cloudinary
    activo        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE variantes_producto (
    id           SERIAL PRIMARY KEY,
    producto_id  INTEGER NOT NULL REFERENCES productos(id),
    nombre       VARCHAR(80) NOT NULL,      -- ej. "12 oz", "Paquete 12 piezas", "Único"
    precio       NUMERIC(10,2) NOT NULL
);

CREATE TABLE recetas (
    id           SERIAL PRIMARY KEY,
    variante_id  INTEGER NOT NULL UNIQUE REFERENCES variantes_producto(id)
);

-- ===================== PROVEEDORES E INVENTARIO =====================

CREATE TABLE proveedores (
    id        SERIAL PRIMARY KEY,
    nombre    VARCHAR(100) NOT NULL,
    contacto  VARCHAR(100),
    telefono  VARCHAR(20)
);

CREATE TABLE insumos (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(100) NOT NULL,
    unidad_medida     VARCHAR(20) NOT NULL,   -- g, kg, ml, l, pieza, porcion
    cantidad_minima   NUMERIC(10,2) NOT NULL DEFAULT 0,
    proveedor_id      INTEGER REFERENCES proveedores(id)
);

CREATE TABLE receta_insumos (
    id             SERIAL PRIMARY KEY,
    receta_id      INTEGER NOT NULL REFERENCES recetas(id),
    insumo_id      INTEGER NOT NULL REFERENCES insumos(id),
    cantidad       NUMERIC(10,2) NOT NULL,
    unidad_medida  VARCHAR(20) NOT NULL
);

CREATE TABLE movimientos_inventario (
    id              SERIAL PRIMARY KEY,
    insumo_id       INTEGER NOT NULL REFERENCES insumos(id),
    tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada','salida','ajuste','merma')),
    cantidad        NUMERIC(10,2) NOT NULL,
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    responsable_id  INTEGER NOT NULL REFERENCES usuarios(id),
    motivo          VARCHAR(255)
);

-- ===================== CLIENTES Y LEALTAD =====================

CREATE TABLE clientes (
    id                  SERIAL PRIMARY KEY,
    nombre_completo     VARCHAR(150) NOT NULL,
    telefono            VARCHAR(20),
    visitas_acumuladas  INTEGER NOT NULL DEFAULT 0,
    fecha_registro      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ===================== ÓRDENES Y VENTAS =====================

CREATE TABLE ordenes (
    id             SERIAL PRIMARY KEY,
    numero_orden   VARCHAR(20) NOT NULL UNIQUE,
    cliente_id     INTEGER REFERENCES clientes(id),
    tipo_entrega   VARCHAR(20) NOT NULL CHECK (tipo_entrega IN ('presencial','domicilio')),
    estado         VARCHAR(20) NOT NULL DEFAULT 'sin_preparar'
                   CHECK (estado IN ('sin_preparar','preparando','preparado','entregado','cancelada')),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    creado_por     INTEGER NOT NULL REFERENCES usuarios(id),
    repartidor_id  INTEGER REFERENCES empleados(id)
);

CREATE TABLE orden_detalle (
    id               SERIAL PRIMARY KEY,
    orden_id         INTEGER NOT NULL REFERENCES ordenes(id),
    variante_id      INTEGER NOT NULL REFERENCES variantes_producto(id),
    cantidad         INTEGER NOT NULL DEFAULT 1,
    precio_unitario  NUMERIC(10,2) NOT NULL,
    notas            VARCHAR(255)   -- extras, ingredientes a quitar, etc.
);

CREATE TABLE ventas (
    id                   SERIAL PRIMARY KEY,
    orden_id             INTEGER NOT NULL UNIQUE REFERENCES ordenes(id),
    fecha                TIMESTAMP NOT NULL DEFAULT NOW(),
    subtotal             NUMERIC(10,2) NOT NULL,
    descuento_lealtad    NUMERIC(10,2) NOT NULL DEFAULT 0,
    total                NUMERIC(10,2) NOT NULL,
    metodo_pago          VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','transferencia')),
    estado               VARCHAR(20) NOT NULL DEFAULT 'completada'
                         CHECK (estado IN ('completada','cancelada')),
    cajero_id            INTEGER NOT NULL REFERENCES usuarios(id),
    cancelado_por        INTEGER REFERENCES usuarios(id),
    motivo_cancelacion   VARCHAR(255)
);

CREATE TABLE lealtad_historial (
    id            SERIAL PRIMARY KEY,
    cliente_id    INTEGER NOT NULL REFERENCES clientes(id),
    venta_id      INTEGER REFERENCES ventas(id),
    tipo_evento   VARCHAR(20) NOT NULL CHECK (tipo_evento IN ('visita','descuento_aplicado')),
    descripcion   VARCHAR(255),
    fecha         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ===================== MERMAS Y CAJA =====================

CREATE TABLE mermas (
    id              SERIAL PRIMARY KEY,
    variante_id     INTEGER REFERENCES variantes_producto(id),
    insumo_id       INTEGER REFERENCES insumos(id),
    cantidad        NUMERIC(10,2) NOT NULL,
    motivo          VARCHAR(255),
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    responsable_id  INTEGER NOT NULL REFERENCES usuarios(id),
    CHECK (variante_id IS NOT NULL OR insumo_id IS NOT NULL)
);

CREATE TABLE cortes_caja (
    id                   SERIAL PRIMARY KEY,
    fecha                DATE NOT NULL,
    turno                VARCHAR(30),
    total_efectivo       NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_transferencia  NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_sistema        NUMERIC(10,2) NOT NULL DEFAULT 0,
    diferencia           NUMERIC(10,2) NOT NULL DEFAULT 0,
    responsable_id       INTEGER NOT NULL REFERENCES usuarios(id)
);

-- ===================== ÍNDICES RECOMENDADOS =====================

CREATE INDEX idx_ordenes_estado ON ordenes(estado);
CREATE INDEX idx_ordenes_fecha ON ordenes(fecha_creacion);
CREATE INDEX idx_ventas_fecha ON ventas(fecha);
CREATE INDEX idx_movimientos_insumo ON movimientos_inventario(insumo_id);
CREATE INDEX idx_asistencias_empleado_fecha ON asistencias(empleado_id, fecha);
CREATE INDEX idx_lealtad_cliente ON lealtad_historial(cliente_id);

-- ===================== DATOS INICIALES (SEED) =====================

INSERT INTO roles (nombre) VALUES
  ('administrador'), ('encargado'), ('cajero'), ('auxiliar');
