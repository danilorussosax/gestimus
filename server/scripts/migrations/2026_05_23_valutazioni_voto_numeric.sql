-- valutazioni.voto: da integer a numeric(5,2) per supportare voti decimali
-- (es. mezzi punti su scala ≤10 dove voteStep=0.5). Il cast integer→numeric
-- è automatico e non perde dati. precision=5,scale=2 → range [-999.99, 999.99],
-- più che sufficiente per qualsiasi scala di valutazione.
--
-- Applicazione:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_23_valutazioni_voto_numeric.sql

ALTER TABLE valutazioni
  ALTER COLUMN voto TYPE numeric(5, 2) USING voto::numeric(5, 2);
