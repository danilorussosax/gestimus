-- #7 (analisi v4): indici mancanti che causano sequential scan con dati reali.
-- Idempotente (IF NOT EXISTS). Applicazione manuale:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_27_perf_indexes_v4.sql
--
-- Le definizioni sono replicate anche in src/db/schema.ts (fonte di verità per
-- Drizzle): questa migration le applica ai DB esistenti senza db:push.

-- ---------------------------------------------------------------------------
-- 7a) FK ON DELETE SET NULL senza indice. Postgres, per applicare il SET NULL,
-- scansiona la tabella figlia alla ricerca delle righe che referenziano la riga
-- cancellata: senza indice è un seq scan. Cancellare una fase/sezione/categoria/
-- sala scansionerebbe l'intera eventi_calendario; cancellare un candidato
-- scansionerebbe l'intera iscrizioni.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_eventi_fase      ON eventi_calendario (fase_id);
CREATE INDEX IF NOT EXISTS idx_eventi_sezione   ON eventi_calendario (sezione_id);
CREATE INDEX IF NOT EXISTS idx_eventi_categoria ON eventi_calendario (categoria_id);
CREATE INDEX IF NOT EXISTS idx_eventi_sala      ON eventi_calendario (sala_id);
CREATE INDEX IF NOT EXISTS idx_iscrizioni_candidato ON iscrizioni (candidato_id);

-- calendario_pubblicazioni.sezione_id è ON DELETE CASCADE: cancellare una
-- sezione cancella le pubblicazioni collegate, e il lookup figlio fa seq scan
-- senza indice.
CREATE INDEX IF NOT EXISTS idx_calpub_sezione ON calendario_pubblicazioni (sezione_id);

-- ---------------------------------------------------------------------------
-- 7c) Token di verifica/upload risolti su ENDPOINT PUBBLICI non autenticati
-- (POST /public/iscrizioni/:token/verify e .../:uploadToken/allegati). Ogni
-- click su un'email di verifica fa oggi un full table scan di iscrizioni.
-- Indici PARZIALI (WHERE ... IS NOT NULL): solo le righe con token pendente
-- (i token vengono azzerati dopo l'uso) → indice piccolo e selettivo.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_iscrizioni_email_verification_token
  ON iscrizioni (email_verification_token)
  WHERE email_verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iscrizioni_upload_token
  ON iscrizioni (upload_token)
  WHERE upload_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7b) NON aggiunto di proposito: indici su tenant_id delle junction table
-- (commissioni_commissari, commissioni_sezioni, commissioni_categorie,
-- fasi_sezioni, iscrizioni_allegati). Ogni query reale su queste tabelle filtra
-- già per la PK composita (prefisso parent_id) o per l'indice reverse sulla
-- colonna figlia (vedi 2026_05_26_junction_reverse_indexes.sql); il predicato
-- RLS `tenant_id = current_tenant` si applica su un insieme già ridotto a poche
-- righe, non genera un seq scan autonomo. Un indice su tenant_id sarebbe quindi
-- peso di scrittura senza guadagno di lettura.
