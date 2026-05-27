-- Policies RLS, grants e helper function.
-- Eseguito dopo drizzle-kit push per applicare quello che Drizzle non gestisce nativamente.
-- Idempotente: si può rilanciare senza danni.
-- Prerequisito: i ruoli gestimus_app e gestimus_super devono già esistere
-- (creati da `npm run db:bootstrap`).

-- =====================================================================
-- 0. Schema sync idempotente per colonne aggiunte dopo il push iniziale
--    (Workaround quando `drizzle-kit push` richiede conferma interattiva.)
-- =====================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ente_settings jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branding_public jsonb;
ALTER TABLE fasi ADD COLUMN IF NOT EXISTS timer_paused_at timestamptz;
ALTER TABLE fasi ADD COLUMN IF NOT EXISTS timer_bonus_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE fasi ADD COLUMN IF NOT EXISTS timer_started_for_cf_id uuid;

-- Scheduling (slot per candidato): collegamento al blocco calendario + orario.
ALTER TABLE candidati_fase ADD COLUMN IF NOT EXISTS evento_id uuid;
ALTER TABLE candidati_fase ADD COLUMN IF NOT EXISTS ora_prevista time;

-- concorsi.default_tiebreak_strategy: cascata tiebreak di default del concorso
-- (ereditata dalle fasi senza override). Array jsonb [{key,enabled}].
ALTER TABLE concorsi ADD COLUMN IF NOT EXISTS default_tiebreak_strategy jsonb;

-- fasi.tiebreak_strategy: era stata creata come TEXT, ma il frontend invia
-- un array di oggetti {key, enabled}. Convertiamo a jsonb se serve.
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_name = 'fasi' AND column_name = 'tiebreak_strategy';
  IF current_type = 'text' THEN
    EXECUTE 'ALTER TABLE fasi ALTER COLUMN tiebreak_strategy TYPE jsonb USING tiebreak_strategy::jsonb';
  END IF;
END $$;

-- =====================================================================
-- 1. Grant su schema e oggetti esistenti
-- =====================================================================

GRANT USAGE ON SCHEMA public TO gestimus_app, gestimus_super;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gestimus_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO gestimus_super;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gestimus_app, gestimus_super;

-- Default privileges per tabelle future
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gestimus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO gestimus_super;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gestimus_app, gestimus_super;

-- =====================================================================
-- 2. FK accounts.commissario_id → commissari.id
--    Aggiunta a livello SQL perché in Drizzle è forward reference circolare:
--    accounts può puntare a commissari, ma commissari non esisteva al momento
--    della definizione di accounts.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_commissario_id_fkey'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_commissario_id_fkey
      FOREIGN KEY (commissario_id) REFERENCES commissari(id) ON DELETE SET NULL;
  END IF;
END $$;

