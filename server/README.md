# Gestimus — Backend (Postgres + Fastify + Drizzle)

Backend di produzione. Per il contesto strategico e il piano di migrazione storico, vedi [`../docs/MIGRATION_POSTGRES.md`](../docs/MIGRATION_POSTGRES.md).

**Status:** stack stabilizzato. Migrazione completa da PocketBase. UI super-admin con metriche realtime. Schema iscrizioni esteso. Permessi per-fase granulari (admin + presidente di commissione).

## Stack

- PostgreSQL 16 (UUIDv7 via funzione `uuidv7()`)
- Node.js 22 LTS
- Fastify 5 + `@fastify/cookie` + `@fastify/rate-limit` + `@fastify/sensible` + `@fastify/multipart` + `@fastify/static`
- Drizzle ORM + drizzle-kit
- Argon2id (`@node-rs/argon2`) + sessioni server-side con SHA-256 token hashing
- TypeScript strict
- Realtime: Postgres `LISTEN/NOTIFY` + Server-Sent Events
- Storage: filesystem locale strutturato per tenant (`uploads/<tenant_slug>/<resource>/<id>/...`)
- Metriche: hook globali Fastify `onRequest`/`onResponse` → sliding window 60s per-tenant (no persistence)

## Setup locale (prima volta)

### 1. PostgreSQL 16 su macOS

```bash
brew install postgresql@16
brew services start postgresql@16

# Aggiungere al PATH (zshrc): export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Crea il tuo utente Postgres se non c'è (su macOS Homebrew di solito è automatico):
psql -d postgres -c "SELECT current_user;"  # deve rispondere senza errori
```

### 2. Variabili d'ambiente

```bash
cd server
cp .env.example .env
# Modificare SESSION_COOKIE_SECRET e GESTIMUS_SECRET_KEY con stringhe random ≥32 caratteri
openssl rand -hex 32  # per GESTIMUS_SECRET_KEY
openssl rand -hex 32  # per SESSION_COOKIE_SECRET
```

### 3. Bootstrap iniziale (una volta sola)

Crea i ruoli `gestimus_app` / `gestimus_super` e il database `gestimus`. Va eseguito con un utente Postgres con privilegi superuser (su macOS è il tuo utente di sistema via peer auth, lo script lo rileva automaticamente).

```bash
npm install
npm run db:bootstrap
```

Se la connessione fallisce, imposta `DATABASE_URL_BOOTSTRAP` nel `.env`:
- macOS Homebrew: `postgres://danilorusso@localhost:5432/postgres`
- Linux: `postgres://postgres@localhost:5432/postgres`

### 4. Schema + RLS + seed

```bash
npm run db:setup    # drizzle-kit push (crea tabelle) + apply policies.sql (RLS + grants)
npm run db:seed     # crea tenant ente1, ente2, ente-archiviato + concorsi demo
```

### 5. Hosts locale per il subdomain

Aggiungere a `/etc/hosts`:

```
127.0.0.1 platform.gestimus.local
127.0.0.1 ente1.gestimus.local
127.0.0.1 ente2.gestimus.local
127.0.0.1 ente-archiviato.gestimus.local
```

### Account demo dopo il seed

| Subdomain | Email | Password | Ruolo |
|---|---|---|---|
| `ente1.gestimus.local` | `admin@ente1.test` | `Admin123!` | admin |
| `ente1.gestimus.local` | `commissario@ente1.test` | `Demo123!` | commissario |
| `ente2.gestimus.local` | `admin@ente2.test` | `Admin123!` | admin |
| `platform.gestimus.local` | `super@platform.test` | `Super123!` | superadmin |

### 6. Avvio dev server

```bash
npm run dev
# server in ascolto su http://127.0.0.1:4000
```

### 7. Accesso al frontend

Il backend serve anche i file statici della root del progetto (`index.html`, `js/`, `css/`, `/uploads/*`). Apri il browser su:

- **`http://ente1.gestimus.local:4000/`** → app di un ente
- `http://ente2.gestimus.local:4000/` → altro ente (isolato via RLS)
- `http://platform.gestimus.local:4000/` → super-admin

**Non** usare `http://127.0.0.1:4000/` per testare l'app: il middleware non riesce a risolvere il tenant dall'IP, le chiamate `/api/*` rispondono 400. L'IP funziona solo per health-check (`/healthz`, `/readyz`).

## Verifica funzionamento

### Health check + endpoint pubblici

```bash
# Health check (no tenant context)
curl http://127.0.0.1:4000/healthz

# Concorsi del tenant ente1
curl -H "Host: ente1.gestimus.local" http://127.0.0.1:4000/api/concorsi

# Tenant inesistente → 404
curl -H "Host: nonexistent.gestimus.local" http://127.0.0.1:4000/api/concorsi

# Tenant archiviato → 403
curl -H "Host: ente-archiviato.gestimus.local" http://127.0.0.1:4000/api/concorsi
```

