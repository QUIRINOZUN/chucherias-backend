-- Excepciones de horario por FECHA específica (2026-10-08), por empleado.
-- `horarios` es un patrón SEMANAL recurrente (editar un martes cambia TODOS
-- los martes); esta tabla es para un día SUELTO distinto al patrón normal
-- de ese empleado (un feriado, una semana de vacaciones, etc.) sin afectar
-- las demás semanas. Si un empleado+fecha no tiene fila aquí, su estado ese
-- día sigue siendo el que diga `horarios` (o "descanso" si tampoco hay fila
-- ahí). "cerrado" es un estado MÁS, igual que "trabaja"/"descanso" — no es
-- una marca global del negocio, se captura por empleado como cualquier otro
-- (decisión del usuario, 2026-10-08).
CREATE TABLE IF NOT EXISTS horario_excepciones (
    id            SERIAL PRIMARY KEY,
    empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
    fecha         DATE NOT NULL,
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('trabaja', 'descanso', 'cerrado')),
    -- Solo tienen valor cuando tipo = 'trabaja'; NULL en 'descanso'/'cerrado'.
    hora_entrada  TIME,
    hora_salida   TIME,
    UNIQUE (empleado_id, fecha)
);
