-- N33: un commissario con una data email è unico per concorso (email NULL
-- ammesse multiple). Indice parziale.
-- NB: fallisce se esistono già duplicati (concorso_id, email) — in tal caso
-- vanno deduplicati prima di applicare.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_commissari_concorso_email
  ON commissari (concorso_id, email)
  WHERE email IS NOT NULL;
