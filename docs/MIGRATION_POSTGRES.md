# Riscrittura stack: PocketBase → PostgreSQL + Node/Fastify/Drizzle

**Status:** Specifica tecnica approvata · contesto solo-dev (nessuna produzione attiva)
**Strategia:** Restart pulito su branch parallelo, niente import dati legacy, niente maintenance window
**Stima:** ~4-5 settimane di sviluppo (no rehearsal/stabilization perché non c'è prod)

---

## 1. Executive summary

### Contesto attuale

Il sistema gira **solo in locale su macchina di sviluppo**. Nessuna VPS di produzione attiva, nessun cliente reale collegato, nessun dato da preservare. Questo cambia drasticamente la strategia rispetto a un cutover su prod: si può riscrivere lo stack senza paranoie su downtime, migrazione dati, rollback complesso o comunicazione clienti.

### Perché si riscrive

Il driver è eliminare la dipendenza da **script shell SSH** per le operazioni amministrative (provisioning, sospensione, reset password, configurazione SMTP, backup per-ente, statistiche aggregate). L'attuale multitenancy fisica di PocketBase (N binari = N istanze systemd = N file SQLite) impedisce di fare tutto da UI del super-admin perché ogni azione amministrativa è un'operazione di sistema operativo. Si vuole arrivare a un sistema dove **tutto il provisioning e ciclo di vita dei tenant avviene da UI super-admin**.

### Cosa cambia in sostanza

- **DB**: N SQLite separati → 1 PostgreSQL con multitenancy logica via `tenant_id` + Row-Level Security
- **Backend**: PocketBase + hook Goja → Node 22 + Fastify + Drizzle
- **Auth**: PB auth → Lucia v3 con cookie HttpOnly (2FA TOTP **post-migrazione** con toggle UI super-admin)
- **Realtime**: SSE di PB → Fastify SSE + Postgres `LISTEN/NOTIFY`
- **Provisioning tenant**: script shell → endpoint API + UI super-admin
- **Lifecycle tenant**: nuova logica di **soft-delete + cleanup configurabile per tenant** (gestita dal super-admin)
- **Frontend**: invariato (HTML + Tailwind + vanilla JS), unico file riscritto è `js/db.js`

### Cosa NON cambia

- Tutte le view (`js/views/*.js`)
- Algoritmi di scoring (`js/scoring.js`), RNG seedato (`js/rng.js`)
- i18n, icone, palette, service worker
- nginx wildcard + Let's Encrypt DNS-01 IONOS (quando ci sarà prod)
- Test E2E Playwright esistenti (riusati come safety net dopo il porting frontend)

---

## 2. Stack scelto

| Strato | Tecnologia | Versione |
|---|---|---|
| DB | PostgreSQL | 18.x (UUIDv7 nativo, async I/O, skip scan) |
| Runtime | Node.js | 22 LTS |
| HTTP framework | Fastify | 5.x |
| Query builder | Drizzle ORM | latest |
| Migrations | Drizzle Kit | latest |
| Auth | Lucia | v3 |
| Hash password | Argon2id | `@node-rs/argon2` |
| Validation | Zod | 3.x |
| Logger | Pino | 9.x |
| Email | Nodemailer | 6.x |
| Realtime | Fastify SSE + `pg` LISTEN/NOTIFY | — |
| Storage | Filesystem locale + nginx | — |
| Linguaggio | TypeScript strict | 5.x |
| Process manager | systemd (1 unit) | — |
| Reverse proxy | nginx (invariato) | — |

### Razionale delle scelte

- **PostgreSQL 18** vs MySQL: RLS nativa indispensabile per multitenancy logica sicura, `jsonb` con indici GIN per i `criteri` dinamici delle fasi, window functions complete per gli algoritmi di scoring statistici, `LISTEN/NOTIFY` come canale realtime gratis. UUIDv7 ottenuto via la funzione **nativa** `uuidv7()` introdotta in PG18 (chiavi primarie time-ordered che migliorano insert performance e località cache rispetto a UUIDv4 random) — questo è il motivo per cui PG18 è il minimo richiesto.
- **Drizzle** vs Sequelize/Prisma: query SQL-like leggibili, zero overhead, integrazione naturale con `SET LOCAL` per RLS, schema TypeScript first-class, migrazioni dichiarative.
- **Fastify** vs Express/Hono: maturità su VPS Node (Hono brilla su edge, qui non serve), ecosistema plugin (rate-limit, cookie, multipart, SSE, helmet) ufficiali e stabili.
- **Lucia v3** vs custom: session-based con cookie HttpOnly (più sicuro di JWT per app web), integrazione Drizzle, controllo totale (no SaaS dipendency).
- **Argon2id**: standard moderno per password hashing, sostituisce bcrypt di PB.

---

## 3. Architettura target

```
                                  ┌──────────────────────────────┐
                                  │  nginx (443/80)              │
                                  │  *.gestimus.it (wildcard)    │
                                  └──────┬───────────────────────┘
                                         │
                       ┌─────────────────┼──────────────────┐
                       │                 │                  │
            ente1.gestimus.it   ente2.gestimus.it    platform.gestimus.it
                       │                 │                  │
                       └─────────────────┼──────────────────┘
                                         │
                                  ┌──────▼──────────────┐
                                  │  gestimus-api       │
                                  │  Fastify (porta     │
                                  │  unica, es. 4000)   │
                                  │  systemd unit       │
                                  └──────┬──────────────┘
                                         │
                                  ┌──────▼──────────────┐
                                  │  PostgreSQL 18      │
                                  │  (porta 5432, local)│
                                  │  RLS su tutte le    │
                                  │  tabelle dominio    │
                                  └─────────────────────┘
```

**Risoluzione tenant**: middleware Fastify estrae il subdomain dall'host header (`ente1.gestimus.it` → tenant slug `ente1` → tenant_id) e setta `app.current_tenant` nella sessione DB della richiesta.

**Risoluzione super-admin**: subdomain `platform.gestimus.it` mappa a ruolo `superadmin` che usa una connessione DB con ruolo Postgres `BYPASSRLS`.

---

## 4. Schema PostgreSQL

> **Nota PG18:** tutte le PK usano `uuidv7()` (UUID time-ordered, novità PG18) invece di `gen_random_uuid()` (v4 random). Vantaggi: insert sequenziali sull'index B-tree (no fragmentation), località temporale (record creati vicini in tempo finiscono in pagine vicine), ordinamento naturale per data di creazione senza colonna aggiuntiva. Dove serve unpredictability massima (session ID, password reset token, recovery codes) si continua a usare `gen_random_uuid()`.

### 4.1 Tabella `tenants` (no RLS, gestita solo da superadmin)

```sql
CREATE TABLE tenants (
  id                       UUID PRIMARY KEY DEFAULT uuidv7(),
  slug                     TEXT NOT NULL UNIQUE,
  nome                     TEXT NOT NULL,
  dominio                  TEXT,
  stato                    TEXT NOT NULL CHECK (stato IN ('attivo','sospeso','archiviato')),
  piano                    TEXT NOT NULL CHECK (piano IN ('trial','starter','pro','ultra','ppe')),
  piano_scadenza           DATE,
  smtp_config              JSONB,                         -- cifrato AES-GCM
  note                     TEXT,
  -- soft-delete + cleanup
  archiviato_at            TIMESTAMPTZ,                   -- NULL = non archiviato
  cleanup_after_days       INTEGER NOT NULL DEFAULT 30
                            CHECK (cleanup_after_days >= 0 AND cleanup_after_days <= 3650),
  cleanup_scheduled_at     TIMESTAMPTZ,                   -- calcolato = archiviato_at + cleanup_after_days
  -- 2FA gating (toggle dal super-admin, applicato post-feature)
  require_2fa_admin        BOOLEAN NOT NULL DEFAULT false, -- forza 2FA agli admin di questo tenant
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_stato ON tenants(stato);
CREATE INDEX idx_tenants_cleanup ON tenants(cleanup_scheduled_at)
  WHERE archiviato_at IS NOT NULL AND cleanup_after_days > 0;
```

**Semantica `cleanup_after_days`:**
- `0` = mai cleanup automatico (archivio "permanente", utile per obblighi legali post-cessazione)
- `1..3650` = giorni dopo `archiviato_at` oltre i quali un job notturno fa hard-delete (cascade su tutte le tabelle del tenant via FK `ON DELETE CASCADE`)
- Default 30 giorni (modificabile dal super-admin per tenant)
- Una volta archiviato, il super-admin può comunque modificare `cleanup_after_days` (es. estendere o annullare il cleanup) finché il job non ha già eseguito il delete

### 4.1.bis Tabella `platform_config` (configurazione globale super-admin)

```sql
CREATE TABLE platform_config (
  id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- single row
  require_2fa_superadmin   BOOLEAN NOT NULL DEFAULT false,                -- toggle 2FA per tutti i superadmin
  default_cleanup_days     INTEGER NOT NULL DEFAULT 30,
  smtp_platform_config     JSONB,                                          -- SMTP fallback platform
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_config (id) VALUES (1);
```

### 4.2 Tabella `accounts` (auth, isolata per tenant)

```sql
CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('admin','commissario','superadmin')),
  attivo              BOOLEAN NOT NULL DEFAULT true,
  email_verified      BOOLEAN NOT NULL DEFAULT false,
  commissario_id      UUID REFERENCES commissari(id) ON DELETE SET NULL,
  -- 2FA TOTP (campi presenti già allo schema, feature attivata in fase 10)
  totp_secret         TEXT,                       -- cifrato AES-GCM quando enabled
  totp_enabled        BOOLEAN NOT NULL DEFAULT false,
  totp_recovery_codes TEXT[],                     -- 10 codici one-shot, hashed
  totp_last_used_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_accounts ON accounts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

I campi `totp_*` sono presenti dallo schema iniziale ma rimangono inutilizzati finché non si attiva la Fase 10 (2FA). Avere i campi pronti evita una migration successiva.

### 4.3 Tabelle dominio (`concorsi`, `commissari`, `candidati`, `fasi`, …)

Pattern uniforme: ogni tabella ha `id UUID`, `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, timestamps, policy RLS di isolamento.

```sql
CREATE TABLE concorsi (
  id              UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  anno            INTEGER NOT NULL CHECK (anno BETWEEN 1900 AND 2200),
  data_inizio     DATE,
  stato           TEXT CHECK (stato IN ('ATTIVO','CONCLUSO')),
  logo            TEXT,         -- path filesystem
  anonimo         BOOLEAN NOT NULL DEFAULT false,
  iscrizioni_aperte BOOLEAN NOT NULL DEFAULT false,
  iscrizioni_scadenza DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE concorsi ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_concorsi ON concorsi
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_concorsi_tenant ON concorsi(tenant_id);
```

Tabelle da creare con lo stesso pattern (tenant_id + RLS):
- `sezioni`, `categorie`, `commissioni`, `commissioni_commissari`, `commissioni_sezioni`, `commissioni_categorie`
- `commissari`, `candidati`, `candidati_membri` (per gruppi/quartetti)
- `fasi`, `fasi_sezioni`, `criteri`
- `candidati_fase`
- `valutazioni`
- `iscrizioni`, `iscrizioni_allegati`
- `audit_log` (append-only via revoke DELETE/UPDATE al ruolo applicativo)
- `tenant_config` (piani, feature flags, limiti applicativi)
- `commissari_archivio` (storico ex-commissari)

### 4.4 Vincoli di business critici (constraint a livello DB)

```sql
-- Voto sempre in [0, scala_fase]: trigger di clamp
CREATE OR REPLACE FUNCTION clamp_voto() RETURNS trigger AS $$
DECLARE max_scala INTEGER;
BEGIN
  SELECT f.scala INTO max_scala
    FROM fasi f JOIN candidati_fase cf ON cf.fase_id = f.id
    WHERE cf.id = NEW.candidato_fase_id;
  IF NEW.voto < 0 THEN NEW.voto := 0; END IF;
  IF NEW.voto > max_scala THEN NEW.voto := max_scala; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clamp_voto BEFORE INSERT OR UPDATE ON valutazioni
  FOR EACH ROW EXECUTE FUNCTION clamp_voto();

-- Freeze: niente nuove valutazioni su fase CONCLUSA
CREATE OR REPLACE FUNCTION freeze_fase_conclusa() RETURNS trigger AS $$
DECLARE stato_fase TEXT;
BEGIN
  SELECT f.stato INTO stato_fase
    FROM fasi f JOIN candidati_fase cf ON cf.fase_id = f.id
    WHERE cf.id = NEW.candidato_fase_id;
  IF stato_fase = 'CONCLUSA' THEN
    RAISE EXCEPTION 'fase CONCLUSA: valutazioni in sola lettura';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_freeze BEFORE INSERT OR UPDATE OR DELETE ON valutazioni
  FOR EACH ROW EXECUTE FUNCTION freeze_fase_conclusa();

-- Audit log append-only: revoke a livello ruolo applicativo
REVOKE UPDATE, DELETE ON audit_log FROM gestimus_app;
```

### 4.5 Indici di performance attesi

```sql
CREATE INDEX idx_valutazioni_cf_comm ON valutazioni(candidato_fase_id, commissario_id);
CREATE UNIQUE INDEX uniq_val_per_criterio ON valutazioni(candidato_fase_id, commissario_id, criterio);
CREATE INDEX idx_candidati_fase_fase ON candidati_fase(fase_id);
CREATE INDEX idx_iscrizioni_concorso ON iscrizioni(concorso_id, stato);
CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_criteri_fase ON criteri USING gin (fase_id, peso);
```

### 4.6 Ruoli Postgres

```sql
-- Ruolo applicativo: subordinato alla RLS, niente DDL
CREATE ROLE gestimus_app LOGIN PASSWORD '<random>';
GRANT CONNECT ON DATABASE gestimus TO gestimus_app;
GRANT USAGE ON SCHEMA public TO gestimus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gestimus_app;
REVOKE DELETE, UPDATE ON audit_log FROM gestimus_app;

-- Ruolo super-admin: bypassa RLS, usato dal solo modulo platform
CREATE ROLE gestimus_super LOGIN PASSWORD '<random>' BYPASSRLS;
GRANT ALL ON ALL TABLES IN SCHEMA public TO gestimus_super;
```

---

## 5. Strategia multitenant via RLS

### 5.1 Contratto della connessione

Ogni richiesta che richiede contesto tenant esegue (in transazione):

```ts
await db.execute(sql`SET LOCAL app.current_tenant = ${tenantId}`);
```

Poi tutte le query successive sono filtrate automaticamente dal DB. Anche se il programmatore dimentica un `WHERE tenant_id = ?`, la RLS impone l'isolamento.

### 5.2 Middleware Fastify

```ts
// server/middleware/tenant.ts (pseudo)
app.addHook('onRequest', async (req) => {
  const subdomain = extractSubdomain(req.headers.host);  // 'ente1'
  if (subdomain === 'platform') {
    req.tenant = null;  // route super-admin
    return;
  }
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, subdomain)
  });
  if (!tenant || tenant.stato !== 'attivo') {
    throw new HttpError(404, 'tenant non trovato o sospeso');
  }
  req.tenant = tenant;
});
```

Ogni handler esegue le query dentro `db.transaction(async tx => { await tx.execute(sql\`SET LOCAL...\`); ... })`.

### 5.3 Connection pool separato per superadmin

Due pool: `dbApp` (ruolo `gestimus_app`, RLS attiva), `dbSuper` (ruolo `gestimus_super`, BYPASSRLS). Le route super-admin usano `dbSuper`. Tutte le altre `dbApp`.

### 5.4 Test di isolamento RLS

Suite di test dedicata in `server/tests/rls.test.ts`: per ogni tabella, crea record nei tenant A e B, autentica come A, verifica `SELECT COUNT(*) FROM ...` = solo i record di A. Test obbligatorio prima del cutover.

---

## 6. Struttura del repository post-migrazione

```
gestimus/
├── server/                         # NUOVO backend Node
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   ├── src/
│   │   ├── index.ts                # bootstrap Fastify
│   │   ├── env.ts                  # parsing env con Zod
│   │   ├── db/
│   │   │   ├── client.ts           # dbApp + dbSuper
│   │   │   ├── schema.ts           # Drizzle schema TS (mirror SQL)
│   │   │   └── migrations/         # *.sql generate da drizzle-kit
│   │   ├── middleware/
│   │   │   ├── tenant.ts
│   │   │   ├── auth.ts
│   │   │   ├── ratelimit.ts
│   │   │   └── audit.ts
│   │   ├── routes/
│   │   │   ├── auth.ts             # login/logout/refresh
│   │   │   ├── setup.ts            # probe + create-admin
│   │   │   ├── concorsi.ts
│   │   │   ├── commissari.ts
│   │   │   ├── candidati.ts
│   │   │   ├── fasi.ts
│   │   │   ├── valutazioni.ts
│   │   │   ├── iscrizioni.ts       # form pubblico + workflow
│   │   │   ├── privacy.ts          # GDPR export/erase
│   │   │   ├── realtime.ts         # SSE timer fase
│   │   │   └── superadmin/
│   │   │       ├── tenants.ts      # CRUD enti (sostituisce provision-tenant.sh)
│   │   │       ├── smtp.ts         # config SMTP cifrato
│   │   │       ├── stats.ts        # aggregate cross-tenant
│   │   │       └── backup.ts       # pg_dump per-tenant
│   │   ├── services/
│   │   │   ├── crypto-smtp.ts      # AES-GCM (portato 1:1 da pb_hooks)
│   │   │   ├── email.ts            # nodemailer + risoluzione SMTP per tenant
│   │   │   ├── scoring.ts          # riusa logica di js/scoring.js
│   │   │   ├── rng.ts              # riusa logica di js/rng.js
│   │   │   └── audit.ts            # write append-only audit_log
│   │   ├── realtime/
│   │   │   └── listen.ts           # LISTEN/NOTIFY hub
│   │   └── tests/
│   │       ├── rls.test.ts
│   │       ├── auth.test.ts
│   │       └── ...
│   └── scripts/
│       ├── migrate-pb-to-pg.ts     # importa N pb_data SQLite in Postgres
│       └── verify-import.ts        # confronto conteggi
├── js/                             # frontend (invariato tranne db.js)
│   ├── api.js                      # NUOVO: client REST verso /server
│   ├── db.js                       # RISCRITTO: stesse firme, usa api.js
│   ├── views/                      # invariati
│   └── ...
├── deploy/
│   ├── gestimus-api.service        # NUOVO systemd unit
│   ├── postgresql.conf.snippet     # tuning per VPS L+
│   ├── nginx-tenant.conf.template  # AGGIORNATO: proxy_pass a :4000
│   └── ...
├── docs/
│   ├── MIGRATION_POSTGRES.md       # questo file
│   └── ...
└── pb_*/                           # DA RIMUOVERE dopo cutover
```

---

## 7. Backend: organizzazione moduli

### 7.1 Pattern di route

```ts
// server/src/routes/concorsi.ts (esempio)
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { concorsi } from '../db/schema';

const concorsiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/concorsi', { preHandler: [authRequired] }, async (req) => {
    return req.dbTx(async (tx) => {
      return await tx.select().from(concorsi);
      // RLS filtra automaticamente per tenant_id
    });
  });

  app.post('/concorsi', {
    preHandler: [authRequired, requireRole('admin')],
    schema: { body: z.object({ nome: z.string(), anno: z.number().int() }) }
  }, async (req) => {
    return req.dbTx(async (tx) => {
      const [c] = await tx.insert(concorsi).values({
        ...req.body,
        tenant_id: req.tenant.id,
      }).returning();
      await audit(tx, req, 'concorso.create', { id: c.id });
      return c;
    });
  });
};
```

`req.dbTx` è un helper che apre transazione, esegue `SET LOCAL app.current_tenant`, e committa.

### 7.2 Auth con Lucia

- Login: POST `/auth/login` → verifica password Argon2id, crea sessione, set cookie HttpOnly `Secure` `SameSite=Strict`
- Logout: POST `/auth/logout` → invalida session
- Sessione: tabella `sessions(id, user_id, tenant_id, expires_at)` gestita da Lucia
- Middleware `authRequired`: legge cookie → carica session → attacca `req.user` e `req.tenant`

### 7.3 Rate-limit

`@fastify/rate-limit` con store Postgres-backed o in-memory + sticky per IP. Configurazione differenziata per route:
- `/iscrizioni` form pubblico: 3/h, 10/giorno per IP
- `/auth/login`: 10/min per IP
- altre route autenticate: 600/min per utente

---

## 8. Mapping moduli PB → nuovo backend

| Modulo PB attuale | Sostituito da | Note |
|---|---|---|
| `pb_hooks/accounts.pb.js` | `middleware/auth.ts` + `routes/auth.ts` | Anti self-promote = check `req.user.role !== 'superadmin'` prima di update role |
| `pb_hooks/iscrizioni.pb.js` | `routes/iscrizioni.ts` + `middleware/ratelimit.ts` | Honeypot + min-time-on-page + token email rigenerato server-side |
| `pb_hooks/valutazioni.pb.js` | Trigger DB `clamp_voto` + `freeze_fase_conclusa` | Logica si sposta nel DB, più solida |
| `pb_hooks/tenants.pb.js` | `services/crypto-smtp.ts` + `routes/superadmin/smtp.ts` | Codice AES-GCM riusato quasi 1:1 |
| `pb_hooks/privacy.pb.js` | `routes/privacy.ts` | Export/erase GDPR |
| `pb_hooks/setup.pb.js` | `routes/setup.ts` | Probe admin + create-admin per onboarding |
| `pb_hooks/fasi.pb.js` | `routes/fasi.ts` + trigger DB su transizioni | Transizioni stato fase |
| `pb_hooks/tenant_config.pb.js` | `services/plan-gating.ts` | Middleware che applica limiti del piano (max enti, max concorsi, ecc.) |
| `pb_migrations/*.js` (42 file) | `server/src/db/migrations/*.sql` (Drizzle Kit) | Schema consolidato in 1-2 migration iniziali; nuove come incrementali |
| `js/pb.js` | Cancellato | |
| `js/db.js` (1748 righe) | Riscritto come client REST + `js/api.js` | Stesse firme delle funzioni esportate |
| `scripts/provision-tenant.sh` | `routes/superadmin/tenants.ts` POST | UI super-admin |
| `scripts/remove-tenant.sh` | `routes/superadmin/tenants.ts` DELETE | UI super-admin |
| `scripts/apply-ente-smtp.sh` | `routes/superadmin/smtp.ts` POST | UI super-admin |
| `scripts/encrypt-existing-smtp.mjs` | Cancellato (one-shot, già applicato) | |

---

## 9. Frontend: l'adapter `js/db.js`

`js/db.js` espone oggi ~80 funzioni (CRUD su collezioni PB + RPC custom). La riscrittura mantiene **firme identiche** in modo che le 12+ view in `js/views/*.js` non richiedano modifiche.

### 9.1 Pattern di chiamata

```js
// js/api.js (NUOVO)
const API_BASE = '/api';

async function apiCall(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',  // invia cookie sessione
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (p) => apiCall('GET', p),
  post: (p, b) => apiCall('POST', p, b),
  patch: (p, b) => apiCall('PATCH', p, b),
  delete: (p) => apiCall('DELETE', p),
  // SSE
  subscribe: (p, onMessage) => {
    const es = new EventSource(`${API_BASE}${p}`, { withCredentials: true });
    es.onmessage = (ev) => onMessage(JSON.parse(ev.data));
    return () => es.close();
  },
};
```

```js
// js/db.js (RISCRITTO, firme identiche)
import { api } from './api.js';

export async function getConcorsi() {
  return api.get('/concorsi');
}
export async function createConcorso(data) {
  return api.post('/concorsi', data);
}
// ... etc
```

### 9.2 Realtime

PB usa `pb.collection(...).subscribe(...)` per il timer fase. Nuovo: `api.subscribe('/realtime/fase/:id', cb)` che si connette via SSE; il server emette eventi quando riceve `NOTIFY fase_timer` da Postgres.

### 9.3 File upload

PB: form-data al collection endpoint. Nuovo: `POST /api/upload/:resource` con `multipart/form-data`, ritorna path/URL. Le view che usano upload (logo concorso, foto candidato, allegati iscrizione) vengono aggiornate solo per la nuova URL.

---

## 10. Realtime via Postgres LISTEN/NOTIFY

### 10.1 Modello

- Timer fase: quando il presidente fa partire/fermare il timer di una fase, il backend esegue `NOTIFY fase_timer, '{"fase_id":"...","action":"start","at":1234567}'`.
- Hub Node: connessione dedicata `LISTEN fase_timer`, su ogni notifica fa fan-out ai client SSE iscritti a quella fase.
- Subscription per client: GET `/realtime/fase/:id` apre EventSource, l'hub gli inoltra solo eventi della propria `fase_id`.

### 10.2 Vantaggi

- Niente Redis o broker esterno
- Tenant-aware (NOTIFY include `tenant_id`, hub filtra)
- Single point of truth (DB)
- Reconnect lato client gestito da `EventSource` automaticamente

---

## 11. Storage file

### 11.1 Filesystem strutturato per tenant

```
/var/lib/gestimus/uploads/
├── <tenant_slug>/
│   ├── concorsi/<concorso_id>/logo.webp
│   ├── candidati/<candidato_id>/foto.webp
│   ├── candidati/<candidato_id>/cv.pdf
│   └── iscrizioni/<iscrizione_id>/allegati/<n>.pdf
```

nginx serve `/uploads/<tenant_slug>/...` con `try_files` + Cache-Control privato.
Backend valida che l'utente abbia accesso al tenant prima di restituire URL firmate (oppure ACL via nginx `auth_request`).

### 11.2 Limiti

- Foto: max 2MB, JPEG/PNG/WEBP, processate con `sharp` per resize a max 800px lato lungo
- CV/allegati: max 5MB, PDF/DOC/DOCX
- Antivirus: ClamAV opzionale (Fase 2 post-migrazione, non bloccante)

---

## 12. Email

Modulo `services/email.ts`:
1. Risolve SMTP del tenant: legge `tenants.smtp_config`, decifra AES-GCM, costruisce transport Nodemailer
2. Cache transport in-memory per tenant (TTL 5 min)
3. Fallback: se tenant non ha SMTP configurato, usa SMTP della platform (variabile env)
4. Tutte le email passano da template (Mustache o Eta) con i18n

Caso d'uso: verifica email iscrizioni, notifica candidato approvato, password reset, alert audit.

---

## 13. Dati iniziali: seed demo invece di migrator

Poiché il sistema gira solo in locale di sviluppo e non ci sono dati di produzione da preservare, **non si fa un migrator** dai vecchi `pb_data_*`. Si parte con schema vuoto + seed script per ambiente di dev.

### 13.1 Script `seed-dev.ts`

Genera dati di esempio per testing/sviluppo locale:

- 1 super-admin (`admin@platform.local` / password `admin123`)
- 3 tenant esempio: `ente1`, `ente2`, `ente3` (stati: `attivo`, `attivo`, `sospeso`)
- Per ogni tenant: 1 admin, 5 commissari, 10 candidati, 1 concorso con 2 fasi e criteri di esempio
- 1 tenant `ente-archiviato` in stato `archiviato` con `cleanup_after_days = 30` e `archiviato_at` 5 giorni fa (per testare il cleanup job senza farlo scattare)
- Configurazione 2FA: tutti gli account con `totp_enabled = false` di default

### 13.2 Mantenimento codice legacy durante lo sviluppo

Per non perdere riferimenti utili durante il porting:
- Lo stack PB attuale (`pb_hooks/`, `pb_migrations/`, `pocketbase/`, `pb_data*/`) resta in un branch `legacy-pb` come archivio consultabile
- Il branch `main` perde tutto questo nella prima commit della Fase 0 (sostituito da `server/`)
- Le 42 migration PB sono state già consultate per estrarre lo schema dominio → vedi sezione 4

### 13.3 Mapping concettuale per chi consulta il legacy

| Concetto PB | Equivalente PG |
|---|---|
| 15-char ID PB | UUID v4 |
| `created`/`updated` string ISO | `created_at`/`updated_at TIMESTAMPTZ` |
| `relation` field | `FK UUID` con `ON DELETE CASCADE/SET NULL` |
| `json` field | `jsonb` |
| `select` field con valori | `TEXT CHECK (x IN (...))` o enum Postgres |
| `file` field | path filesystem in colonna `TEXT` |
| collection `*Rule` | RLS policy + check applicativo |

---

## 14. Test plan

### 14.1 Pre-cutover (ambiente staging)

**Test unitari (Node `--test`):**
- `services/scoring.test.ts` — porting di `tests/unit/scoring.test.js`
- `services/rng.test.ts` — RNG seedato riproducibile
- `services/crypto-smtp.test.ts` — round-trip cifratura

**Test di RLS (`rls.test.ts`):**
- Crea tenant A e B con dati duplicati
- Autentica come admin tenant A → SELECT * FROM concorsi → solo righe A
- Per ogni tabella dominio, stessa verifica
- Test attacco: tenta INSERT con `tenant_id` di B → DB rifiuta
- Test bypass: ruolo `gestimus_super` vede entrambi

**Test E2E Playwright (riuso esistente + nuovi):**
- Login admin
- Crea concorso, sezione, categoria, commissari, candidati
- Configura fase, valuta candidato come commissario, verifica calcolo media
- Form iscrizione pubblica end-to-end
- **NUOVO**: super-admin crea nuovo ente da UI → ente è subito utilizzabile

**Test di carico:**
- `k6` o `autocannon` su `/concorsi`, `/valutazioni`, `/iscrizioni`: target 200 RPS sostenuti, p95 < 100ms
- Stress su VPS L+ per verificare che 8GB RAM bastino

**Test migrator:**
- Su staging con 3 cloni `pb_data_*` reali (anonimizzati)
- Verify script deve passare al 100%

### 14.2 Pre-cutover (produzione, finestra di freeze)

- Snapshot di tutti i `pb_data_*` (tar.gz)
- Snapshot DB Postgres staging
- Verifica connectivity tra `gestimus-api` e Postgres
- Verifica nginx config in modalità "draft" (`nginx -t`)

### 14.3 Post-cutover (smoke test)

- Login admin di 3 tenant random → OK
- Crea record di test → OK
- Verifica email funzionante (invio test)
- Verifica realtime timer (apri 2 browser, start timer su uno, l'altro riceve)
- Verifica super-admin: crea tenant test → accessibile → cancella

---

## 15. Setup ambiente dev e bring-up locale

Niente cutover di produzione perché non c'è produzione. Il "deploy" è il setup dell'ambiente di sviluppo locale.

### 15.1 Bring-up locale (una volta, ~30 minuti)

```bash
# 1. Postgres 18 locale (macOS via Homebrew)
brew install postgresql@18
brew services start postgresql@18

# 2. Crea DB + ruoli
psql -d postgres <<SQL
CREATE DATABASE gestimus;
CREATE ROLE gestimus_app LOGIN PASSWORD 'devpassword';
CREATE ROLE gestimus_super LOGIN PASSWORD 'devpassword' BYPASSRLS;
GRANT CONNECT ON DATABASE gestimus TO gestimus_app, gestimus_super;
SQL

# 3. Apply migrations
cd server
npm install
npm run db:migrate    # esegue drizzle-kit migrate

# 4. Seed demo data
npm run db:seed       # esegue scripts/seed-dev.ts

# 5. Start backend
npm run dev           # tsx watch src/index.ts
```

### 15.2 Hosts locale per subdomain dev

Aggiungere a `/etc/hosts`:
```
127.0.0.1 platform.gestimus.local
127.0.0.1 ente1.gestimus.local
127.0.0.1 ente2.gestimus.local
127.0.0.1 ente3.gestimus.local
```

`scripts/start-local-dev.sh` lancia Caddy in modalità reverse-proxy per servire `*.gestimus.local` → `127.0.0.1:4000`, così il middleware di risoluzione tenant funziona identico a come funzionerà in prod.

### 15.3 Comandi npm previsti

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx scripts/seed-dev.ts",
    "db:reset": "tsx scripts/reset-dev.ts",
    "test": "node --test --import tsx tests/**/*.test.ts",
    "test:rls": "node --test --import tsx tests/rls/*.test.ts",
    "lint": "tsc -p . --noEmit"
  }
}
```

### 15.4 Quando ci sarà la produzione

Il piano di deploy su VPS verrà definito in un documento separato (`docs/DEPLOY-IONOS-V2.md`) quando il sistema sarà pronto per il primo cliente reale. Stack di deploy previsto: systemd unit per `gestimus-api`, Postgres su stessa VPS L+, nginx reverse proxy wildcard, backup notturno `pg_dump`. Non bloccante per il lavoro attuale.

---

## 16. "Rollback" durante lo sviluppo

Concetto non applicabile come in produzione, dato che non c'è prod da rompere. Le contromisure sono di tipo dev:

- Tutto il porting su un branch `feature/postgres-migration`; `main` resta sul codice PB finché il nuovo non passa tutti i test
- Database locale: `npm run db:reset` ricrea schema + seed in 30 secondi
- Branch `legacy-pb` come archivio consultabile della codebase precedente
- Niente conservazione di backup pluri-settimanali, niente switch nginx di emergenza

Il vero "rollback" qui è: se il nuovo stack non convince, si torna su `main` e basta. Costo: il tempo speso, non i dati persi.

---

## 17. Soft-delete tenant e cleanup configurabile

### 17.1 Modello dati

Già nello schema (sezione 4.1): la tabella `tenants` ha `archiviato_at TIMESTAMPTZ` (NULL = attivo) e `cleanup_after_days INTEGER` (default 30, range 0-3650).

### 17.2 Stati del ciclo di vita

```
       ┌────────────┐  archivia       ┌──────────────┐  cleanup
       │  attivo    │  ──────────────►│  archiviato  │  ──────►  hard-deleted
       └────┬───────┘                 └──────┬───────┘           (record sparito)
            │                                │
            │ sospendi/riattiva              │ ripristina (entro window)
            ▼                                │
       ┌────────────┐                        │
       │  sospeso   │ ◄──────────────────────┘
       └────────────┘  (riattivazione torna ad attivo, non archiviato)
