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

-- =====================================================================
-- 5. Audit log append-only: revoke UPDATE e DELETE al ruolo applicativo
--    Solo il super-admin (BYPASSRLS) può cancellare in caso di GDPR.
-- =====================================================================

REVOKE UPDATE, DELETE ON audit_log FROM gestimus_app;
REVOKE UPDATE, DELETE ON platform_audit_log FROM gestimus_app;

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