### Auth (login + sessione)

```bash
# Login admin di ente1 — salva cookies in cookies.txt
curl -c cookies.txt -H "Host: ente1.gestimus.local" -H "Content-Type: application/json" \
  -d '{"email":"admin@ente1.test","password":"Admin123!"}' \
  http://127.0.0.1:4000/auth/login

# Profilo loggato
curl -b cookies.txt -H "Host: ente1.gestimus.local" http://127.0.0.1:4000/auth/me

# Logout
curl -b cookies.txt -H "Host: ente1.gestimus.local" -X POST http://127.0.0.1:4000/auth/logout

# Login super-admin
curl -c super.txt -H "Host: platform.gestimus.local" -H "Content-Type: application/json" \
  -d '{"email":"super@platform.test","password":"Super123!"}' \
  http://127.0.0.1:4000/auth/login
```

## Test automatici

```bash
npm run test:rls       # isolamento tenant via RLS (5 test)
npm run test:auth      # login/logout/me + cross-tenant guard (9 test)
npm run test:crud      # smoke E2E CRUD su tutte le entità (5 test)
npm test               # tutto
```

## Endpoint dominio (richiedono auth)

Tutti i path sono sotto `/api/`. Richiedono cookie di sessione. Mutazioni (POST/PATCH/DELETE) richiedono `role=admin` salvo dove indicato.

