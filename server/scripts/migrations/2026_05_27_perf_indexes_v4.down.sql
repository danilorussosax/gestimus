-- Rollback di 2026_05_27_perf_indexes_v4.sql — drop dei soli indici aggiunti.
-- Idempotente (IF EXISTS). Nessuna perdita di dati (gli indici sono ricostruibili).
DROP INDEX IF EXISTS idx_eventi_fase;
DROP INDEX IF EXISTS idx_eventi_sezione;
DROP INDEX IF EXISTS idx_eventi_categoria;
DROP INDEX IF EXISTS idx_eventi_sala;
DROP INDEX IF EXISTS idx_iscrizioni_candidato;
DROP INDEX IF EXISTS idx_calpub_sezione;
DROP INDEX IF EXISTS idx_iscrizioni_email_verification_token;
DROP INDEX IF EXISTS idx_iscrizioni_upload_token;
