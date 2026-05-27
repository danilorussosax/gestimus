-- #6: scadenza del token di upload allegati (capability no-auth). Alla creazione
-- dell'iscrizione il backend imposta now()+72h; l'endpoint di upload rifiuta
-- (404) i token mancanti o scaduti. Le iscrizioni esistenti restano con NULL →
-- i loro upload_token (mai scaduti finora) vengono invalidati, comportamento
-- voluto (nessuna finestra di upload permanente). Idempotente.
ALTER TABLE iscrizioni ADD COLUMN IF NOT EXISTS upload_token_expires_at timestamptz;
