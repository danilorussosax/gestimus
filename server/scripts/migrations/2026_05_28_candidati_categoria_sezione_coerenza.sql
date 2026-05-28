-- N121: coerenza gerarchica categoria → sezione per `candidati`. Lo schema
-- ammette sezione_id e categoria_id nullable senza constraint, quindi un
-- candidato può finire con categoria_id valorizzato ma sezione_id NULL (o
-- peggio, sezione_id ≠ categoria.sezione_id). Le route già derivano la sezione
-- dalla categoria a livello applicativo, ma un UPDATE diretto o un'eventuale
-- regressione bypassa il check. Il trigger qui sotto è la rete di sicurezza
-- DB-side: PRIMA del write, se categoria_id è valorizzato, forza sezione_id
-- coerente (auto-fill se NULL; reject se non coerente).
-- Idempotente: rilanciabile senza danni.

CREATE OR REPLACE FUNCTION candidati_enforce_categoria_sezione() RETURNS trigger AS $$
DECLARE
  cat_sez uuid;
BEGIN
  IF NEW.categoria_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT sezione_id INTO cat_sez FROM categorie WHERE id = NEW.categoria_id;
  IF cat_sez IS NULL THEN
    -- categoria inesistente: la FK applicativa avrebbe già rifiutato; lascia
    -- passare e fa fallire la FK (o la stessa SELECT vuota). Non blocchiamo qui.
    RETURN NEW;
  END IF;
  IF NEW.sezione_id IS NULL THEN
    -- auto-fill: candidato categoria-scoped senza sezione esplicita.
    NEW.sezione_id := cat_sez;
  ELSIF NEW.sezione_id <> cat_sez THEN
    RAISE EXCEPTION 'candidato % : sezione_id (%) non coerente con la sezione (%) della categoria (%)',
      COALESCE(NEW.id::text, '<new>'), NEW.sezione_id, cat_sez, NEW.categoria_id
      USING ERRCODE = '23514'; -- check_violation
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidati_categoria_sezione ON candidati;
CREATE TRIGGER trg_candidati_categoria_sezione
  BEFORE INSERT OR UPDATE OF sezione_id, categoria_id ON candidati
  FOR EACH ROW EXECUTE FUNCTION candidati_enforce_categoria_sezione();
