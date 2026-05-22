-- Estende `iscrizioni` con i campi anagrafici/residenza/artistici/note che la
-- modale dettaglio admin (js/views/admin/iscrizioni.js) già legge ma che lo
-- schema originale non aveva. Tutti i campi sono nullable per non rompere le
-- iscrizioni esistenti.
--
-- Applicazione:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_22_iscrizioni_extend_fields.sql
-- oppure
--   npm --prefix server run db:push   (drizzle-kit applica le ALTER TABLE diff)

ALTER TABLE iscrizioni
  ADD COLUMN IF NOT EXISTS luogo_nascita      text,
  ADD COLUMN IF NOT EXISTS sesso              text,
  ADD COLUMN IF NOT EXISTS codice_fiscale     text,
  ADD COLUMN IF NOT EXISTS indirizzo          text,
  ADD COLUMN IF NOT EXISTS citta              text,
  ADD COLUMN IF NOT EXISTS cap                text,
  ADD COLUMN IF NOT EXISTS provincia          text,
  ADD COLUMN IF NOT EXISTS paese              text,
  ADD COLUMN IF NOT EXISTS anni_studio        integer,
  ADD COLUMN IF NOT EXISTS scuola_provenienza text,
  ADD COLUMN IF NOT EXISTS gruppo_nome        text,
  ADD COLUMN IF NOT EXISTS note_libere        text;
