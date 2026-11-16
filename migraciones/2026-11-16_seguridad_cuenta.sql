-- Seguridad de cuenta (2026-11-16):
--  1) debe_cambiar_contrasena: una cuenta nueva (o con contraseña restablecida
--     por el administrador) obliga a elegir contraseña propia en el primer inicio.
--  2) totp_secreto / totp_activo: verificación en dos pasos (app autenticadora).
-- Las cuentas existentes NO cambian (FALSE por default); para forzar el cambio
-- en una cuenta concreta: UPDATE usuarios SET debe_cambiar_contrasena = TRUE WHERE usuario = '...';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secreto VARCHAR(64);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_activo BOOLEAN NOT NULL DEFAULT FALSE;
