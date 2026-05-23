-- Allineamento candidati ↔ iscrizioni: il form admin "Aggiungi candidato" deve
-- raccogliere gli stessi campi del form pubblico di iscrizione, e l'approve di
-- un'iscrizione deve propagare tutto al record candidato (oggi propagava solo
-- nome, cognome, strumento, data_nascita, nazionalita, sezione, categoria,
-- docenti, isGruppo — perdeva sesso, CF, indirizzo, anni_studio, ecc.).
--
-- Applicazione:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_23_candidati_extend_fields.sql

ALTER TABLE candidati
  ADD COLUMN IF NOT EXISTS email              text,
  ADD COLUMN IF NOT EXISTS telefono           text,
  ADD COLUMN IF NOT EXISTS sesso              text,
  ADD COLUMN IF NOT EXISTS luogo_nascita      text,
  ADD COLUMN IF NOT EXISTS codice_fiscale     text,
  ADD COLUMN IF NOT EXISTS indirizzo          text,
  ADD COLUMN IF NOT EXISTS citta              text,
  ADD COLUMN IF NOT EXISTS cap                text,
  ADD COLUMN IF NOT EXISTS provincia          text,
  ADD COLUMN IF NOT EXISTS paese              text,
  ADD COLUMN IF NOT EXISTS anni_studio        integer,
  ADD COLUMN IF NOT EXISTS scuola_provenienza text,
  ADD COLUMN IF NOT EXISTS gruppo_nome        text,
  ADD COLUMN IF NOT EXISTS note_libere        text,
  ADD COLUMN IF NOT EXISTS programma          jsonb,
  ADD COLUMN IF NOT EXISTS tutore             jsonb;
