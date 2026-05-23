-- Scheduling avanzato + calendario pubblico.
-- Nuove tabelle: sale, eventi_calendario, calendario_pubblicazioni.
-- Estensione candidati_fase: evento_id + ora_prevista (slot per candidato).
--
-- Idempotente (IF NOT EXISTS). Applicazione manuale:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_23_calendario_scheduling.sql
--   poi: npm run db:policies   (RLS + trigger di coerenza tenant)

-- ---------------------------------------------------------------------------
-- sale
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  concorso_id uuid NOT NULL REFERENCES concorsi(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  indirizzo   text,
  ordine      integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_tenant   ON sale(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sale_concorso ON sale(concorso_id);

-- ---------------------------------------------------------------------------
-- eventi_calendario (blocchi pianificati)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventi_calendario (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  concorso_id             uuid NOT NULL REFERENCES concorsi(id) ON DELETE CASCADE,
  fase_id                 uuid REFERENCES fasi(id) ON DELETE SET NULL,
  sezione_id              uuid REFERENCES sezioni(id) ON DELETE SET NULL,
  categoria_id            uuid REFERENCES categorie(id) ON DELETE SET NULL,
  sala_id                 uuid REFERENCES sale(id) ON DELETE SET NULL,
  tipo                    text NOT NULL DEFAULT 'ESIBIZIONE',
  titolo                  text,
  data                    date NOT NULL,
  ora_inizio              time,
  ora_fine                time,
  durata_candidato_minuti integer,
  note                    text,
  ordine                  integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventi_calendario_tipo_check CHECK (tipo IN ('ESIBIZIONE','EVENTO'))
);
CREATE INDEX IF NOT EXISTS idx_eventi_tenant        ON eventi_calendario(tenant_id);
CREATE INDEX IF NOT EXISTS idx_eventi_concorso      ON eventi_calendario(concorso_id);
CREATE INDEX IF NOT EXISTS idx_eventi_concorso_data ON eventi_calendario(concorso_id, data);

-- ---------------------------------------------------------------------------
-- calendario_pubblicazioni (link pubblici per scope + privacy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendario_pubblicazioni (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  concorso_id        uuid NOT NULL REFERENCES concorsi(id) ON DELETE CASCADE,
  token              text NOT NULL,
  scopo              text NOT NULL,
  sezione_id         uuid REFERENCES sezioni(id) ON DELETE CASCADE,
  giorno             date,
  etichetta          text,
  attivo             boolean NOT NULL DEFAULT true,
  mostra_nomi        boolean NOT NULL DEFAULT true,
  mostra_commissione boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calpub_scopo_check CHECK (scopo IN ('CONCORSO','SEZIONE','GIORNO'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_calpub_token  ON calendario_pubblicazioni(token);
CREATE INDEX IF NOT EXISTS idx_calpub_tenant         ON calendario_pubblicazioni(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calpub_concorso       ON calendario_pubblicazioni(concorso_id);

-- ---------------------------------------------------------------------------
-- candidati_fase: slot per candidato
-- ---------------------------------------------------------------------------
ALTER TABLE candidati_fase
  ADD COLUMN IF NOT EXISTS evento_id    uuid,
  ADD COLUMN IF NOT EXISTS ora_prevista time;

-- FK candidati_fase.evento_id → eventi_calendario.id (set null).
-- Aggiunta a livello SQL: in Drizzle è forward reference (candidati_fase è
-- definita prima di eventi_calendario), come accounts.commissario_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidati_fase_evento_id_fkey'
  ) THEN
    ALTER TABLE candidati_fase
      ADD CONSTRAINT candidati_fase_evento_id_fkey
      FOREIGN KEY (evento_id) REFERENCES eventi_calendario(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_candidati_fase_evento ON candidati_fase(evento_id);
