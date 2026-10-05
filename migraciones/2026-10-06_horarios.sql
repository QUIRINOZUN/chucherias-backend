-- Horario SEMANAL recurrente por empleado (Sprint 3): una fila por cada día
-- de la semana que trabaja (sin fila = libre ese día). No tiene fecha propia
-- -- se repite cada semana hasta que alguien lo edite.
CREATE TABLE IF NOT EXISTS horarios (
    id            SERIAL PRIMARY KEY,
    empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
    dia_semana    VARCHAR(10) NOT NULL
                  CHECK (dia_semana IN ('lunes','martes','miercoles','jueves','viernes','sabado','domingo')),
    hora_entrada  TIME NOT NULL,
    hora_salida   TIME NOT NULL,
    UNIQUE (empleado_id, dia_semana)
);
