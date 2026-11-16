-- =============================================================================
-- 2026-11-16_TODAS_pendientes.sql — SQL de la sesion del 2026-11-16, en el orden recomendado.
-- (ordenes_compra ya se aplico por separado y NO se incluye.)
-- Todo es idempotente (IF NOT EXISTS): correrlo dos veces no daña nada.
-- Pegar completo en la consola SQL de Neon y ejecutar.
-- =============================================================================

-- ---------- 2026-11-16_seguridad_cuenta.sql ----------
-- Seguridad de cuenta (2026-11-16):
--  1) debe_cambiar_contrasena: una cuenta nueva (o con contraseña restablecida
--     por el administrador) obliga a elegir contraseña propia en el primer inicio.
--  2) totp_secreto / totp_activo: verificación en dos pasos (app autenticadora).
-- Las cuentas existentes NO cambian (FALSE por default); para forzar el cambio
-- en una cuenta concreta: UPDATE usuarios SET debe_cambiar_contrasena = TRUE WHERE usuario = '...';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secreto VARCHAR(64);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_activo BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- 2026-11-16_pedidos_programados.sql ----------
-- Pedidos programados (2026-11-16): una orden puede llevar la hora para la que se
-- pidió (recoger o entregar más tarde). Se guarda en UTC, igual que el resto de
-- las fechas del sistema. NULL = pedido normal, para ahora.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS programada_para TIMESTAMP;

-- ---------- 2026-11-16_clientes_cumpleanos.sql ----------
-- Cumpleaños de clientes de lealtad (2026-11-16): fecha de nacimiento opcional,
-- para avisar quién cumple años este mes. Solo se usa el día y el mes.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;

-- ---------- 2026-11-16_propinas.sql ----------
-- Propinas (2026-11-16): lo que el cliente deja ademas del total de la venta.
-- Se guarda aparte: NO es ingreso del negocio (no entra a ventas.total ni a los
-- reportes de ventas), pero si es dinero que entra al cajon (efectivo) o a la
-- cuenta (transferencia), asi que Caja lo suma al esperado de cada metodo.
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS propina NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ---------- 2026-11-16_promociones.sql ----------
-- Promociones con vigencia (2026-11-16): descuentos por porcentaje o monto fijo
-- sobre todo el menu, una categoria, un producto o una variante, opcionalmente
-- solo ciertos dias de la semana, en cierto horario y/o entre dos fechas.
-- La promocion vigente se convierte en el PRECIO de la variante (el servidor lo
-- recalcula al cobrar), asi totales, lealtad y reportes siguen igual.
CREATE TABLE IF NOT EXISTS promociones (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(80) NOT NULL,
    tipo           VARCHAR(12) NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
    valor          NUMERIC(10,2) NOT NULL CHECK (valor > 0),
    alcance        VARCHAR(12) NOT NULL DEFAULT 'todo'
                   CHECK (alcance IN ('todo', 'categoria', 'producto', 'variante')),
    alcance_id     INTEGER,
    -- 0 = domingo ... 6 = sabado (hora de Durango). NULL = todos los dias.
    dias_semana    SMALLINT[],
    hora_inicio    TIME,
    hora_fin       TIME,
    fecha_inicio   DATE,
    fecha_fin      DATE,
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por     INTEGER REFERENCES usuarios(id),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (tipo <> 'porcentaje' OR valor <= 100),
    CHECK ((alcance = 'todo' AND alcance_id IS NULL) OR (alcance <> 'todo' AND alcance_id IS NOT NULL))
);

-- ---------- 2026-11-16_ventas_idempotencia.sql ----------
-- Ventas sin internet (2026-11-16): cada venta que sale del POS lleva una clave
-- unica generada en el navegador. Si el POS no recibe respuesta (se cayo el
-- internet justo al cobrar) y reintenta, el servidor reconoce la clave y
-- devuelve la venta que ya registro en vez de crear una duplicada.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS clave_idempotencia VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ordenes_clave_idempotencia
    ON ordenes (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

