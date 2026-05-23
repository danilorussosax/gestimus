-- Rianalisi 5: constraint + indici.
-- N41: voto non negativo a livello DB.
-- N42: indice su candidati_fase.candidato_id (query per-candidato).
-- N43: un candidato COMPLETATO deve avere esito esplicito (ammesso NOT NULL).
--      Backfill delle righe esistenti PRIMA di aggiungere il CHECK, altrimenti
--      le COMPLETATO con ammesso NULL violerebbero il vincolo.
-- Idempotente.

-- N41
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valutazioni_voto_check') THEN
    ALTER TABLE valutazioni ADD CONSTRAINT valutazioni_voto_check CHECK (voto >= 0);
  END IF;
END $$;

-- N42
CREATE INDEX IF NOT EXISTS idx_candidati_fase_candidato ON candidati_fase (candidato_id);

-- N43: backfill + CHECK
UPDATE candidati_fase
   SET ammesso_prossima_fase = false
 WHERE stato = 'COMPLETATO' AND ammesso_prossima_fase IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidati_fase_completato_ammesso_check') THEN
    ALTER TABLE candidati_fase
      ADD CONSTRAINT candidati_fase_completato_ammesso_check
      CHECK (stato <> 'COMPLETATO' OR ammesso_prossima_fase IS NOT NULL);
  END IF;
END $$;
