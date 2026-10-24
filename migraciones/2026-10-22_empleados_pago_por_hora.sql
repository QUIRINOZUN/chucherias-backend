-- Nómina por horas trabajadas: el titular paga a su personal por HORA
-- TRABAJADA, no un sueldo fijo. Cada empleado necesita su propia tarifa para
-- poder calcular su pago — nullable a propósito: sin capturarla, ese
-- empleado simplemente no se puede incluir todavía en un cálculo de nómina
-- (nunca se asume ningún valor por default). Se captura/corrige desde la
-- propia pantalla de Nómina (PATCH /api/nomina/:empleadoId/tarifa), no desde
-- Asistencias → Empleados — es información salarial, más sensible que
-- nombre/puesto/fecha de ingreso.
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS pago_por_hora NUMERIC(10,2);
