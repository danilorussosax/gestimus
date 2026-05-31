-- audit #1: `concorsi.stato` era nullable senza default → terzo stato implicito
-- (NULL) non documentato, creabile via API (Zod lo rendeva opzionale). Lo
-- rendiamo NOT NULL DEFAULT 'ATTIVO' e restringiamo il CHECK a rimuovere il
-- ramo `IS NULL OR`. Idempotente: rilanciabile (backfill su 0 righe, ALTER
-- no-op se già applicato, DROP/ADD del constraint per nome).

-- 1. Backfill: qualunque concorso con stato NULL diventa 'ATTIVO' (lo stato
--    "attivo" è il default funzionale; nessun concorso storico ha senso NULL).
UPDATE concorsi SET stato = 'ATTIVO' WHERE stato IS NULL;

-- 2. Default a livello colonna (allinea il DB allo schema Drizzle).
ALTER TABLE concorsi ALTER COLUMN stato SET DEFAULT 'ATTIVO';

-- 3. NOT NULL (sicuro: il backfill sopra ha eliminato i NULL residui).
ALTER TABLE concorsi ALTER COLUMN stato SET NOT NULL;

-- 4. CHECK più stretto: rimuove il ramo `IS NULL OR`. DROP IF EXISTS + ADD per
--    nome → idempotente e indipendente dall'ordine rispetto a db:push.
ALTER TABLE concorsi DROP CONSTRAINT IF EXISTS concorsi_stato_check;
ALTER TABLE concorsi ADD CONSTRAINT concorsi_stato_check CHECK (stato IN ('ATTIVO','CONCLUSO'));
