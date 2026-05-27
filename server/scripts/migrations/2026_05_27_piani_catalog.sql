-- Catalogo piani SaaS in DB (prima hard-coded in FE/BE). Tabella GLOBALE:
-- niente tenant_id → niente RLS. Gestita esclusivamente dal super-admin
-- (route /api/platform/piani). I limit_* / ppe_* / numeric nullable indicano
-- "illimitato" / "non impostato". Idempotente: si può rilanciare senza danni.
CREATE TABLE IF NOT EXISTS piani (
  key                          text PRIMARY KEY,
  nome                         text NOT NULL,
  descrizione                  text,
  prezzo                       numeric(10,2) NOT NULL DEFAULT 0,
  durata_giorni                integer,
  limit_concorsi               integer,
  limit_commissari             integer,
  limit_candidati_per_concorso integer,
  limit_iscritti_annui         integer,
  badge_color                  text,
  is_ppe                       boolean NOT NULL DEFAULT false,
  ppe_setup_per_concorso       numeric(10,2),
  ppe_per_iscritto             numeric(10,2),
  featured                     boolean NOT NULL DEFAULT false,
  attivo                       boolean NOT NULL DEFAULT true,
  ordine                       integer,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

-- Solo il ruolo super-admin gestisce il catalogo (CRUD). Nessun grant a
-- gestimus_app: l'app per-tenant non ha bisogno di leggere/scrivere i piani.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_super') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON piani TO gestimus_super;
  END IF;
END $$;

-- Il catalogo piani è ora dinamico: il vecchio CHECK enum su tenants.piano
-- (trial/starter/pro/ultra/ppe) impedirebbe di assegnare piani aggiunti a
-- runtime. La validità della chiave è garantita applicativamente (lookup su
-- `piani` in platform.ts). Drop idempotente.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_piano_check;

-- Seed dei 5 piani esistenti (valori presi dal catalogo FE frontend/src/lib/piani.ts).
-- limit_commissari / limit_candidati_per_concorso non sono nel catalogo FE → NULL.
-- ON CONFLICT DO NOTHING: non sovrascrive eventuali modifiche già fatte dall'admin.
INSERT INTO piani (
  key, nome, descrizione, prezzo, durata_giorni,
  limit_concorsi, limit_commissari, limit_candidati_per_concorso, limit_iscritti_annui,
  badge_color, is_ppe, ppe_setup_per_concorso, ppe_per_iscritto, featured, attivo, ordine
) VALUES
  (
    'trial', 'Trial gratuito',
    'Demo a tempo: 30 giorni per provare il sistema senza impegno.',
    0, 30,
    1, NULL, NULL, 5,
    'sky', false, NULL, NULL, false, true, 1
  ),
  (
    'starter', 'Starter',
    'Per chi organizza un paio di concorsi piccoli all''anno.',
    150, 365,
    2, NULL, NULL, 100,
    'emerald', false, NULL, NULL, false, true, 2
  ),
  (
    'pro', 'Pro',
    'Il piano consigliato — miglior rapporto qualità/prezzo per scuole e conservatori medi.',
    230, 365,
    5, NULL, NULL, 500,
    'brand', false, NULL, NULL, true, true, 3
  ),
  (
    'ultra', 'Ultra',
    'Volumi alti, fino a 10 concorsi e 2000 iscritti l''anno.',
    350, 365,
    10, NULL, NULL, 2000,
    'amber', false, NULL, NULL, false, true, 4
  ),
  (
    'ppe', 'Pay-per-Event',
    'Niente canone: €100 setup per ogni concorso attivato + €1 per ogni iscritto (persona fisica: un quartetto = 4 iscritti).',
    0, NULL,
    NULL, NULL, NULL, NULL,
    'slate', true, 100, 1, false, true, 5
  )
ON CONFLICT (key) DO NOTHING;