-- FK candidati_fase.evento_id → eventi_calendario.id (forward reference circolare:
-- candidati_fase è definita prima di eventi_calendario in schema.ts). Guardata
-- sull'esistenza della tabella così db:policies non esplode su DB pre-feature.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'eventi_calendario')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'candidati_fase_evento_id_fkey'
     ) THEN
    ALTER TABLE candidati_fase
      ADD CONSTRAINT candidati_fase_evento_id_fkey
      FOREIGN KEY (evento_id) REFERENCES eventi_calendario(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================================
-- 3. Helper function: setta il tenant corrente in sessione DB
--    Chiamata dal middleware Fastify in ogni transazione.
-- =====================================================================

CREATE OR REPLACE FUNCTION app_set_tenant(tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_tenant', tenant_id::text, true);
END $$;

GRANT EXECUTE ON FUNCTION app_set_tenant(uuid) TO gestimus_app, gestimus_super;

-- =====================================================================
-- 4. RLS sulle tabelle dominio tenant-scoped
--
--    Tabelle SENZA RLS (gestite solo da super-admin con BYPASSRLS):
--      - tenants, platform_config, platform_audit_log
--
--    Tutte le altre hanno il pattern:
--      ENABLE + FORCE ROW LEVEL SECURITY
--      USING/CHECK: tenant_id = NULLIF(current_setting(...), '')::uuid
--
--    NULLIF gestisce il caso "setting non impostato" senza errore di cast.
-- =====================================================================

CREATE OR REPLACE FUNCTION apply_tenant_rls(target_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  policy_name text := 'tenant_isolation_' || target_table;
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, target_table);
  EXECUTE format($f$
    CREATE POLICY %I ON %I
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  $f$, policy_name, target_table);
END $$;

-- Applico RLS a tutte le tabelle tenant-scoped
SELECT apply_tenant_rls('accounts');
SELECT apply_tenant_rls('sessions');
SELECT apply_tenant_rls('audit_log');
SELECT apply_tenant_rls('tenant_config');
SELECT apply_tenant_rls('concorsi');
SELECT apply_tenant_rls('commissari');
SELECT apply_tenant_rls('commissari_archivio');
SELECT apply_tenant_rls('candidati');
SELECT apply_tenant_rls('candidati_membri');
SELECT apply_tenant_rls('sezioni');
SELECT apply_tenant_rls('categorie');
SELECT apply_tenant_rls('commissioni');
SELECT apply_tenant_rls('commissioni_commissari');
SELECT apply_tenant_rls('commissioni_sezioni');
SELECT apply_tenant_rls('commissioni_categorie');
SELECT apply_tenant_rls('fasi');
SELECT apply_tenant_rls('fasi_sezioni');
SELECT apply_tenant_rls('criteri');
SELECT apply_tenant_rls('candidati_fase');
SELECT apply_tenant_rls('valutazioni');
SELECT apply_tenant_rls('iscrizioni');
SELECT apply_tenant_rls('iscrizioni_allegati');
SELECT apply_tenant_rls('sale');
SELECT apply_tenant_rls('eventi_calendario');
SELECT apply_tenant_rls('calendario_pubblicazioni');
-- #4 (architect): outbox eventi — scritto in req.dbTx (gestimus_app) → RLS per tenant.
SELECT apply_tenant_rls('events');
-- #9: documenti ente (regolamenti/moduli/template) — RLS per tenant.
SELECT apply_tenant_rls('documenti_ente');

-- N133: guardia anti-regressione. Le default privileges (sopra) concedono CRUD
-- a gestimus_app su OGNI tabella futura in `public`. Se una nuova tabella con
-- dati tenant venisse aggiunta dimenticando apply_tenant_rls, sarebbe esposta.
-- Qui falliamo esplicitamente l'apply delle policy se esiste una tabella con
-- colonna `tenant_id` priva di RLS abilitata+forzata → la svista emerge subito
-- (CI / db:policies) invece che in produzione.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'N133: tabelle con tenant_id senza RLS ENABLE+FORCE: % (aggiungere apply_tenant_rls)', missing;
  END IF;
END $$;

-- =====================================================================
-- 4b. Junction tenant-coherence trigger
--     Difesa in profondità: anche se l'app sbagliasse, il DB rifiuta una
--     INSERT/UPDATE su una junction se il tenant_id del record non coincide
--     con il tenant_id della parent referenziata. RLS già blocca le letture
--     cross-tenant; questo trigger blocca anche le scritture incrociate
--     (es. via dbSuper o bypass del middleware).
-- =====================================================================

CREATE OR REPLACE FUNCTION check_junction_tenant_coherence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'commissioni_commissari' THEN
    SELECT tenant_id INTO parent_tenant FROM commissioni WHERE id = NEW.commissione_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni_commissari: tenant_id mismatch (junction=% vs parent commissione=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
    SELECT tenant_id INTO parent_tenant FROM commissari WHERE id = NEW.commissario_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni_commissari: tenant_id mismatch (junction=% vs parent commissario=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
  ELSIF TG_TABLE_NAME = 'commissioni_sezioni' THEN
    SELECT tenant_id INTO parent_tenant FROM commissioni WHERE id = NEW.commissione_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni_sezioni: tenant_id mismatch';
    END IF;
    SELECT tenant_id INTO parent_tenant FROM sezioni WHERE id = NEW.sezione_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni_sezioni: sezione di tenant differente';
    END IF;
  ELSIF TG_TABLE_NAME = 'commissioni_categorie' THEN
    SELECT tenant_id INTO parent_tenant FROM commissioni WHERE id = NEW.commissione_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni_categorie: tenant_id mismatch';
    END IF;
    SELECT tenant_id INTO parent_tenant FROM categorie WHERE id = NEW.categoria_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni_categorie: categoria di tenant differente';
    END IF;
  ELSIF TG_TABLE_NAME = 'fasi_sezioni' THEN
    SELECT tenant_id INTO parent_tenant FROM fasi WHERE id = NEW.fase_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'fasi_sezioni: tenant_id mismatch';
    END IF;
    SELECT tenant_id INTO parent_tenant FROM sezioni WHERE id = NEW.sezione_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'fasi_sezioni: sezione di tenant differente';
    END IF;
  ELSIF TG_TABLE_NAME = 'candidati_fase' THEN
    -- N114: coerenza tenant verso i due parent (fase + candidato).
    SELECT tenant_id INTO parent_tenant FROM fasi WHERE id = NEW.fase_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'candidati_fase: tenant_id mismatch (junction=% vs parent fase=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
    SELECT tenant_id INTO parent_tenant FROM candidati WHERE id = NEW.candidato_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'candidati_fase: tenant_id mismatch (junction=% vs parent candidato=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
    -- evento_id nullable (scheduling): se valorizzato, deve essere dello stesso tenant.
    IF NEW.evento_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM eventi_calendario WHERE id = NEW.evento_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'candidati_fase: evento_id di tenant differente';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'eventi_calendario' THEN
    -- R15: concorso_id (NOT NULL) deve essere dello stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM concorsi WHERE id = NEW.concorso_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'eventi_calendario: concorso_id di tenant differente';
    END IF;
    -- FK nullable (fase/sezione/categoria/sala): se valorizzati, stesso tenant.
    IF NEW.fase_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM fasi WHERE id = NEW.fase_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'eventi_calendario: fase_id di tenant differente';
      END IF;
    END IF;
    IF NEW.sezione_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM sezioni WHERE id = NEW.sezione_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'eventi_calendario: sezione_id di tenant differente';
      END IF;
    END IF;
    IF NEW.categoria_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM categorie WHERE id = NEW.categoria_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'eventi_calendario: categoria_id di tenant differente';
      END IF;
    END IF;
    IF NEW.sala_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM sale WHERE id = NEW.sala_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'eventi_calendario: sala_id di tenant differente';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'valutazioni' THEN
    -- N113: coerenza tenant verso il parent candidati_fase.
    SELECT tenant_id INTO parent_tenant FROM candidati_fase WHERE id = NEW.candidato_fase_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'valutazioni: tenant_id mismatch (junction=% vs parent candidati_fase=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
  ELSIF TG_TABLE_NAME = 'accounts' THEN
    -- M166: commissario_id è nullable → verifica solo se valorizzato.
    IF NEW.commissario_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM commissari WHERE id = NEW.commissario_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'accounts: commissario_id di tenant differente';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'commissioni' THEN
    -- R15: concorso_id (NOT NULL) deve essere dello stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM concorsi WHERE id = NEW.concorso_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'commissioni: concorso_id di tenant differente';
    END IF;
    -- M166: presidente_commissario_id nullable.
    IF NEW.presidente_commissario_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM commissari WHERE id = NEW.presidente_commissario_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'commissioni: presidente di tenant differente';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('candidati', 'iscrizioni') THEN
    -- R15: concorso_id (NOT NULL) deve essere dello stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM concorsi WHERE id = NEW.concorso_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION '%: concorso_id di tenant differente', TG_TABLE_NAME;
    END IF;
    -- M166: sezione_id/categoria_id nullable.
    IF NEW.sezione_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM sezioni WHERE id = NEW.sezione_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION '%: sezione_id di tenant differente', TG_TABLE_NAME;
      END IF;
    END IF;
    IF NEW.categoria_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM categorie WHERE id = NEW.categoria_id;
      IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION '%: categoria_id di tenant differente', TG_TABLE_NAME;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'categorie' THEN
    -- R15: sezione_id NOT NULL → la sezione parent deve essere dello stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM sezioni WHERE id = NEW.sezione_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'categorie: sezione_id di tenant differente (riga=% vs sezione=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
  ELSIF TG_TABLE_NAME = 'criteri' THEN
    -- R15: fase_id NOT NULL → la fase parent deve essere dello stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM fasi WHERE id = NEW.fase_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'criteri: fase_id di tenant differente (riga=% vs fase=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
  ELSIF TG_TABLE_NAME = 'candidati_membri' THEN
    -- R15: candidato_id NOT NULL → il candidato parent deve essere dello stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM candidati WHERE id = NEW.candidato_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'candidati_membri: candidato_id di tenant differente (riga=% vs candidato=%)',
        NEW.tenant_id, parent_tenant;
    END IF;
  ELSIF TG_TABLE_NAME IN ('sezioni', 'fasi', 'commissari', 'sale', 'calendario_pubblicazioni') THEN
    -- R15: figlie dirette del concorso con concorso_id NOT NULL → stesso tenant.
    SELECT tenant_id INTO parent_tenant FROM concorsi WHERE id = NEW.concorso_id;
    IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION '%: concorso_id di tenant differente', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_junction_cc_tenant_check ON commissioni_commissari;
CREATE TRIGGER trg_junction_cc_tenant_check
  BEFORE INSERT OR UPDATE ON commissioni_commissari
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_junction_cs_tenant_check ON commissioni_sezioni;
CREATE TRIGGER trg_junction_cs_tenant_check
  BEFORE INSERT OR UPDATE ON commissioni_sezioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_junction_cca_tenant_check ON commissioni_categorie;
CREATE TRIGGER trg_junction_cca_tenant_check
  BEFORE INSERT OR UPDATE ON commissioni_categorie
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_junction_fs_tenant_check ON fasi_sezioni;
CREATE TRIGGER trg_junction_fs_tenant_check
  BEFORE INSERT OR UPDATE ON fasi_sezioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- N114: candidati_fase eredita il tenant da fase+candidato.
DROP TRIGGER IF EXISTS trg_cf_tenant_check ON candidati_fase;
CREATE TRIGGER trg_cf_tenant_check
  BEFORE INSERT OR UPDATE ON candidati_fase
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- N113: valutazioni eredita il tenant da candidati_fase.
DROP TRIGGER IF EXISTS trg_val_tenant_check ON valutazioni;
CREATE TRIGGER trg_val_tenant_check
  BEFORE INSERT OR UPDATE ON valutazioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- M166: coerenza tenant anche sui FK nullable (accounts.commissario_id,
-- commissioni.presidente_commissario_id, candidati/iscrizioni sezione+categoria).
DROP TRIGGER IF EXISTS trg_accounts_tenant_check ON accounts;
CREATE TRIGGER trg_accounts_tenant_check
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_commissioni_tenant_check ON commissioni;
CREATE TRIGGER trg_commissioni_tenant_check
  BEFORE INSERT OR UPDATE ON commissioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_candidati_tenant_check ON candidati;
CREATE TRIGGER trg_candidati_tenant_check
  BEFORE INSERT OR UPDATE ON candidati
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_iscrizioni_tenant_check ON iscrizioni;
CREATE TRIGGER trg_iscrizioni_tenant_check
  BEFORE INSERT OR UPDATE ON iscrizioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- eventi_calendario: coerenza tenant sui FK nullable (fase/sezione/categoria/sala).
DROP TRIGGER IF EXISTS trg_eventi_tenant_check ON eventi_calendario;
CREATE TRIGGER trg_eventi_tenant_check
  BEFORE INSERT OR UPDATE ON eventi_calendario
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- R15: tabelle figlie con FK NOT NULL a un parent che porta il tenant. RLS valida
-- solo il tenant_id della riga, non che il FK punti a un parent dello stesso
-- tenant (i check FK girano senza RLS). Chiudiamo il gap come per le altre figlie.
DROP TRIGGER IF EXISTS trg_categorie_tenant_check ON categorie;
CREATE TRIGGER trg_categorie_tenant_check
  BEFORE INSERT OR UPDATE ON categorie
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_criteri_tenant_check ON criteri;
CREATE TRIGGER trg_criteri_tenant_check
  BEFORE INSERT OR UPDATE ON criteri
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_candidati_membri_tenant_check ON candidati_membri;
CREATE TRIGGER trg_candidati_membri_tenant_check
  BEFORE INSERT OR UPDATE ON candidati_membri
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- R15: coerenza concorso_id (defense-in-depth) sulle figlie dirette del concorso.
DROP TRIGGER IF EXISTS trg_sezioni_tenant_check ON sezioni;
CREATE TRIGGER trg_sezioni_tenant_check
  BEFORE INSERT OR UPDATE ON sezioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_fasi_tenant_check ON fasi;
CREATE TRIGGER trg_fasi_tenant_check
  BEFORE INSERT OR UPDATE ON fasi
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_commissari_tenant_check ON commissari;
CREATE TRIGGER trg_commissari_tenant_check
  BEFORE INSERT OR UPDATE ON commissari
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_sale_tenant_check ON sale;
CREATE TRIGGER trg_sale_tenant_check
  BEFORE INSERT OR UPDATE ON sale
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

DROP TRIGGER IF EXISTS trg_calpub_tenant_check ON calendario_pubblicazioni;
CREATE TRIGGER trg_calpub_tenant_check
  BEFORE INSERT OR UPDATE ON calendario_pubblicazioni
  FOR EACH ROW EXECUTE FUNCTION check_junction_tenant_coherence();

-- =====================================================================
-- 4c. Indici performance + vincoli di integrità aggiuntivi
-- =====================================================================

-- Index composito per query frequenti su candidati_fase
CREATE INDEX IF NOT EXISTS idx_candidati_fase_fase_stato
  ON candidati_fase(fase_id, stato);

-- R15: indici sui FK ON DELETE SET NULL non indicizzati. Senza, ogni DELETE del
-- parent fa un seq-scan + lock della figlia per applicare il SET NULL → delete
-- lenti/locking di commissari/commissioni su tenant grandi.
CREATE INDEX IF NOT EXISTS idx_fasi_commissione
  ON fasi(commissione_id);
CREATE INDEX IF NOT EXISTS idx_commissioni_presidente
  ON commissioni(presidente_commissario_id);

-- R15: convalida il CHECK eta categorie se una migrazione l'ha lasciato NOT VALID
-- (drift: db push lo crea validato, vecchi DB no → righe legacy mai verificate).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_categorie_eta_range' AND NOT convalidated
  ) THEN
    ALTER TABLE categorie VALIDATE CONSTRAINT chk_categorie_eta_range;
  END IF;
END $$;

-- N26/N32: UNIQUE per-concorso su iscrizioni, PARZIALE su stato != 'RIFIUTATA'.
-- Stessa email non può avere 2 iscrizioni attive allo stesso concorso, ma può
-- ri-iscriversi dopo un rifiuto. Le righe erased hanno email per-riga univoca
-- (erased+<id>@) quindi non collidono. Migrazione dal vecchio constraint full.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_iscrizioni_concorso_email'
  ) THEN
    ALTER TABLE iscrizioni DROP CONSTRAINT uniq_iscrizioni_concorso_email;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_iscrizioni_concorso_email_active
  ON iscrizioni (concorso_id, email)
  WHERE stato <> 'RIFIUTATA';

-- =====================================================================
-- 5. Audit log append-only: revoke UPDATE e DELETE al ruolo applicativo
--    Solo il super-admin (BYPASSRLS) può cancellare in caso di GDPR.
-- =====================================================================

REVOKE UPDATE, DELETE ON audit_log FROM gestimus_app;
REVOKE UPDATE, DELETE ON platform_audit_log FROM gestimus_app;

-- =====================================================================
-- 5.b Tenant platform tables: niente accesso dal ruolo applicativo.
--    Il blocco § 1 ha eseguito `GRANT ... ON ALL TABLES IN SCHEMA public TO
--    gestimus_app`, che include tabelle senza RLS (tenants, platform_config,
--    platform_audit_log). REVOKE esplicito per limitare la blast radius in
--    caso di SQL injection o compromissione delle credenziali applicative.
--    Le route che lavorano su queste tabelle usano `dbSuper` (gestimus_super
--    con BYPASSRLS), non il pool applicativo.
-- =====================================================================

REVOKE ALL ON tenants FROM gestimus_app;
REVOKE ALL ON platform_config FROM gestimus_app;
REVOKE ALL ON platform_audit_log FROM gestimus_app;

-- =====================================================================
-- 5.c Catalogo piani + limiti di piano: controllo BILLING del super-admin.
--    `piani` (catalogo globale, no RLS) e i limiti in `tenant_config` sono
--    decisi dal super-admin (route platform via dbSuper). Un admin di tenant
--    NON deve poterseli alzare. Il blanket GRANT § 1 li aveva resi scrivibili
--    da gestimus_app → un admin (o un bug/injection sul pool app) potrebbe
--    scavalcare i limiti del piano (es. UPDATE tenant_config SET max_*).
--    - `piani`: nessun accesso dal ruolo app (l'enforcement NON lo legge).
--    - `tenant_config`: solo SELECT (plan-limits.ts legge i limiti); scrittura
--      esclusiva del super-admin.
-- =====================================================================

REVOKE ALL ON piani FROM gestimus_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_config FROM gestimus_app;

-- =====================================================================
-- 6. Trigger DB: clamp voto e freeze fase CONCLUSA
--    Sostituiscono la logica applicativa: anche un client che bypassa
--    le route HTTP non può inserire voti fuori range o modificare
--    valutazioni di una fase chiusa.
-- =====================================================================

-- Clamp voto in [0, scala_fase]
CREATE OR REPLACE FUNCTION clamp_voto_valutazione()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fase_scala integer;
BEGIN
  SELECT f.scala INTO fase_scala
    FROM candidati_fase cf
    JOIN fasi f ON f.id = cf.fase_id
    WHERE cf.id = NEW.candidato_fase_id;
  IF fase_scala IS NULL THEN
    fase_scala := 100;
  END IF;
  IF NEW.voto < 0 THEN
    NEW.voto := 0;
  ELSIF NEW.voto > fase_scala THEN
    NEW.voto := fase_scala;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clamp_voto ON valutazioni;
CREATE TRIGGER trg_clamp_voto
  BEFORE INSERT OR UPDATE ON valutazioni
  FOR EACH ROW
  EXECUTE FUNCTION clamp_voto_valutazione();

-- Freeze: nessuna scrittura su valutazioni quando la fase è CONCLUSA
CREATE OR REPLACE FUNCTION freeze_valutazione_fase_conclusa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fase_stato text;
  target_cf uuid;
BEGIN
  target_cf := COALESCE(NEW.candidato_fase_id, OLD.candidato_fase_id);
  SELECT f.stato INTO fase_stato
    FROM candidati_fase cf
    JOIN fasi f ON f.id = cf.fase_id
    WHERE cf.id = target_cf;
  IF fase_stato = 'CONCLUSA' THEN
    RAISE EXCEPTION 'fase CONCLUSA: valutazioni in sola lettura'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_freeze_valutazioni ON valutazioni;
CREATE TRIGGER trg_freeze_valutazioni
  BEFORE INSERT OR UPDATE OR DELETE ON valutazioni
  FOR EACH ROW
  EXECUTE FUNCTION freeze_valutazione_fase_conclusa();

-- Bonus: blocca anche transizioni fase CONCLUSA → IN_CORSO (no resurrection)
CREATE OR REPLACE FUNCTION freeze_fase_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.stato = 'CONCLUSA' AND NEW.stato <> 'CONCLUSA' THEN
    RAISE EXCEPTION 'fase CONCLUSA non può tornare a %', NEW.stato
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fase_no_resurrection ON fasi;
CREATE TRIGGER trg_fase_no_resurrection
  BEFORE UPDATE ON fasi
  FOR EACH ROW
  EXECUTE FUNCTION freeze_fase_state_transition();

-- =====================================================================
-- 7. H9: role='superadmin' consentito solo nel tenant piattaforma (slug
--    'platform'). Senza questo, un admin di tenant con accesso al pool app
--    (o via SQL injection) potrebbe creare un account superadmin nel proprio
--    tenant e ottenere privilegi platform-wide. Il CHECK di colonna permette
--    il valore in astratto; questo trigger lo lega al tenant corretto.
-- =====================================================================

CREATE OR REPLACE FUNCTION enforce_superadmin_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_slug text;
BEGIN
  IF NEW.role = 'superadmin' THEN
    SELECT slug INTO tenant_slug FROM tenants WHERE id = NEW.tenant_id;
    IF tenant_slug IS DISTINCT FROM 'platform' THEN
      RAISE EXCEPTION 'role superadmin consentito solo nel tenant platform (tenant slug: %)', tenant_slug
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_superadmin_tenant ON accounts;
CREATE TRIGGER trg_enforce_superadmin_tenant
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_superadmin_tenant();
