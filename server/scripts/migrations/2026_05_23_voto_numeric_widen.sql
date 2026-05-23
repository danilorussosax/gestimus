-- valutazioni.voto: numeric(5,2) → numeric(6,2). La scala fase può arrivare a
-- 1000 e un voto può eguagliarla; numeric(5,2) (max 999.99) andava in overflow
-- al binding prima che il trigger clamp_voto potesse normalizzare. Idempotente.

ALTER TABLE valutazioni ALTER COLUMN voto TYPE numeric(6,2);
