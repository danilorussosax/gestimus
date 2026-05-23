-- N26/N32: converte il vincolo UNIQUE full (concorso_id, email) su iscrizioni
-- in un indice unique PARZIALE su stato != 'RIFIUTATA'. Permette la
-- ri-iscrizione dopo un rifiuto; le righe erased hanno email per-riga univoca.
-- Idempotente.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uniq_iscrizioni_concorso_email') THEN
    ALTER TABLE iscrizioni DROP CONSTRAINT uniq_iscrizioni_concorso_email;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_iscrizioni_concorso_email_active
  ON iscrizioni (concorso_id, email)
  WHERE stato <> 'RIFIUTATA';
