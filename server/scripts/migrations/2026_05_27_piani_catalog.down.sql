-- Rollback di 2026_05_27_piani_catalog.sql.
DROP TABLE IF EXISTS piani;

-- Ripristina il CHECK enum hard-coded su tenants.piano (stato pre-migrazione).
-- NB: se nel frattempo qualche tenant ha ricevuto un piano fuori dall'enum,
-- questo ADD CONSTRAINT fallirà — è il comportamento atteso (il rollback
-- segnala che esistono dati incompatibili con lo schema vecchio).
ALTER TABLE tenants
  ADD CONSTRAINT tenants_piano_check
  CHECK (piano IN ('trial','starter','pro','ultra','ppe'));
