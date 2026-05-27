-- Rollback di 2026_05_26_junction_reverse_indexes.sql
-- Rimuove gli indici reverse-lookup sulle junction table. Idempotente.

DROP INDEX IF EXISTS idx_commissioni_commissari_commissario;
DROP INDEX IF EXISTS idx_commissioni_sezioni_sezione;
DROP INDEX IF EXISTS idx_commissioni_categorie_categoria;
DROP INDEX IF EXISTS idx_fasi_sezioni_sezione;