```

Stati:
- **`attivo`** = funzionante, login possibile, traffico ammesso
- **`sospeso`** = login bloccato, dati intatti, nessun cleanup programmato; usato per morosità/violazioni TOS, reversibile in 1 click
- **`archiviato`** = login bloccato, `archiviato_at` settato, hard-delete programmato dopo `cleanup_after_days`; reversibile finché il job di cleanup non scatta

### 17.3 Operazioni del super-admin

| Azione UI | Effetto SQL |
|---|---|
| Sospendi | `UPDATE tenants SET stato='sospeso' WHERE id=?` |
| Riattiva (da sospeso) | `UPDATE tenants SET stato='attivo' WHERE id=?` |
| Archivia | `UPDATE tenants SET stato='archiviato', archiviato_at=now(), cleanup_scheduled_at = now() + (cleanup_after_days \|\| ' days')::interval WHERE id=?` |
| Modifica `cleanup_after_days` (anche se già archiviato) | `UPDATE` + ricalcola `cleanup_scheduled_at` |
| Ripristina (da archiviato) | `UPDATE tenants SET stato='attivo', archiviato_at=NULL, cleanup_scheduled_at=NULL WHERE id=? AND archiviato_at IS NOT NULL` |
| Cancella subito (override) | `DELETE FROM tenants WHERE id=?` — cascade su tutte le tabelle dominio |

UI super-admin mostra per ogni tenant archiviato un countdown ("hard-delete tra X giorni") e i pulsanti **Ripristina** + **Modifica timeout cleanup** + **Cancella subito**.

### 17.4 Job di cleanup automatico

Job notturno (es. ore 03:00 ora server) che esegue:

```sql
DELETE FROM tenants
 WHERE archiviato_at IS NOT NULL
   AND cleanup_after_days > 0
   AND cleanup_scheduled_at <= now();