| Risorsa | Path | Note |
|---|---|---|
| Concorsi | `/api/concorsi` | CRUD completo |
| Commissari | `/api/commissari?concorsoId=...` | CRUD completo |
| Sezioni | `/api/sezioni?concorsoId=...` | CRUD completo |
| Categorie | `/api/categorie?sezioneId=...` | CRUD completo |
| Commissioni | `/api/commissioni?concorsoId=...` | CRUD + `:id/commissari/:cid` (add/remove), `:id/sezioni/:sid`, `:id/categorie/:cid` |
| Candidati | `/api/candidati?concorsoId=...` | CRUD; vincolo unique `(concorso, numero_candidato)` |
| Fasi | `/api/fasi?concorsoId=...` | CRUD + `:id/start`, `:id/conclude` (transizioni stato) |
| Criteri | `/api/criteri?faseId=...` | CRUD (nested per fase) |
| Candidati↔Fase | `/api/candidati-fase?faseId=...` | Assegnazione, posizione, stato (IN_ATTESA/IN_ESECUZIONE/COMPLETATO/ELIMINATO) |
| Valutazioni | `/api/valutazioni?candidatoFaseId=...&commissarioId=...` | POST è upsert (clamp voto + freeze su fase CONCLUSA via trigger DB); aperto a `role=commissario` |
| Privacy | `/api/privacy/export`, `/api/privacy/erase` | GDPR art. 20 (data portability) + art. 17 (right to be forgotten). Solo `role=admin`. |
| Realtime | `GET /api/realtime/fase/:id` | Stream SSE timer fase. Eventi pubblicati su `NOTIFY fase_<uuid>` da `/api/fasi/:id/start \| /conclude`. |
| Upload | `POST /api/upload/:resource/:id` (multipart, field `file`) | resource ∈ `concorso \| commissario \| candidato`. Mime allowlist, max size 5 MB, path traversal-safe. Aggiorna `logo`/`foto` della risorsa target. |
| SMTP | `GET/PUT/DELETE /api/tenant/smtp`, `POST /api/tenant/smtp/test` | Configurazione SMTP del tenant con cifratura AES-256-GCM at-rest. `test` accetta `sendTo` opzionale per invio email reale. |
| Accounts | `/api/accounts` | CRUD utenti del tenant (admin only). `POST /:id/reset-password`. Anti self-demotion/self-deactivation. Invalidazione sessioni su disattiva/cambio ruolo/reset password. |
| Audit log | `/api/audit-log?action=&actor=&before=&after=`, `/audit-log/stats` | Read-only per admin. Filtri + statistiche degli ultimi 30gg per `action`. |
| Fase runtime | `GET /api/fasi/:id/runtime`, `POST /api/fasi/:id/timer/{start,pause,resume,reset,bonus}`, `POST /api/fasi/:id/sorteggio`, `PATCH /api/fasi/reorder` | Timer fase con stato server-side + NOTIFY SSE. Sorteggio mulberry32 seedato per ordine candidati. Reorder PATCH multi-fase. |
| Membri gruppo | `/api/membri-gruppo?candidatoId=...` | CRUD membri di candidato gruppo (richiede `candidati.isGruppo=true`). |
| Ente | `GET /api/ente`, `PATCH /api/ente`, `GET /api/ente/public`, `PATCH /api/ente/branding` | Settings ente del tenant + branding pubblico accessibile pre-login. |
| Iscrizioni (pubblico) | `GET /api/public/concorsi`, `GET /api/public/concorsi/:id`, `POST /api/public/iscrizioni`, `GET /api/public/iscrizioni/:token/verify` | Form auto-service **senza auth**. Anti-spam: honeypot + min-time-on-page (3s) + rate-limit (3/h per IP). GDPR Art. 8: tutore obbligatorio sotto i 16 anni. Schema esteso: `luogoNascita`, `sesso`, `codiceFiscale`, `indirizzo`, `citta`, `cap`, `provincia`, `paese`, `anniStudio`, `scuolaProvenienza`, `gruppoNome`, `noteLibere`. Validazione cross-concorso + auto-derive sezione dalla categoria. Email verification token generato (placeholder, l'invio email reale viene effettuato quando configurato SMTP del tenant). |
| Iscrizioni (admin) | `GET /api/iscrizioni`, `POST /api/iscrizioni/:id/approve`, `POST /api/iscrizioni/:id/reject` | Lista filtrabile per concorso/stato. **Approve crea automaticamente il candidato** con numero progressivo e lo collega all'iscrizione. |
| Platform metrics | `GET /api/platform/system`, `GET /api/platform/runtime` | Solo super-admin. `system` campiona `process.cpuUsage()` su 200ms per restituire CPU% del processo + RSS/heap + uptime. `runtime` aggrega req/min, latency p50/p95, error rate per tenant su sliding window 60s (in memoria, niente persistence). |

Ogni mutazione produce automaticamente una entry in `audit_log` con `actor_account_id`, `action`, `target_*`, `ip`, `user_agent`.

### Garanzie a livello DB (oltre alla validazione applicativa)

- **Clamp voto**: trigger `trg_clamp_voto` su `valutazioni` forza `voto ∈ [0, fase.scala]` anche se il client bypassa la route. La colonna `voto` è `numeric(5,2)` per supportare mezzi punti su scale ≤ 10.
- **Freeze fase CONCLUSA**: trigger `trg_freeze_valutazioni` solleva su INSERT/UPDATE/DELETE quando la fase è in stato `CONCLUSA`.
- **No-resurrection fase**: trigger `trg_fase_no_resurrection` impedisce transizioni `CONCLUSA → IN_CORSO/PIANIFICATA`.
- **Audit append-only**: `REVOKE UPDATE, DELETE ON audit_log, platform_audit_log FROM gestimus_app` → solo super-admin può cancellare (per finalità GDPR).

### Permessi granulari per-fase

Le route che gestiscono lo stato di una fase (`/api/fasi/:id/start`, `/conclude`, `/sorteggio`, `/timer/*`) usano l'helper `assertCanManageFase(req, reply, faseId)`:

- **admin/superadmin**: sempre autorizzato.
- **commissario**: autorizzato SOLO se è presidente della commissione assegnata alla fase (`commissioni.presidenteCommissarioId === req.account.commissarioId`).
- Se la fase non ha commissione assegnata (`commissione_id IS NULL`): solo admin/superadmin.

Analogo `assertCanEditCandidatoFase` per `PATCH /api/candidati-fase/:id`: ogni commissario membro della commissione assegnata può marcare il proprio "voto di ammissione".

### Finalizzazione candidati_fase

`POST /api/fasi/:id/conclude` esegue, nella stessa transazione del cambio stato `fasi → CONCLUSA`:

```sql
UPDATE candidati_fase SET stato='COMPLETATO', updated_at=NOW()
 WHERE fase_id=:id AND stato <> 'ELIMINATO';
```

Senza questo, la view risultati lato client interpreterebbe `cf.stato !== 'COMPLETATO'` come "in attesa" anche per fasi concluse.

## Reset DB durante lo sviluppo

```bash
# Cancella tutte le tabelle e ricrea schema + seed (i ruoli e il DB restano)
PGPASSWORD=devpassword psql -h localhost -U gestimus_super -d gestimus \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
npm run db:setup
npm run db:seed
```

## Struttura

```
server/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── src/
│   ├── index.ts            # entrypoint (start + signal handlers)
│   ├── app.ts              # createApp() — usata anche dai test
│   ├── env.ts              # config con Zod
│   ├── db/
│   │   ├── client.ts       # dbApp + dbSuper pools
│   │   ├── schema.ts       # Drizzle schema TS (24 tabelle)
│   │   └── policies.sql    # RLS + ruoli + helper function
│   ├── middleware/
│   │   ├── tenant.ts             # risoluzione tenant da subdomain + req.dbTx helper
│   │   ├── auth.ts               # sessione cookie + requireAuth/requireRole
│   │   └── runtime-metrics.ts    # hook onRequest/onResponse → sliding window per-tenant
│   ├── routes/                   # 18 plugin Fastify (auth + 17 risorse)
│   ├── realtime/                 # hub SSE + bridge LISTEN/NOTIFY
│   └── services/
│       ├── password.ts     # Argon2id hash/verify
│       ├── session.ts      # create/validate/invalidate session
│       ├── crypto-smtp.ts  # AES-256-GCM encrypt/decrypt password SMTP
│       ├── audit.ts        # writeAudit + writePlatformAudit
│       ├── backup.ts       # snapshot PG → S3-like / locale
│       ├── cleanup.ts      # job cleanup tenant archiviati
│       └── storage.ts      # save/list/delete file per tenant
├── scripts/
│   ├── bootstrap-db.ts     # crea ruoli + DB gestimus
│   ├── apply-policies.ts   # applica policies.sql
│   └── seed-dev.ts         # tenant + account demo (con password Argon2)
└── tests/
    ├── rls/
    │   └── isolation.test.ts   # 5 test isolamento cross-tenant
    └── auth/
        └── login.test.ts       # 9 test login/logout/me + cross-tenant
```

## Migrations recenti

Le migrazioni "incrementali" (ALTER TABLE) applicate dopo `db:push` iniziale stanno in `server/scripts/migrations/`:

```bash
ls server/scripts/migrations/
# 2026_05_22_iscrizioni_extend_fields.sql           — luogoNascita, sesso, CF, indirizzo, ecc.
# 2026_05_23_valutazioni_voto_numeric.sql           — voto: integer → numeric(5,2)
# 2026_05_23_backfill_candidati_fase_completato.sql — backfill stato COMPLETATO su fasi già CONCLUSE
```

Applicazione:

```bash
psql "$DATABASE_URL_SUPER" -f server/scripts/migrations/<file>.sql
# oppure (per le ADD COLUMN, drizzle-kit fa il diff automatico)
npm run db:push
```

## Roadmap

- ✅ **Fasi 0–5c**: backend completo, RLS, auth, CRUD dominio, realtime, SMTP, upload, accounts, iscrizioni pubbliche
- ✅ **Fase 6**: super-admin UI (gestione enti, soft-delete + cleanup, SMTP, stats, 2FA TOTP)
- ✅ **Fase 7**: stabilizzazione — permessi per-fase granulari, schema iscrizioni esteso, candidato N:1 sezione/categoria, finalizzazione candidati_fase al conclude, doppia conferma type-to-delete, branding merge JSONB, validazioni cross-concorso, CSV import con tipo gruppo
- ✅ **Fase 8**: metriche realtime — endpoint `/api/platform/system` (CPU sampling 200ms), `/api/platform/runtime` (sliding window 60s per-tenant), sparkline client + KPI per-tenant
- **In corso**: invio email reale per verifica iscrizioni (SMTP tenant-aware è pronto, manca solo l'edge `sendMail({to, subject, body})` con il link verifica).

## Smoke checklist manuale (Fase 5c)

Dopo `npm run dev`, apri `http://ente1.gestimus.local:4000/` e verifica i flussi:

### Admin
- [ ] Login `admin@ente1.test` / `Admin123!`
- [ ] Crea concorso → sezione → categoria → commissario → candidato → fase → criterio
- [ ] Apri iscrizioni del concorso (toggle dall'UI)
- [ ] Apri (in altra finestra/incognito) `http://ente1.gestimus.local:4000/#/iscrizione?concorso_id=…` e compila un'iscrizione di prova
- [ ] Torna come admin → vedi l'iscrizione in lista, clicca "Approva" → candidato creato automaticamente
- [ ] Avvia una fase, avvia timer → in un'altra tab dello stesso ente lo stato si aggiorna via SSE

### Commissario
- [ ] Login `commissario@ente1.test` / `Demo123!`
- [ ] Vede solo il concorso assegnato; può salvare valutazioni
- [ ] Non può cancellare concorsi (403)

### Super-admin
- [ ] Login `super@platform.test` / `Super123!` su `platform.gestimus.local:4000`
- [ ] Vede tutti gli enti, può cambiare piano, archiviare/sospendere

### Isolamento RLS (sanity check)
- [ ] Apri tab `ente1.gestimus.local:4000` + altra tab `ente2.gestimus.local:4000` — i dati sono completamente separati anche se condividono lo stesso pool DB
- **Fase 4**: realtime LISTEN/NOTIFY (timer fase) + storage file upload + email tenant-aware
- **Fase 5**: frontend adapter `js/db.js`
- **Fase 6**: super-admin UI (soft-delete + cleanup config + SMTP + stats)
- **Fase 10**: 2FA TOTP (post-migrazione, toggle UI super-admin)
