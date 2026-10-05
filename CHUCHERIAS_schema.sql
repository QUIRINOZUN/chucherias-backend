-- =========================================================
-- CHUCHERIAS - Esquema de base de datos (PostgreSQL / Neon)
-- Actividad 6: Diseño e implementación de la base de datos
-- =========================================================

-- ===================== USUARIOS Y PERSONAL =====================

CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(30) NOT NULL UNIQUE  -- administrador, encargado, cajero, auxiliar
);

-- Cuentas de acceso al sistema. Nunca se borran: se desactivan (activo = FALSE)
-- para conservar el historial de ventas/cortes de cada persona.
-- contrasena_hash guarda SOLO el hash bcrypt, jamás la contraseña.
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

-- Horario SEMANAL recurrente por empleado (Sprint 3): una fila por cada día
-- de la semana que trabaja (sin fila = libre ese día). No tiene fecha propia
-- -- se repite cada semana hasta que alguien lo edite. Sirve hoy para que el
-- administrador/encargado asignen el horario esperado; en una fase futura
-- podría usarse para calcular retardos contra asistencias.hora_entrada.
CREATE TABLE horarios (
    id            SERIAL PRIMARY KEY,
    empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
    dia_semana    VARCHAR(10) NOT NULL
                  CHECK (dia_semana IN ('lunes','martes','miercoles','jueves','viernes','sabado','domingo')),
    hora_entrada  TIME NOT NULL,
    hora_salida   TIME NOT NULL,
    UNIQUE (empleado_id, dia_semana)
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
    -- Presentación que se vende (tamaño o paquete). ESTA es la unidad que se
    -- agrega al carrito y la ÚNICA fuente de precios: el servidor siempre lee
    -- el precio de aquí, nunca del cliente.
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

-- Categorías de INSUMOS (dominio de inventario) — separadas de `categorias`
-- (esa es la del menú/productos): agrupan proteínas, lácteos, salsas, etc.
CREATE TABLE categorias_insumo (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE insumos (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(100) NOT NULL,
    unidad_medida     VARCHAR(20) NOT NULL,   -- g, kg, ml, l, pieza, porcion
    categoria_id      INTEGER REFERENCES categorias_insumo(id),
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
    -- orden_id se agrega más abajo con ALTER TABLE, una vez que `ordenes` ya
    -- existe (movimientos_inventario se crea antes en este archivo porque
    -- depende de `insumos`, que a su vez las tablas de órdenes no necesitan).
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

-- Una orden = un pedido. Se crea junto con su venta (routes/ventas.js) y su
-- estado es lo que la cocina ve en el tablero de comandas (Sprint 2).
-- Flujo: sin_preparar -> preparando -> por_entregar -> entregado.
-- 'cancelada' se asigna al cancelar la venta y ya no avanza.
CREATE TABLE ordenes (
    id             SERIAL PRIMARY KEY,
    numero_orden   VARCHAR(20) NOT NULL UNIQUE,
    cliente_id     INTEGER REFERENCES clientes(id),
    tipo_entrega   VARCHAR(20) NOT NULL CHECK (tipo_entrega IN ('presencial','domicilio')),
    estado         VARCHAR(20) NOT NULL DEFAULT 'sin_preparar'
                   CHECK (estado IN ('sin_preparar','preparando','por_entregar','entregado','cancelada')),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    creado_por     INTEGER NOT NULL REFERENCES usuarios(id),
    repartidor_id  INTEGER REFERENCES empleados(id)
);

-- Renglones de una orden: qué variante, cuántas y a qué precio. precio_unitario
-- se "congela" al vender, así los cambios de menú no alteran ventas pasadas.
-- notas guarda la personalización ("Sin: tocino · sin picante"). `cancelado`
-- permite cancelar solo ALGUNOS productos de una venta con varios artículos
-- (en vez de todo-o-nada): la venta sigue 'completada' si queda al menos un
-- renglón activo; ver PATCH /api/ventas/:id/cancelar. `motivo_cancelacion`
-- vive AQUÍ (no solo en ventas.motivo_cancelacion) porque una cancelación
-- parcial no siempre deja a la venta como 'cancelada'.
CREATE TABLE orden_detalle (
    id                  SERIAL PRIMARY KEY,
    orden_id            INTEGER NOT NULL REFERENCES ordenes(id),
    variante_id         INTEGER NOT NULL REFERENCES variantes_producto(id),
    cantidad            INTEGER NOT NULL DEFAULT 1,
    precio_unitario     NUMERIC(10,2) NOT NULL,
    notas               VARCHAR(255),  -- extras, ingredientes a quitar, etc.
    cancelado           BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_cancelacion   TIMESTAMP,
    motivo_cancelacion  VARCHAR(255)
);

-- Versión ESTRUCTURADA de la personalización de un renglón (Fase 2 del
-- recetario): qué insumo se quitó (para NO descontarlo del inventario) o
-- cuál se eligió (salsa/topping — pendiente de que exista el selector en el
-- POS). `notas` sigue existiendo para que un humano lo lea de un vistazo;
-- esta tabla es la que usa el descuento automático (ver routes/ordenes.js,
-- PATCH /:id/estado al pasar a 'preparando').
CREATE TABLE orden_detalle_insumos (
    id                SERIAL PRIMARY KEY,
    orden_detalle_id  INTEGER NOT NULL REFERENCES orden_detalle(id),
    insumo_id         INTEGER NOT NULL REFERENCES insumos(id),
    tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('quitado', 'elegido')),
    cantidad          NUMERIC(10,2),  -- solo 'elegido'; 'quitado' es binario
    unidad_medida     VARCHAR(20)
);

-- `orden_id` liga una salida (descuento por receta, al pasar a 'preparando')
-- o una entrada de reversión (restitución al cancelar — RF-11) con la orden
-- que la originó; NULL en entradas/ajustes/mermas manuales que no vienen de
-- una orden.
ALTER TABLE movimientos_inventario ADD COLUMN orden_id INTEGER REFERENCES ordenes(id);
CREATE INDEX idx_movimientos_inventario_orden ON movimientos_inventario(orden_id);

-- Un renglón por cada estado por el que pasa una orden (RF-08): fecha_fin
-- queda NULL mientras la orden sigue en ese estado. Permite calcular cuánto
-- duró cada paso (sin_preparar, preparando, por_entregar) para reportes.
CREATE TABLE orden_estado_historial (
    id              SERIAL PRIMARY KEY,
    orden_id        INTEGER NOT NULL REFERENCES ordenes(id),
    estado          VARCHAR(20) NOT NULL,
    fecha_inicio    TIMESTAMP NOT NULL,
    fecha_fin       TIMESTAMP,
    responsable_id  INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_orden_estado_historial_orden ON orden_estado_historial(orden_id);

-- El cobro de una orden (relación 1 a 1 con ordenes). Guarda quién cobró
-- (cajero_id) y, si se cancela, quién (cancelado_por), cuándo
-- (fecha_cancelacion) y por qué (motivo_cancelacion) — RF-03.
-- Solo las ventas 'completada' cuentan para el corte de caja.
-- `fecha` está en UTC; el "día del negocio" se calcula en hora de Durango
-- (ver utils/fecha.js).
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
    motivo_cancelacion   VARCHAR(255),
    fecha_cancelacion    TIMESTAMP
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

-- Producto o insumo que se perdió sin poder venderse. Se llena manualmente
-- (ingrediente que se echó a perder, etc.) o automáticamente al cancelar una
-- venta: una fila por producto de la orden cancelada (ver routes/ventas.js).
-- orden_id es NULL en las mermas manuales; se llena solo en las que salen de
-- una cancelación, para poder rastrear de qué orden vino cada una.
-- valor_unitario congela el precio de la variante en el momento de la merma
-- (igual que orden_detalle.precio_unitario), para poder calcular pesos
-- perdidos, no solo piezas; NULL en mermas manuales sin precio de venta.
-- estado_orden_previo guarda en qué estado estaba la orden justo antes de
-- cancelarse (columna filtrable/agrupable para reportes; antes solo vivía
-- dentro del texto de `motivo`), NULL en mermas manuales sin orden.
CREATE TABLE mermas (
    id                    SERIAL PRIMARY KEY,
    variante_id           INTEGER REFERENCES variantes_producto(id),
    insumo_id             INTEGER REFERENCES insumos(id),
    cantidad              NUMERIC(10,2) NOT NULL,
    motivo                VARCHAR(255),
    fecha                 TIMESTAMP NOT NULL DEFAULT NOW(),
    responsable_id        INTEGER NOT NULL REFERENCES usuarios(id),
    orden_id              INTEGER REFERENCES ordenes(id),
    valor_unitario        NUMERIC(10,2),
    estado_orden_previo   VARCHAR(20),
    CHECK (variante_id IS NOT NULL OR insumo_id IS NOT NULL)
);

-- Corte de caja (RF-04). total_efectivo y total_transferencia son lo CONTADO
-- físicamente por el responsable; total_sistema es lo que el servidor calculó
-- de las ventas; diferencia = contado - sistema (positiva sobra, negativa falta).
-- Puede haber más de un corte por día (turnos).
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

-- Movimientos de efectivo que NO son ventas: apertura (saldo inicial del
-- turno), ingreso (efectivo que entra fuera de una venta normal), retiro
-- (solo administrador) y reembolso (dinero devuelto al cliente al cancelar
-- parte o toda una venta — ver PATCH /api/ventas/:id/cancelar, `orden_id`
-- liga el reembolso con la orden que lo originó). El total del sistema en
-- /api/caja/resumen es ventas_efectivo + apertura + ingresos − retiros −
-- reembolsos. Un retiro nace sin confirmar; el cajero lo confirma en el POS
-- y ahí se imprime su comprobante (ver routes/caja.js). Un reembolso nace ya
-- confirmado: lo genera automáticamente la cancelación, no requiere el paso
-- de confirmación del cajero en el POS.
CREATE TABLE movimientos_caja (
    id                  SERIAL PRIMARY KEY,
    tipo                VARCHAR(10) NOT NULL CHECK (tipo IN ('apertura', 'ingreso', 'retiro', 'reembolso')),
    monto               NUMERIC(10,2) NOT NULL CHECK (monto > 0),
    motivo              VARCHAR(255),
    fecha               TIMESTAMP NOT NULL DEFAULT NOW(),
    responsable_id      INTEGER NOT NULL REFERENCES usuarios(id),
    confirmado          BOOLEAN NOT NULL DEFAULT FALSE,
    confirmado_por      INTEGER REFERENCES usuarios(id),
    fecha_confirmacion  TIMESTAMP,
    orden_id            INTEGER REFERENCES ordenes(id)
);
CREATE INDEX idx_movimientos_caja_orden ON movimientos_caja(orden_id);

-- ===================== ÍNDICES RECOMENDADOS =====================

CREATE INDEX idx_ordenes_estado ON ordenes(estado);
CREATE INDEX idx_ordenes_fecha ON ordenes(fecha_creacion);
CREATE INDEX idx_ventas_fecha ON ventas(fecha);
CREATE INDEX idx_movimientos_insumo ON movimientos_inventario(insumo_id);
CREATE INDEX idx_asistencias_empleado_fecha ON asistencias(empleado_id, fecha);
CREATE INDEX idx_movimientos_caja_fecha ON movimientos_caja(fecha);
CREATE INDEX idx_mermas_orden ON mermas(orden_id);
CREATE INDEX idx_mermas_fecha ON mermas(fecha);
CREATE INDEX idx_orden_detalle_insumos_detalle ON orden_detalle_insumos(orden_detalle_id);
CREATE INDEX idx_lealtad_cliente ON lealtad_historial(cliente_id);

-- ===================== DATOS INICIALES (SEED) =====================

INSERT INTO roles (nombre) VALUES
  ('administrador'), ('encargado'), ('cajero'), ('auxiliar');
