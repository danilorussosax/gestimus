-- Aggiunge la colonna `tipo_gruppo` a `iscrizioni` e `candidati` per
-- distinguere ensemble da orchestra quando is_gruppo = true. Null = ensemble
-- (fallback per i record esistenti).
--
-- Applicazione:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_23_tipo_gruppo.sql

ALTER TABLE iscrizioni
  ADD COLUMN IF NOT EXISTS tipo_gruppo text;

ALTER TABLE candidati
  ADD COLUMN IF NOT EXISTS tipo_gruppo text;
