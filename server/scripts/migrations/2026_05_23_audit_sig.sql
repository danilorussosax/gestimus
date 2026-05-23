-- M196: colonna `sig` (HMAC del contenuto riga) per la tamper-evidence
-- dell'audit. Nullable: le righe pre-feature (legacy) restano senza firma e la
-- verifica le segnala come "unsigned", non come manomesse. Idempotente.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS sig text;
ALTER TABLE platform_audit_log ADD COLUMN IF NOT EXISTS sig text;
