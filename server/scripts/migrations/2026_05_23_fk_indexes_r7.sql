-- N60: indici sui FK sezione/categoria di candidati e iscrizioni. I pre-check
-- applicativi di DELETE sezione/categoria filtrano su queste colonne; senza
-- indice fanno seq scan su tabelle grandi. Idempotente.

CREATE INDEX IF NOT EXISTS idx_candidati_sezione   ON candidati (sezione_id);
CREATE INDEX IF NOT EXISTS idx_candidati_categoria ON candidati (categoria_id);
CREATE INDEX IF NOT EXISTS idx_iscrizioni_sezione   ON iscrizioni (sezione_id);
CREATE INDEX IF NOT EXISTS idx_iscrizioni_categoria ON iscrizioni (categoria_id);
