-- M19 + M20: indici mancanti su colonne usate in filtri frequenti.
-- idx_sessions_tenant: l'auth middleware filtra le sessioni per tenant_id ad
--   ogni richiesta autenticata (prima → seq scan).
-- idx_audit_actor: query "azioni di un dato account" senza seq scan.
-- Idempotente (IF NOT EXISTS): applicabile con `psql -f` o tramite db:push.

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_account_id);
