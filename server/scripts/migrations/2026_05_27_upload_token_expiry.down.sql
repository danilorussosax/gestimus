-- Rollback di 2026_05_27_upload_token_expiry.sql
-- Rimuove la colonna di scadenza del token di upload. Idempotente.
ALTER TABLE iscrizioni DROP COLUMN IF EXISTS upload_token_expires_at;
