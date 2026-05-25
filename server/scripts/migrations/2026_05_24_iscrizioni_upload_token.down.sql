-- Rollback di 2026_05_24_iscrizioni_upload_token.sql
-- Rimuove la colonna del token di upload allegati dall'iscrizione. Idempotente.
ALTER TABLE iscrizioni DROP COLUMN IF EXISTS upload_token;
