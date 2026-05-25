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

### 🎼 Commissario
- Valutazione **autonoma** o **sincrona** (pilotata dal presidente)
- **Timer fase** condiviso in realtime via Postgres `LISTEN/NOTIFY` + SSE
- Voto per criterio con peso configurabile (somma = 100%), voti decimali (`numeric(5,2)`)

### 📝 Iscrizione pubblica
- Form auto-service mono-pagina senza login
- **Save & resume** automatico via localStorage
- Verifica email + workflow di approvazione admin
- Anti-spam: honeypot, min-time-on-page, rate-limit per IP

### 🔒 Hardening
- **Isolamento tenant via Row-Level Security** a livello database
- **SMTP password** cifrate at-rest (AES-GCM)
- **Auth**: session cookie `HttpOnly` `SameSite=Strict`, password Argon2id, no JWT in localStorage
- **2FA TOTP** opzionale self-service (QR + codici di recupero)
- **GDPR export/erase** endpoint per-tenant con audit trail

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

> Il vecchio frontend vanilla (`js/`, `css/`, `index.html` nella root) è **superseded** dal frontend React in `frontend/`. Il codice vanilla è conservato ma non più sviluppato attivamente.

### Backend

| | |
|---|---|
| **Runtime** | Node.js 22 LTS + Fastify 5 + TypeScript strict |
| **ORM** | Drizzle + drizzle-kit migrations |
| **Database** | PostgreSQL 18 (multitenancy logica via RLS, `uuidv7()` nativo per PK) |
| **Auth** | Session cookie HttpOnly + Argon2id (`@node-rs/argon2`) |
| **Realtime** | Postgres `LISTEN/NOTIFY` + SSE plugin Fastify |
| **Storage** | Filesystem locale strutturato per tenant |
| **Email** | Nodemailer + cifratura credenziali AES-GCM |

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

Aggiungi i sottodomini a `/etc/hosts`:

```
127.0.0.1  platform.gestimus.local
127.0.0.1  ente1.gestimus.local
127.0.0.1  ente2.gestimus.local
```

Dopo l'avvio:
- `http://ente1.gestimus.local:5173/` → app React (admin/commissario)
- `http://platform.gestimus.local:5173/` → super-admin
- `http://ente1.gestimus.local:4000/` → backend diretto (senza Vite proxy)
- Credenziali demo: vedi output di `npm run db:seed`

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
├── frontend/                    # Frontend React (stack attuale)
│   ├── src/
│   │   ├── api/                 # moduli fetch per entità (auth, concorsi, fasi, …)
│   │   ├── components/
│   │   │   ├── ui/              # primitivi shadcn-style (Button, Dialog, Select, …)
│   │   │   ├── admin/           # tab admin (FasiTab, CandidatiTab, RisultatiTab, …)
│   │   │   └── layout/          # AppLayout (shell autenticata)
│   │   ├── contexts/            # AuthContext · ThemeContext
│   │   ├── hooks/               # useFaseRuntime · useOnline · useDirtyDialogClose · …
│   │   ├── i18n/                # init i18next + locales/it|en|fr|es.json
│   │   ├── lib/                 # api.ts (http client) · scoring · tiebreak · rng · sentry · pwa
│   │   ├── pages/               # Home · Login · Commissario · Superadmin · admin/ · public/
│   │   ├── types/               # contratto API (User, Concorso, Fase, …)
│   │   ├── index.css            # Tailwind 4 + token custom (palette brand/ink)
│   │   ├── legacy.css           # token HSL shadcn/ui portati dal vanilla
│   │   └── main.tsx             # entry point (BrowserRouter + QueryClient + AuthProvider)
│   ├── tests/e2e/               # Playwright smoke spec
│   ├── vite.config.ts           # Vite + PWA + Sentry + proxy dev
│   ├── playwright.config.ts     # E2E config (base: ente1.gestimus.local:5173)
│   └── package.json
├── server/                      # Backend Fastify + Drizzle
│   ├── src/
│   │   ├── db/                  # schema Drizzle + policy RLS (policies.sql)
│   │   ├── routes/              # endpoint REST per entità di dominio
│   │   ├── services/            # auth · session · storage · email · crypto SMTP
│   │   ├── middleware/          # tenant resolver (subdomain → tenant_id) + auth guard
│   │   └── realtime/            # hub SSE + bridge LISTEN/NOTIFY
│   ├── scripts/                 # bootstrap-db · apply-policies · seed-dev · reset-dev
│   ├── tests/                   # rls/ · auth/ · crud/ · realtime/ (~154 test)
│   └── package.json
├── tests/
│   ├── unit/                    # node --test (scoring, tiebreak, rng) — no DB
│   └── e2e/                     # Playwright legacy (smoke client + super-admin)
├── js/                          # [SUPERSEDED] Frontend vanilla (conservato, non sviluppato)
├── css/                         # [SUPERSEDED] Stili vanilla
├── deploy/                      # Template config nginx/systemd
├── docs/                        # Documentazione (architettura, deploy, manuali)
└── .github/                     # CI + Dependabot + issue/PR templates
```

---

## Script npm

### Backend (`server/`)

```bash
npm run dev              # tsx watch su :4000
npm run build            # compila TypeScript
npm run start            # esegui build di produzione
npm run db:bootstrap     # crea ruoli gestimus_app / gestimus_super
npm run db:setup         # db:push + apply policies RLS
npm run db:seed          # dati demo
npm run db:reset         # drop + rebuild + seed (solo dev)
npm run db:studio        # Drizzle Studio (UI ispezione tabelle)
npm run test             # tutti i suite (rls + auth + crud + realtime)
npm run test:rls         # solo isolamento cross-tenant
npm run lint             # tsc --noEmit
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
npm run test:unit        # tests/unit (scoring + rng) — no DB
npm run test:e2e         # Playwright legacy (richiede server avviato)
```

---

## Documentazione

| File | Contenuto |
|------|-----------|
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | **Guida frontend React** — stack, layout src/, convenzioni, come aggiungere una pagina, build/lint/test |
| [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) | **Architettura tecnica completa** — schema DB, policy RLS, struttura moduli backend, soft-delete tenant, 2FA TOTP, milestone roadmap |
| [`docs/AUDIT.md`](docs/AUDIT.md) | **Stato sicurezza/hardening** — fotografia corrente + cronologia dei round di audit |
| [`docs/TEST.md`](docs/TEST.md) | **Test & verifica** — piramide (unit/server/E2E frontend+legacy/type-check/load), comandi, prerequisiti, risultati load test, gate CI |
| [`docs/LISTINO.md`](docs/LISTINO.md) | **Listino piani commerciali** |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | **Guida deploy IONOS** — systemd single unit, certbot DNS-01, backup PG, PgBouncer |
| [`docs/HA-POSTGRES.md`](docs/HA-POSTGRES.md) | **Alta disponibilità** — replica streaming + failover automatico, PITR, runbook |
| [`docs/manuale-admin.md`](docs/manuale-admin.md) | **Manuale operativo admin di ente** — consultabile in-app da *Admin → Manuale* |
| [`server/README.md`](server/README.md) | **Backend reference** — schema Drizzle, endpoint REST, middleware, migrations, runtime metrics |

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
