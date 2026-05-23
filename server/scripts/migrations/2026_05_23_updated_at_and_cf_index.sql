-- N14: colonna updated_at su tabelle che ne erano prive (sezioni, categorie,
--   criteri, commissioni, candidati_membri). I rispettivi PATCH ora la
--   aggiornano. DEFAULT now() così le righe esistenti partono valorizzate.
-- N18: indice composito (fase_id, stato) per l'UPDATE del conclude
--   (WHERE fase_id = $1 AND stato <> 'ELIMINATO').
-- Idempotente (IF NOT EXISTS).

ALTER TABLE sezioni          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE categorie        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE criteri          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE commissioni      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE candidati_membri ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_candidati_fase_fase_stato ON candidati_fase (fase_id, stato);
