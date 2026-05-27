-- #9: documenti dell'ente (regolamenti, moduli, template) caricati dall'admin a
-- livello di TENANT (non per-concorso). I documenti `pubblicato` sono scaricabili
-- senza auth (endpoint pubblico, risoluzione tenant dal subdomain) e serviti
-- staticamente come i loghi concorso. RLS per tenant come le altre tabelle.
-- Idempotente: si può rilanciare senza danni.
CREATE TABLE IF NOT EXISTS documenti_ente (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titolo       text NOT NULL,
  descrizione  text,
  nome_file    text NOT NULL,
  storage_key  text NOT NULL,
  public_url   text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  versione     integer NOT NULL DEFAULT 1,
  pubblicato   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documenti_ente_tenant
  ON documenti_ente (tenant_id);
-- Lista pubblica: solo i documenti pubblicati del tenant. Indice parziale piccolo.
CREATE INDEX IF NOT EXISTS idx_documenti_ente_pubblicato
  ON documenti_ente (tenant_id) WHERE pubblicato = true;

-- Grant al ruolo applicativo (le default privileges di policies.sql coprono
-- comunque le tabelle future; qui esplicitiamo per idempotenza/sicurezza se la
-- migration viene applicata su un DB dove il GRANT di default non è ancora stato
-- ri-eseguito).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON documenti_ente TO gestimus_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_super') THEN
    GRANT ALL ON documenti_ente TO gestimus_super;
  END IF;
END $$;

-- RLS per tenant. Stesso pattern di apply_tenant_rls() in policies.sql:
-- ENABLE + FORCE + policy USING/CHECK su tenant_id = current_setting('app.current_tenant').
-- Inline (non via apply_tenant_rls) così la tabella è isolata SUBITO, anche su DB
-- dove la funzione helper non fosse ancora definita al momento della migration.
ALTER TABLE documenti_ente ENABLE ROW LEVEL SECURITY;
ALTER TABLE documenti_ente FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_documenti_ente ON documenti_ente;
CREATE POLICY tenant_isolation_documenti_ente ON documenti_ente
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
