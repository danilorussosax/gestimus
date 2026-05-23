-- Backfill: per le fasi già CONCLUSE prima del fix in /fasi/:id/conclude
-- (che ora finalizza i candidati_fase non-ELIMINATI a COMPLETATO), aggiorniamo
-- a posteriori tutte le righe candidati_fase che sono rimaste IN_ATTESA / IN_ESECUZIONE
-- legate a una fase CONCLUSA. Senza questo, la view risultati mostra "in attesa"
-- anche per fasi chiuse, perché il flag `cf.stato !== 'COMPLETATO'` rimane vero.
--
-- Applicazione:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_23_backfill_candidati_fase_completato.sql

UPDATE candidati_fase
SET stato = 'COMPLETATO',
    updated_at = NOW()
WHERE stato IN ('IN_ATTESA', 'IN_ESECUZIONE')
  AND fase_id IN (SELECT id FROM fasi WHERE stato = 'CONCLUSA');
