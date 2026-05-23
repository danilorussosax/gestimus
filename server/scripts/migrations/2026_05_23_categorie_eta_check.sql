-- N97: una categoria non può avere etaMin > etaMax (intervallo impossibile).
-- CHECK a livello DB come rete di sicurezza oltre alla validazione Zod (copre
-- anche il PATCH parziale su valori già esistenti). Idempotente.
-- NOT VALID: enforce sui nuovi write senza fallire su eventuali righe storiche
-- non conformi; le righe valide passano comunque.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_categorie_eta_range'
  ) THEN
    ALTER TABLE categorie
      ADD CONSTRAINT chk_categorie_eta_range
      CHECK (eta_min IS NULL OR eta_max IS NULL OR eta_min <= eta_max)
      NOT VALID;
  END IF;
END $$;
