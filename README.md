<div align="center">

# Gestimus

**Gestionale Concorso Musicale** — piattaforma multitenant per organizzare e valutare concorsi musicali a fasi multiple.

🇮🇹 Italiano · [🇬🇧 English](README.en.md)

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-22%20LTS-339933)
![React](https://img.shields.io/badge/React-19-61dafb)
![Fastify](https://img.shields.io/badge/Fastify-5-202020)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)
![Drizzle](https://img.shields.io/badge/Drizzle%20ORM-strict%20TS-c5f74f)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

---

## Cos'è Gestimus

Gestimus è un'applicazione web per **enti che organizzano concorsi musicali** (conservatori, associazioni, scuole). Gestisce l'intero ciclo di vita di un concorso: iscrizione pubblica dei candidati, configurazione delle fasi e dei criteri di valutazione, sessioni live di commissione, calcolo delle medie con metodi statistici diversi, esportazione protocolli e verbali.

L'architettura è **multitenant nativa**: un singolo backend ospita N enti indipendenti, ciascuno con il proprio sottodominio, dati isolati a livello database e amministratore separato. Un pannello super-admin centrale gestisce tutti gli enti.

## Funzionalità principali

### 👑 Super-admin
- Gestione enti da UI (creazione, modifica, sospensione, archiviazione con cleanup configurabile)
- Configurazione SMTP **per singolo ente** (provider diversi per enti diversi), credenziali cifrate at-rest
- Creazione admin di ente senza accesso shell al server
- **Piani SaaS configurabili da UI** (tabella `piani`, CRUD super-admin): limiti `max_concorsi`, `max_iscritti_annui`, `ppe_*`; assegnando un piano a un tenant i limiti vengono copiati in `tenant_config`. I vincoli sono enforced server-side e non scavalcabili dagli admin.
- Statistiche aggregate (concorsi, commissari, candidati per ente)
- **Metriche realtime**: card a gradient con RSS/CPU del processo Node + sparkline 5min (polling 5s); per-tenant `req/min`, `latency p50/p95`, `error rate` calcolate via hook globali Fastify (`/api/platform/system`, `/api/platform/runtime`)
- Audit log della piattaforma separato da quello per-tenant

### 🛠 Admin ente
- **Fasi** con 5 metodi di calcolo media (aritmetica, olimpica, winsorizzata, mediana, deviazione standard) + suggerimento automatico in base al numero di commissari
- **Sezioni e categorie** del concorso (es. Archi → Senior/Junior) + **copia categorie tra sezioni**
- **Candidati** individuali o gruppi, modello N:1 candidato → sezione + categoria; **auto-derive sezione** dalla categoria scelta
- **Import CSV** candidati con template (`tipo`, `gruppo_nome`, `sezione`, `categoria`)
- **Commissari** con designazione presidente per commissione
- **Commissioni** che raggruppano commissari + sezioni + categorie
- **Permessi fase granulari**: avvio/conclusione/sorteggio/timer eseguibili sia da admin sia dal presidente della commissione assegnata
- **Restrizione fasi**: una fase può essere limitata a sezioni specifiche (tracce parallele)
- **Sorteggio ordine** candidati con seed riproducibile (mulberry32)
- **Risultati**: classifica live, export CSV e PDF protocollo
- **Verbale** con template + tag dinamici; **Calendario** drag-and-drop + pagina pubblica
- **Branding ente**: logo + colori + dati di contatto in JSONB
- **Audit log** append-only tamper-evident (HMAC per riga)

### 🎼 Commissario / Presidente
- Valutazione **autonoma** o **sincrona** (pilotata dal presidente)
- **Timer fase** condiviso in realtime via Postgres `LISTEN/NOTIFY` + SSE
- Voto per criterio con peso configurabile (somma = 100%), voti decimali (`numeric(5,2)`)
- UI scoring riscritta sul pattern Cadenza (slider/preset + barra criteri + autosave) — niente verdetto soglia % durante il voto (no bias)
- **Pannello presidente** dedicato: avvio fase con pre-flight check, controllo timer (start/pause/resume/+1 min), sorteggio candidati, conclusione fase con doppia conferma
- **Riepilogo fasi CONCLUSA con esiti** visibile sia al commissario sia al presidente (read-only su fase chiusa, niente possibilità di alterare i voti)

### 📝 Iscrizione pubblica
- Form auto-service mono-pagina senza login
- **Save & resume** automatico via localStorage
- Verifica email + workflow di approvazione admin
- Anti-spam: honeypot, min-time-on-page, rate-limit per IP

### 🔒 Hardening
- **Isolamento tenant via Row-Level Security** a livello database
- **SMTP password** cifrate at-rest (AES-GCM, `enc:v1:` envelope, `GESTIMUS_SECRET_KEY` 32-byte hex)
- **Auth**: session cookie `HttpOnly` `SameSite=Strict`, password Argon2id, no JWT in localStorage; key-rotation supportata sui token di sessione
- **2FA TOTP** opzionale self-service (QR + codici di recupero), enforce su `/auth/login/verify-totp`
- **GDPR export/erase** endpoint per-tenant con audit trail (HMAC chain ri-firmata sullo scrub)
- **Scoring server-side autoritativo**: lo stesso pacchetto `@gestimus/scoring` (single source of truth) gira lato client per UX e lato server per il calcolo "fonte di verità" — nessun client può forzare un risultato
- **Optimistic locking** sulle entità a rischio race (es. iscrizioni, fasi) per evitare scritture concorrenti distruttive
- **Service layer + domain events / transactional outbox** sulle valutazioni: invariante "voto persistito ⟺ evento emesso" garantita anche in caso di failure middle-of-flow (Sentry cattura i silent failure)

### 🌐 Internazionalizzazione
Italiano (master), Inglese, Francese, Spagnolo. Chiavi piatte (`keySeparator: false`), fallback automatico sull'italiano.

---

## Architettura

```
  Browser (React 19 + Vite)          nginx (porta 443/80)
  ente1.gestimus.local:5173  ──────► *.gestimus.it   ← Let's Encrypt wildcard
        │  proxy /api /auth                │
        ▼                                  ▼
  ┌─────────────────────────────────────────────────┐
  │  Gestimus server  :4000                         │
  │  Node 22 + Fastify 5 + TypeScript strict        │
  │  Drizzle ORM  ·  cookie-session HttpOnly        │
  └────────────────────┬────────────────────────────┘
                       │  resolve subdomain → tenant_id
                       ▼
             ┌──────────────────────┐
             │  PostgreSQL 18       │  RLS per tabella
             │  database "gestimus" │  isolamento tenant_id
             │  :5432               │  LISTEN/NOTIFY → SSE
             └──────────────────────┘
```

Un **singolo processo Node/Fastify** + un **singolo database Postgres**. La separazione tra enti è garantita da **Row-Level Security**. In dev il frontend React (Vite :5173) proxya `/api`, `/auth`, `/uploads` verso il backend :4000 preservando l'`Host` per la risoluzione del tenant.

---

## Stack

### Frontend (React)

| | |
|---|---|
| **Framework** | React 19 + TypeScript strict |
| **Build tool** | Vite 8 |
| **Styling** | Tailwind CSS 4 + `legacy.css` (token HSL shadcn/ui, palette brand/ink) |
| **Componenti** | Radix UI + `src/components/ui/` (shadcn-style) |
| **Dati server** | TanStack Query v5 (staleTime 30s, retry 1) |
| **Routing** | React Router v7 (lazy pages, ProtectedRoute/RequireAdmin guards) |
| **Form** | react-hook-form v7 + Zod 4 (`@hookform/resolvers`) |
| **i18n** | i18next + react-i18next, chiavi piatte, 4 lingue (it/en/fr/es) |
| **Errori** | Sentry (`@sentry/react`, sourcemap upload opzionale in CI) |
| **PWA** | vite-plugin-pwa + Workbox (SW `generateSW`, NetworkOnly su `/api/*`) |
| **Test** | Vitest (jsdom) + Playwright (E2E Chromium) |
| **Auth** | Cookie-session HttpOnly (nessun token in localStorage) |

> Il vecchio frontend vanilla (`js/`, `css/`, `index.html` nella root) è stato **rimosso a maggio 2026**: React in `frontend/` è l'unico frontend, servito sempre da Fastify da `frontend/dist`. La vecchia istanza PocketBase è stata dismessa: il backend gira **solo** su Postgres + Fastify + Drizzle.

### Backend

| | |
|---|---|
| **Runtime** | Node.js 22 LTS + Fastify 5 + TypeScript strict |
| **ORM** | Drizzle + drizzle-kit migrations |
| **Database** | PostgreSQL 18 (multitenancy logica via RLS, `uuidv7()` nativo per PK) |
| **Auth** | Session cookie HttpOnly + Argon2id (`@node-rs/argon2`) |
| **Realtime** | Postgres `LISTEN/NOTIFY` + SSE plugin Fastify (path `/api/realtime/...`) |
| **Storage** | Filesystem locale strutturato per tenant (`uploads/<tenant_slug>/...`) |
| **Email** | Nodemailer + cifratura credenziali AES-GCM (`enc:v1:`) |
| **Architettura** | Service layer su valutazioni · domain events / transactional outbox · pacchetto `@gestimus/scoring` condiviso server + frontend |
| **Errori** | Sentry Node (cattura failure silenziosi inclusi) |

---

## Quick start in locale

Richiede macOS o Linux, **Node 22 LTS**, **PostgreSQL 18**.

```bash
git clone https://github.com/danilorussosax/gestimus.git
cd gestimus

# 1. Postgres locale (macOS via Homebrew, o usa Docker)
brew install postgresql@18
brew services start postgresql@18
createdb gestimus

# 2. Backend
cd server
npm install
cp .env.example .env
# → modifica DATABASE_URL_*, SESSION_COOKIE_SECRET, GESTIMUS_SECRET_KEY (32 byte hex)

npm run db:bootstrap        # crea ruoli gestimus_app / gestimus_super
npm run db:setup            # push schema Drizzle + applica policy RLS
npm run db:seed             # dati demo (1 super-admin + 2 enti + concorso campione)
npm run dev                 # backend Fastify su :4000
```

```bash
# 3. Frontend React (terminale separato)
cd frontend
npm install
npm run dev                 # Vite su :5173, proxy → :4000
```

Aggiungi i sottodomini a `/etc/hosts` (fallback semplice):

```
127.0.0.1  platform.gestimus.local
127.0.0.1  ente1.gestimus.local
127.0.0.1  ente2.gestimus.local
```

Dopo l'avvio:
- `http://ente1.gestimus.local:5173/` → app React (admin/commissario)
- `http://platform.gestimus.local:5173/` → super-admin
- `http://ente1.gestimus.local:4000/` → backend diretto (senza Vite proxy)
- Credenziali demo: vedi output di `npm run db:seed` (riassunto anche in [`ONBOARDING.md`](ONBOARDING.md))

> **Non usare `localhost`**: il backend risolve il tenant dal sottodominio → `/api/*` risponde 400 senza un `*.gestimus.local`. Per evitare di toccare `/etc/hosts` e avere URL pulite (senza porta), usa il dev-proxy `nginx+dnsmasq` integrato: `./scripts/dev-proxy.sh up` (dettagli in [`ONBOARDING.md`](ONBOARDING.md)).

Per resettare il DB di sviluppo: `cd server && npm run db:reset`.

---

## Build per la produzione

```bash
# Frontend: type-check + bundle
cd frontend && npm run build      # tsc -b && vite build → frontend/dist/

# Backend
cd server && npm run build        # tsc → server/dist/
```

Il server Fastify serve i file statici da `frontend/dist/` in produzione (configurato via `@fastify/static`).

---

## Struttura del progetto

```
gestimus/
├── frontend/                    # Frontend React (unico frontend)
│   ├── src/
│   │   ├── api/                 # moduli fetch per entità (auth, concorsi, fasi, …)
│   │   ├── components/
│   │   │   ├── ui/              # primitivi shadcn-style (Button, Dialog, Select, …)
│   │   │   ├── admin/           # tab admin (FasiTab, CandidatiTab, RisultatiTab, CalendarioTab, …)
│   │   │   └── layout/          # AppLayout (shell autenticata)
│   │   ├── contexts/            # AuthContext · ThemeContext
│   │   ├── hooks/               # useFaseRuntime · useOnline · useDirtyDialogClose · …
│   │   ├── i18n/                # init i18next + locales/it|en|fr|es.json
│   │   ├── lib/                 # api.ts (http client) · scoring · tiebreak · rng · sentry · pwa
│   │   ├── pages/               # Home · Login · Commissario · Superadmin · admin/ · public/
│   │   ├── types/               # contratto API (User, Concorso, Fase, …)
│   │   ├── index.css            # Tailwind 4 + token custom (palette brand/ink)
│   │   ├── legacy.css           # token HSL shadcn/ui (eredità design)
│   │   └── main.tsx             # entry point (BrowserRouter + QueryClient + AuthProvider)
│   ├── tests/e2e/               # Playwright smoke spec
│   ├── vite.config.ts           # Vite + PWA + Sentry + proxy dev (manualChunks gestiti per rolldown)
│   ├── playwright.config.ts     # E2E config (base: ente1.gestimus.local:5173)
│   └── package.json
├── packages/
│   └── scoring/                 # Pacchetto condiviso @gestimus/scoring (single source of truth: medie, tiebreak)
├── server/                      # Backend Fastify + Drizzle
│   ├── src/
│   │   ├── db/                  # schema Drizzle + policy RLS (policies.sql)
│   │   ├── routes/              # endpoint REST per entità di dominio + super-admin
│   │   ├── services/            # auth · session · storage · email · crypto SMTP · scoring · outbox · audit (HMAC)
│   │   ├── middleware/          # tenant resolver (subdomain → tenant_id) + auth guard + runtime-metrics
│   │   └── realtime/            # hub SSE + bridge LISTEN/NOTIFY
│   ├── scripts/                 # bootstrap-db · apply-policies · seed-dev · seed-prod · seed-piani · backup · migrate
│   ├── tests/                   # rls/ · auth/ · crud/ · realtime/
│   └── package.json
├── tests/
│   └── load/                    # Load test autocannon (percorsi caldi) — perf
├── deploy/                      # install.sh (provisioning IONOS bare-metal) + nginx snippet rate-limit
├── scripts/
│   └── dev-proxy.sh             # nginx+dnsmasq reverse-proxy locale (URL pulite *.gestimus.local)
├── docs/                        # Documentazione (deploy, HA Postgres, manuale admin)
└── .github/                     # CI + Dependabot + issue/PR templates
```

---

## Script npm

### Backend (`server/`)

```bash
npm run dev              # tsx watch su :4000
npm run build            # compila TypeScript
npm run start            # esegui build di produzione
npm run db:bootstrap     # crea ruoli gestimus_app / gestimus_super + DB gestimus
npm run db:setup         # db:push + apply policies RLS
npm run db:seed          # dati demo (tenant + account)
npm run db:seed:prod     # bootstrap super-admin di produzione
npm run db:reset         # drop + rebuild + seed (solo dev)
npm run db:studio        # Drizzle Studio (UI ispezione tabelle)
npm run db:sql:status    # stato ledger migrazioni incrementali
npm run db:sql:up        # applica le migrazioni nuove
npm run db:sql:down      # rollback ultima migrazione
npm run db:sql:baseline  # marca un DB esistente come allineato
npm run db:backup        # dump streaming PG (usato dal timer systemd in prod)
npm run test             # tutti i suite (rls + auth + crud + realtime)
npm run test:rls         # solo isolamento cross-tenant
npm run test:auth        # login/logout/me + cross-tenant guard + TOTP
npm run test:crud        # CRUD entità + trigger + privacy + calendario + cleanup + platform
npm run test:realtime    # LISTEN/NOTIFY → SSE
npm run lint             # tsc --noEmit (tsconfig.lint.json)
```

### Frontend (`frontend/`)

```bash
npm run dev              # Vite dev server :5173 (con HMR)
npm run build            # tsc -b && vite build → dist/
npm run typecheck        # tsc -b --noEmit (type check senza emit)
npm run lint             # ESLint strict-type-checked
npm run lint:fix         # ESLint + autofix
npm run test             # Vitest (unit/componenti, jsdom)
npm run test:coverage    # Vitest + copertura v8
npm run e2e              # Playwright E2E (richiede backend :4000 + dev server :5173)
```

### Root

```bash
# Carico (autocannon) — richiede backend in esecuzione
node tests/load/<scenario>.js
```

---

## Documentazione

| File | Contenuto |
|------|-----------|
| [`ONBOARDING.md`](ONBOARDING.md) | **Setup dev locale** — env vars, db:bootstrap/setup/seed, dev-proxy nginx+dnsmasq, credenziali demo |
| [`docs/manuale-admin.md`](docs/manuale-admin.md) | **Manuale operativo admin di ente** — consultabile anche in-app da *Admin → Manuale* |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | **Guida deploy IONOS** — `deploy/install.sh` (Node + PG18 + nginx + systemd + ufw), certbot DNS-01 wildcard, backup giornaliero, rinnovo TLS |
| [`docs/HA-POSTGRES.md`](docs/HA-POSTGRES.md) | **Alta disponibilità Postgres** — replica streaming, Patroni + etcd, HAProxy, PITR, runbook failover |
| [`server/README.md`](server/README.md) | **Backend reference** — endpoint REST, RLS, trigger DB, scoring + outbox, 2FA TOTP, runtime metrics |
| [`deploy/README.md`](deploy/README.md) | **Script di provisioning** — flag di `install.sh`, TLS_MODE, variabili principali |

---

## Contributi

Vedi [.github/pull_request_template.md](.github/pull_request_template.md) per il flusso PR.

Convention commit:
- `feat:` nuova funzionalità
- `fix:` bug fix
- `chore:` infra/ops
- `deps:` dipendenze (Dependabot)
- `ci:` workflow GitHub Actions
- `docs:` documentazione

## Licenza

Codice proprietario — non distribuibile senza autorizzazione del proprietario.

---

<div align="center">

Costruito con ❤ per gli enti musicali italiani. Domande / proposte? Apri una [issue](https://github.com/danilorussosax/gestimus/issues/new/choose).

</div>