```

Il `cleanup_after_days = 0` significa "mai", quindi è escluso dalla query.

**Schedulazione opzioni:**
- **Opzione A — node-cron** in-process Fastify (semplice, no dipendenze esterne)
- **Opzione B — pg_cron** extension Postgres (più robusto, sopravvive a restart app)
- **Scelta consigliata: Opzione A** per ora (semplice), valutare B se gli ambienti scalano. Lo log finisce in `audit_log`.

### 17.5 Audit

Ogni transizione di stato (archivia/sospendi/riattiva/ripristina/hard-delete) emette una riga in `audit_log` con:
- `actor_id` = super-admin che ha agito
- `action` = `tenant.archive` / `tenant.suspend` / `tenant.restore` / `tenant.hard_delete` / `tenant.cleanup_auto`
- `target_tenant_id`, `payload` (stato precedente/nuovo)

Il record `audit_log` del tenant cancellato resta in `platform_audit_log` (vedi sotto), perché l'`audit_log` interno del tenant cascade-cancella con il tenant. → Servono **due audit log distinti**:
- `audit_log` per tenant (RLS-protected, cascade-deletato)
- `platform_audit_log` per super-admin (no tenant_id, sopravvive sempre)

### 17.6 Backup pre-hard-delete (raccomandato)

Prima di un hard-delete automatico il job esegue `pg_dump --schema=public --table='*' --where="tenant_id='<uuid>'"` e salva in `/var/lib/gestimus/archive/<slug>-<timestamp>.sql.gz`. Conservazione 90 giorni. Permette restore manuale del super-admin in caso di errore (cleanup configurato troppo aggressivo, ripensamento del cliente, ecc.).

UI super-admin: pagina "Archivio dump" con lista dei dump disponibili + bottone "Restore" che chiede conferma + ricrea il tenant + reinserisce i record.

---

## 18. 2FA TOTP (Fase 10 post-migrazione)

### 18.1 Modello e gating

Toggle a 2 livelli:
- **Globale super-admin**: `platform_config.require_2fa_superadmin` — se ON, tutti gli account con `role='superadmin'` devono completare setup TOTP al prossimo login
- **Per tenant**: `tenants.require_2fa_admin` — se ON, tutti gli admin di quel tenant devono completare setup TOTP al prossimo login

Il super-admin gestisce entrambi dalla sua UI:
- Pagina "Sicurezza piattaforma" → toggle `require_2fa_superadmin` + setup proprio TOTP
- Pagina "Ente → Sicurezza" → toggle `require_2fa_admin` per il tenant selezionato

Commissari: 2FA opzionale (può attivarlo l'admin del tenant in modo per-utente, non c'è gating obbligatorio sul ruolo).

### 18.2 Flusso utente

1. Login con email+password come oggi
2. Se `totp_enabled=false` e gating attivo: redirect a `/auth/2fa-setup` → mostra QR code + secret → utente conferma scansionando con Google Authenticator/Authy → backend verifica 1 codice → setta `totp_enabled=true` + genera 10 recovery codes (mostrati una volta sola, hash salvati)
3. Se `totp_enabled=true`: dopo password, richiesta codice TOTP a 6 cifre → verifica con tolleranza ±1 step (30s)
4. Recovery code: link "Non ho il telefono" su pagina TOTP → input codice recovery → consuma 1 codice (hash invalidato) → login OK + email di alert all'utente

### 18.3 Schema (già pronto)

Campi `accounts.totp_*` già definiti in sezione 4.2. Quando si attiva la Fase 10, basta:
- Cifrare `totp_secret` con la chiave già usata per SMTP (`GESTIMUS_SECRET_KEY`)
- Implementare le route `/auth/2fa-setup`, `/auth/2fa-verify`, `/auth/2fa-disable`, `/auth/recovery-codes/regenerate`
- Implementare middleware `require2FAIfGated` che intercetta login e forza il setup se serve
- Nessuna migration aggiuntiva

### 18.4 Dipendenza

Libreria: `@oslojs/otp` (raccomandata, manutenuta dal team Lucia) oppure `otplib` (più diffuso). QR code: `qrcode` npm package.

### 18.5 Stima

2 giorni di sviluppo + 1 giorno di test (UI + flussi recovery). Non bloccante per il bring-up iniziale: si fa quando la migrazione principale è chiusa.

---

## 19. Cosa NON migra (e diventa nuovo)

| Vecchio | Nuovo |
|---|---|
| `provision-tenant.sh` (SSH richiesto) | Super-admin UI: pagina "Enti" → bottone "Nuovo ente" |
| `remove-tenant.sh` (SSH richiesto) | Super-admin UI: bottone "Archivia ente" + soft-delete + hard-delete dopo 30gg |
| `apply-ente-smtp.sh` (SSH richiesto) | Super-admin UI: pagina ente → tab "SMTP" |
| `encrypt-existing-smtp.mjs` | One-shot già applicato; cancellato |
| `start-local-multitenant.sh` | `docker-compose.dev.yml`: Postgres + gestimus-api + caddy dev |
| `setup-server.sh` | Aggiornato per Postgres install + `GESTIMUS_SECRET_KEY` in `.env` |
| Backup tar per-tenant | UI super-admin: "Esporta backup" → `pg_dump` filtrato per `tenant_id` |
| Restore tar per-tenant | UI super-admin: "Importa backup" → upload `.sql` + restore in transazione |

---

## 20. Stime e milestone

Stime ricalcolate per contesto solo-dev (nessuna fase di rehearsal/staging/stabilization perché non c'è prod).

| Fase | Durata | Output |
|---|---|---|
| 0. Setup + POC | 3 giorni | Repo `server/`, Postgres locale, schema `tenants`+`concorsi` + RLS + 1 endpoint funzionante |
| 1. Schema completo + auth | 5 giorni | Tutte le tabelle + Lucia + login/logout funzionante |
| 2. Routes CRUD dominio | 7 giorni | Endpoint per tutte le entità + middleware tenant |
| 3. Trigger + validazione + audit | 4 giorni | Clamp/freeze + audit_log + platform_audit_log + GDPR |
| 4. Realtime + storage + email | 4 giorni | SSE timer + file upload + email tenant-aware |
| 5. Frontend adapter `db.js` | 5 giorni | Tutte le view funzionano contro nuovo backend |
| 6. Super-admin UI | 6 giorni | Gestione enti, SMTP, stats, **soft-delete + cleanup config**, backup/restore da UI |
| 7. Seed demo + smoke E2E | 2 giorni | Script `seed-dev.ts` + suite Playwright porting su nuovo backend |
| 8. Test E2E pieni + RLS | 4 giorni | Suite Playwright completa + test RLS isolation 100% tabelle |
| 9. Polish + bug-fix | 3 giorni | Catch-up bug minori, refactor, cleanup |
| **— Fine migrazione principale —** | | |
| 10. 2FA TOTP (post-migrazione) | 3 giorni | Setup TOTP + recovery codes + toggle UI super-admin |

**Totale fasi 0-9: ~43 giorni → ~9 settimane part-time o ~4-5 settimane full-time.**
**Fase 10 (2FA): +3 giorni quando si vuole attivare la feature.**

---

## 21. Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Bug RLS = data leak cross-tenant | Bassa | Critico | Suite test RLS obbligatoria, 100% tabelle, in CI |
| Bug nel cleanup job = perdita dati | Bassa | Critico | Backup pre-hard-delete (`pg_dump --where`) automatico in `/var/lib/gestimus/archive/` (90gg retention) |
| Bug `js/db.js` riscritto rompe view | Media | Medio | Mantenere firme identiche, suite Playwright come safety net |
| Realtime SSE meno robusto di PB | Bassa | Basso | `EventSource` ha reconnect nativo, `LISTEN/NOTIFY` è stabile in PG |
| Lucia v3 ha breaking change | Bassa | Basso | Pinning versione, no auto-upgrade |
| 2FA TOTP rallenta login admin | Bassa | Basso | Recovery codes + UI per disabilitare se necessario (super-admin override) |
| Sovrapposizione di feature in dev (es. cambi schema durante porting) | Media | Medio | Tutto su branch `feature/postgres-migration`, no merge intermedi su `main` |

---

## 22. Decisioni aperte (residue)

Decisioni già chiuse:
- ✅ **Strategia rollout**: restart pulito su branch, niente migrazione dati da PB (no prod attiva)
- ✅ **2FA**: post-migrazione (Fase 10) con toggle UI super-admin per tenant + super-admin stesso
- ✅ **Soft-delete tenant**: progettato in sezione 17, integrato nel piano da subito
- ✅ **Comunicazione clienti / maintenance window**: non applicabile (no prod)
- ✅ **Stack**: PostgreSQL 18 + Node 22 + Fastify 5 + Drizzle + sessioni server-side custom (cookie HttpOnly + Argon2id) + TypeScript strict

Residue (non bloccanti per partire):
- [ ] **Nome subdomain super-admin**: `platform.gestimus.local` per dev. In prod sarà `platform.gestimus.it` o `admin.gestimus.it`?
- [ ] **Job scheduler cleanup**: `node-cron` in-process (semplice) o `pg_cron` extension (più robusto)? → default raccomandato: `node-cron`
- [ ] **Backup pre-hard-delete**: conservazione default 90gg + path `/var/lib/gestimus/archive/`. Modificare?
- [ ] **Domain validation**: oggi manuale, vale la pena aggiungere DNS check automatico in super-admin (quando un tenant configura un dominio custom)?
- [ ] **Anti-malware allegati iscrizioni**: ClamAV in Fase 4 o post? → default: post
- [ ] **CSRF protection**: cookie SameSite=Strict basta o aggiungere token sincronizzatore? → default: SameSite=Strict è sufficiente

---

## 23. Riferimenti

- PocketBase migrations attuali: `pb_migrations/1700000001_init.js` … `1700000042_*.js`
- PocketBase hooks attuali: `pb_hooks/*.pb.js`
- Frontend data layer: `js/db.js` (1748 righe, da riscrivere)
- Schema dati storico: `Schema_Gestionale_Concorso_Musicale.docx`
- Deploy attuale: [`DEPLOY-IONOS.md`](DEPLOY-IONOS.md)
- Backend reference: [`../server/README.md`](../server/README.md)
- Listino commerciale: [`LISTINO.md`](LISTINO.md)
- Strategie storiche (archiviate): [`ARCHIVED_multitenant-physical-strategy.md`](ARCHIVED_multitenant-physical-strategy.md), [`ARCHIVED_multitenant-analysis.md`](ARCHIVED_multitenant-analysis.md)

---

## Aggiornamenti post-migrazione (2026-05)

### Schema iscrizioni esteso

Tabella `iscrizioni` arricchita con campi anagrafici/residenza/artistici:
- Anagrafica: `luogo_nascita`, `sesso`, `codice_fiscale`
- Residenza: `indirizzo`, `citta`, `cap`, `provincia`, `paese`
- Artistici: `anni_studio`, `scuola_provenienza`
- Gruppo: `gruppo_nome`
- Free-form: `note_libere`

Migration: `server/scripts/migrations/2026_05_22_iscrizioni_extend_fields.sql`.

### Valutazioni numeric

`valutazioni.voto` da `integer` a `numeric(5,2)` (precision 5, scale 2) per supportare mezzi punti su scale ≤ 10. Drizzle column con `mode: 'number'` per deserializzare come number JS invece che string.

Migration: `server/scripts/migrations/2026_05_23_valutazioni_voto_numeric.sql`.

### Finalizzazione candidati_fase

`POST /api/fasi/:id/conclude` esegue, nella stessa transazione del cambio stato:

```sql
UPDATE candidati_fase SET stato='COMPLETATO'
 WHERE fase_id=:id AND stato <> 'ELIMINATO';
```

Backfill per fasi già concluse prima del fix: `server/scripts/migrations/2026_05_23_backfill_candidati_fase_completato.sql`.

### Branding tenant

Colonne JSONB `tenants.ente_settings` e `tenants.branding_public`:
- `ente_settings`: campi privati (email, telefono, sede, codice fiscale, PEC, sito web, note)
- `branding_public`: campi visibili pre-login (`nomePubblico`, `logoUrl` come dataURL inline, `coloreAccent`, `coloreSfondo`, `sottotitolo`)

Le PATCH `/api/ente` e `/api/ente/branding` fanno **merge** lato server (legge l'esistente, applica spread del nuovo parsed, riscrive il JSONB completo) — non più overwrite. Limite `logoUrl` portato a 10MB di stringa per accomodare dataURL PNG/WebP fino a 800px.

### Permessi granulari per-fase

Helper `assertCanManageFase(req, reply, faseId)` in `server/src/routes/fasi.ts`. Le route che cambiano stato fase (`start`, `conclude`, `sorteggio`, `timer/*`) usano `requireAuth + assertCanManageFase` invece di `requireRole('admin')`:
- `admin`/`superadmin`: sempre OK
- `commissario`: OK solo se è presidente della commissione assegnata alla fase
- Fase senza commissione: solo admin

Analogo `assertCanEditCandidatoFase` per `PATCH /api/candidati-fase/:id` (i commissari membri della commissione possono marcare `ammessoProssimaFase`).

### Validazione cross-concorso candidato + gerarchia categoria→sezione

In `POST /api/candidati` e `PATCH /api/candidati/:id`: helper `validateScope(tx, concorsoId, sezioneId, categoriaId)` verifica che sezione e categoria appartengano al concorso del candidato e che la categoria appartenga alla sezione scelta. Se manca la sezione ma c'è la categoria, **deriva** la sezione automaticamente (gerarchia hard).

Lo stesso pattern è applicato in `POST /api/public/iscrizioni` come "ultimo guardiano" lato server.

### Endpoint metriche platform

| Endpoint | Cosa fa |
|---|---|
| `GET /api/platform/system` | Snapshot risorse del processo Node: `memory.{rss,heapUsed,heapTotal}`, `cpu.{cores,processPct,loadAvg1/5/15}`, `uptimeSec`. La CPU% del processo è campionata con `process.cpuUsage()` su finestra di 200ms (latency aggiuntiva accettabile per endpoint admin-only). |
| `GET /api/platform/runtime` | Aggregato per-tenant sulla sliding window di 60s: `reqCountMin`, `reqPerSec`, `latencyP50Ms`, `latencyP95Ms`, `errorRate`, `lastSeenSec`. Nessuna persistence: si svuota al restart del processo. |

Il middleware `server/src/middleware/runtime-metrics.ts` registra hook globali `onRequest` (`req._runtimeStart = process.hrtime.bigint()`) e `onResponse` (calcola latenza, appende a array sliding 60s). Tenant senza traffico recente non sono inclusi (la card client mostra "idle"). Costo per-request: ~5µs.

Frontend super-admin: card a gradiente sopra la KPI strip standard con sparkline SVG inline (ring buffer 60 punti @ 5s polling = 5 min storico in memoria). Per-tenant: mini-badge `req/min · p50 ms · p95 ms` nella riga della tabella enti.

---

**Stato attuale (2026-05):**

- ✅ **Fasi 0–5c**: backend completo (auth, CRUD dominio, realtime, SMTP, upload, accounts, iscrizioni pubbliche)
- ✅ **Fase 6**: super-admin UI (gestione enti, soft-delete + cleanup, SMTP, stats, 2FA TOTP)
- ✅ **Fase 7**: stabilizzazione — permessi per-fase granulari, schema iscrizioni esteso, candidato N:1 sezione/categoria, finalizzazione candidati_fase, doppia conferma type-to-delete, branding merge JSONB, CSV import con tipo gruppo, validazioni cross-concorso
- ✅ **Fase 8**: metriche realtime — endpoint platform `/system` e `/runtime`, sparkline client + KPI per-tenant
- ✅ **Email verifica iscrizioni**: invio reale via SMTP tenant-aware (`sendMail` best-effort post-commit su `POST /api/public/iscrizioni`, link `#/iscrizione/verify?t=…`).
