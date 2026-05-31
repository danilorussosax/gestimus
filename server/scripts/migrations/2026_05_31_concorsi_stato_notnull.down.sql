-- Rollback audit #1: riporta `concorsi.stato` a nullable senza default e
-- riallarga il CHECK ad accettare NULL.
ALTER TABLE concorsi DROP CONSTRAINT IF EXISTS concorsi_stato_check;
ALTER TABLE concorsi ADD CONSTRAINT concorsi_stato_check CHECK (stato IS NULL OR stato IN ('ATTIVO','CONCLUSO'));
ALTER TABLE concorsi ALTER COLUMN stato DROP NOT NULL;
ALTER TABLE concorsi ALTER COLUMN stato DROP DEFAULT;
