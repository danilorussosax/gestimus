-- #4 (architect): outbox dei domain events. Side-effect (email, ecc.) pubblicati
-- nella stessa transazione della write di business e processati in background con
-- retry. RLS per tenant applicata da policies.sql (apply_tenant_rls('events')).
-- Idempotente.
CREATE TABLE IF NOT EXISTS events (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'pending',
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT events_status_check CHECK (status IN ('pending','processing','done','failed'))
);
CREATE INDEX IF NOT EXISTS idx_events_tenant  ON events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events (created_at) WHERE status = 'pending';
