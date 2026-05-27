-- Indici reverse-lookup sulle junction table. Le PK composite sono su
-- (parentId, fkId): il parentId è coperto dal prefisso della PK, ma le query
-- sulla SECONDA colonna da sola (cascade DELETE su commissario/sezione/categoria
-- e il pre-check DELETE sezione in routes/sezioni.ts) fanno seq scan senza un
-- indice dedicato. Idempotente.

CREATE INDEX IF NOT EXISTS idx_commissioni_commissari_commissario ON commissioni_commissari (commissario_id);
CREATE INDEX IF NOT EXISTS idx_commissioni_sezioni_sezione         ON commissioni_sezioni (sezione_id);
CREATE INDEX IF NOT EXISTS idx_commissioni_categorie_categoria     ON commissioni_categorie (categoria_id);
CREATE INDEX IF NOT EXISTS idx_fasi_sezioni_sezione                ON fasi_sezioni (sezione_id);
