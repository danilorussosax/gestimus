-- Allegati iscrizione: token capability per l'upload pubblico (no-auth) degli
-- allegati, legato alla singola iscrizione. La tabella iscrizioni_allegati esiste
-- già; qui si aggiunge solo la colonna del token sull'iscrizione.
ALTER TABLE iscrizioni ADD COLUMN IF NOT EXISTS upload_token text;
