-- Aggiunge alle fasi due testi opzionali per i label "esito" mostrati nel PDF
-- protocollo e nella tab Risultati. Fallback ai default standard ("PROMOSSO" /
-- "ELIMINATO") se NULL.
--
-- Esempi d'uso:
--   eliminatoria: testo_esito_promosso = "AMMESSO ALLA SEMIFINALE"
--   semifinale:  testo_esito_promosso = "AMMESSO ALLA FINALE"
--   finale:      testo_esito_promosso = "VINCITORE" / "AMMESSO AL PODIO"
--
-- Applicazione:
--   psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/2026_05_23_fasi_esito_labels.sql

ALTER TABLE fasi
  ADD COLUMN IF NOT EXISTS testo_esito_promosso  text,
  ADD COLUMN IF NOT EXISTS testo_esito_eliminato text;
