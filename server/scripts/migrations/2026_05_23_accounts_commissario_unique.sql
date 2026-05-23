-- N118: al più UN account per commissario. Indice unique PARZIALE: gli account
-- admin/superadmin hanno commissario_id NULL e restano esclusi (più account
-- senza commissario sono ammessi). Idempotente.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_accounts_commissario
  ON accounts (commissario_id)
  WHERE commissario_id IS NOT NULL;
