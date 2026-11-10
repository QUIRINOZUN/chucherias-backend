-- Cargo de envío a domicilio ($25 por pedido, se le paga al repartidor cada semana).
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cargo_envio NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Tarifa de envío editable por el administrador (una sola fila).
CREATE TABLE IF NOT EXISTS config_negocio (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    tarifa_envio_domicilio  NUMERIC(10,2) NOT NULL DEFAULT 25 CHECK (tarifa_envio_domicilio >= 0)
);
INSERT INTO config_negocio (id, tarifa_envio_domicilio) VALUES (1, 25) ON CONFLICT (id) DO NOTHING;
