-- =============================================================================
-- 2026-10-31_categorias_icono_color.sql — Ícono y color personalizables
-- =============================================================================
-- Antes, el color y el ícono de cada categoría del menú estaban hardcodeados
-- en el frontend (pos/categoria-estilos.ts, por NOMBRE de categoría) — no
-- había forma de cambiarlos sin tocar código. El usuario pidió poder
-- personalizarlos desde Recetario → Menú → Categorías.
--
-- Ambas columnas son opcionales: una categoría sin icono/color capturados
-- (el caso de TODO el catálogo real hoy, justo después de correr esta
-- migración) sigue usando el estilo por defecto que ya resuelve
-- pos/categoria-estilos.ts por nombre — esta migración no cambia cómo se ve
-- nada hasta que alguien personalice una categoría desde la app.
--
--   icono → nombre de un símbolo del sprite SVG de index.html (sin el
--           prefijo "ic-"), ej. "pizza" → #ic-pizza.
--   color → un color CSS literal (el selector de color del navegador
--           siempre entrega #RRGGBB), ej. "#c2410c".
-- =============================================================================

ALTER TABLE categorias ADD COLUMN IF NOT EXISTS icono VARCHAR(40);
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS color VARCHAR(40);
