<div align="center">

# Gestimus

**Music Competition Manager** — multitenant platform to organize and judge music competitions across multiple phases.

[🇮🇹 Italiano](README.md) · 🇬🇧 English

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-22%20LTS-339933)
![React](https://img.shields.io/badge/React-19-61dafb)
![Fastify](https://img.shields.io/badge/Fastify-5-202020)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)
![Drizzle](https://img.shields.io/badge/Drizzle%20ORM-strict%20TS-c5f74f)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

---

## What is Gestimus

Gestimus is a web app for **institutions running music competitions** (conservatories, associations, schools). It covers the whole lifecycle of a competition: public candidate registration, phase and criteria configuration, live judging sessions, average computation with several statistical methods, protocol and minutes export.

The architecture is **multitenant native**: a single backend hosts N independent institutions, each on its own subdomain, with database-level data isolation and a dedicated administrator. A central super-admin panel manages all institutions.

## Main features

### 👑 Super-admin
- Manage tenants from a UI (create, edit, suspend, archive with configurable cleanup)
- SMTP configuration **per tenant** (different providers per institution), credentials encrypted at-rest
- Create tenant admins without server shell access
- **SaaS plans configured from the UI** (`piani` table, super-admin CRUD): limits `max_concorsi`, `max_iscritti_annui`, `ppe_*`; assigning a plan to a tenant copies the limits into `tenant_config`. Enforced server-side and not bypassable by tenant admins.
- Aggregated stats (competitions, judges, candidates per tenant)
- **Real-time metrics**: gradient KPI cards with Node process RSS/CPU plus 5-min sparkline (5s polling); per-tenant `req/min`, `latency p50/p95`, `error rate` from global Fastify hooks
- Platform audit log separated from per-tenant audit

### 🛠 Tenant admin
- **Phases** with 5 average methods (arithmetic, olympic, winsorized, median, std-dev) + automatic suggestion based on judge count
- **Sections and categories** (e.g. Strings → Senior/Junior) + **copy categories across sections**
- **Candidates** as solo or groups, N:1 model candidate → section + category; **auto-derive section** from chosen category
- **CSV import** with template (`tipo`, `gruppo_nome`, `sezione`, `categoria`)
- **Judges** with chair designation per commission
- **Commissions** grouping judges + sections + categories
- **Granular phase permissions**: start/end/draw/timer executable by admin OR the chair of the assigned commission
- **Phase scoping**: a phase can be restricted to specific sections (parallel tracks)
- **Order shuffling** with reproducible seed (mulberry32)
- **Results**: live leaderboard, CSV and PDF protocol export
- **Minutes** with template + dynamic tags; **Calendar** drag-and-drop + public page
- **Tenant branding**: logo + colors + contact data in JSONB
- **Append-only tamper-evident audit log** (per-row HMAC chain)

### 🎼 Judge / Chair
- **Autonomous** judging or **synchronous** (piloted by the chair)
- **Phase timer** shared in real time via Postgres `LISTEN/NOTIFY` + SSE
- Score per criterion with configurable weights (sum = 100%), decimal scores (`numeric(5,2)`)
- Scoring UI rewritten following the Cadenza pattern (slider/preset chips + criteria bar + autosave); no threshold % verdict shown during voting (avoids bias)
- **Chair panel**: start phase with pre-flight check, timer control (start/pause/resume/+1 min), candidate shuffle, end-phase with double confirmation
- **Read-only summary of closed phases with verdicts** visible to both the judge and the chair (no way to alter votes once the phase is `CONCLUSA`)

### 📝 Public registration
- Single-page self-service form, no login required
- Automatic **save & resume** via localStorage
- Email verification + admin approval workflow
- Server-side anti-spam: honeypot, min-time-on-page, IP rate-limit

### 🔒 Hardening
- **Tenant isolation via Row-Level Security** at the database layer
- **SMTP passwords** encrypted at-rest (AES-GCM, `enc:v1:` envelope, `GESTIMUS_SECRET_KEY` 32-byte hex)
- **Auth**: `HttpOnly` `SameSite=Strict` session cookie, Argon2id, no JWT in localStorage; session key rotation supported
- **Optional TOTP 2FA** self-service (QR enrollment + recovery codes), enforced via `/auth/login/verify-totp`
- **GDPR export/erase** endpoints per tenant with audit trail (HMAC chain re-signed on PII scrub)
- **Authoritative server-side scoring**: the shared `@gestimus/scoring` package (single source of truth) runs on both client (UX) and server (truth) — clients cannot force a ranking
- **Optimistic locking** on race-prone entities (e.g. registrations, phases) to prevent destructive concurrent writes
- **Service layer + domain events / transactional outbox** on evaluations: invariant "vote persisted ⟺ event emitted" preserved even on mid-flow failures (silent failures captured by Sentry)

### 🌐 Internationalization
Italian (master), English, French, Spanish. Flat keys (`keySeparator: false`), automatic fallback to Italian.

---

## Architecture

```
  Browser (React 19 + Vite)          nginx (port 443/80)
  ente1.gestimus.local:5173  ───────► *.gestimus.it   ← Let's Encrypt wildcard
        │  proxy /api /auth                │
        ▼                                  ▼
  ┌─────────────────────────────────────────────────┐
  │  Gestimus server  :4000                         │
  │  Node 22 + Fastify 5 + strict TypeScript        │
  │  Drizzle ORM  ·  HttpOnly cookie-session        │
  └────────────────────┬────────────────────────────┘
                       │  resolve subdomain → tenant_id
                       ▼
             ┌──────────────────────┐
             │  PostgreSQL 18       │  RLS policy per table
             │  database "gestimus" │  isolation by tenant_id
             │  :5432               │  LISTEN/NOTIFY → SSE
             └──────────────────────┘
```

A **single Node/Fastify process** + a **single Postgres database**. Tenant separation is enforced by **Row-Level Security**. In dev the React frontend (Vite :5173) proxies `/api`, `/auth`, `/uploads` to the backend :4000 preserving the `Host` header for tenant resolution.

---

## Stack

### Frontend (React)

| | |
|---|---|
| **Framework** | React 19 + strict TypeScript |
| **Build tool** | Vite 8 |
| **Styling** | Tailwind CSS 4 + `legacy.css` (HSL shadcn/ui tokens, brand/ink palette) |
| **Components** | Radix UI + `src/components/ui/` (shadcn-style) |
| **Server data** | TanStack Query v5 (staleTime 30s, retry 1) |
| **Routing** | React Router v7 (lazy pages, ProtectedRoute/RequireAdmin guards) |
| **Forms** | react-hook-form v7 + Zod 4 (`@hookform/resolvers`) |
| **i18n** | i18next + react-i18next, flat keys, 4 languages (it/en/fr/es) |
| **Errors** | Sentry (`@sentry/react`, optional sourcemap upload in CI) |
| **PWA** | vite-plugin-pwa + Workbox (SW `generateSW`, NetworkOnly on `/api/*`) |
| **Tests** | Vitest (jsdom) + Playwright (E2E Chromium) |
| **Auth** | HttpOnly cookie-session (no token in localStorage) |

> The legacy vanilla frontend (`js/`, `css/`, `index.html` at the repo root) was **removed in May 2026**: the React app in `frontend/` is the only frontend, always served by Fastify from `frontend/dist`. The legacy PocketBase instance is gone too — the backend runs **only** on Postgres + Fastify + Drizzle.

### Backend

| | |
|---|---|
| **Runtime** | Node.js 22 LTS + Fastify 5 + strict TypeScript |
| **ORM** | Drizzle + drizzle-kit migrations |
| **Database** | PostgreSQL 18 (logical multitenancy via RLS, native `uuidv7()` for PKs) |
| **Auth** | HttpOnly session cookie + Argon2id (`@node-rs/argon2`) |
| **Realtime** | Postgres `LISTEN/NOTIFY` + Fastify SSE plugin (path `/api/realtime/...`) |
| **Storage** | Local filesystem partitioned per tenant (`uploads/<tenant_slug>/...`) |
| **Email** | Nodemailer + AES-GCM credential encryption (`enc:v1:`) |
| **Architecture** | Service layer on evaluations · domain events / transactional outbox · shared `@gestimus/scoring` package (server + frontend) |
| **Errors** | Sentry Node (silent failures included) |

---

## Quick start (local)

Requires macOS or Linux, **Node 22 LTS**, **PostgreSQL 18**.

```bash
git clone https://github.com/danilorussosax/gestimus.git
cd gestimus

# 1. Local Postgres (macOS via Homebrew, or use Docker)
brew install postgresql@18
brew services start postgresql@18
createdb gestimus

# 2. Backend
cd server
npm install
cp .env.example .env
# → edit DATABASE_URL_*, SESSION_COOKIE_SECRET, GESTIMUS_SECRET_KEY (32-byte hex)

npm run db:bootstrap        # creates gestimus_app / gestimus_super roles
npm run db:setup            # push Drizzle schema + apply RLS policies
npm run db:seed             # demo data (1 super-admin + 2 tenants + sample competition)
npm run dev                 # Fastify backend on :4000
```

```bash
# 3. React frontend (separate terminal)
cd frontend
npm install
npm run dev                 # Vite on :5173, proxy → :4000
```

Add the subdomains to `/etc/hosts` (simple fallback):

```
127.0.0.1  platform.gestimus.local
127.0.0.1  ente1.gestimus.local
127.0.0.1  ente2.gestimus.local
```

After boot:
- `http://ente1.gestimus.local:5173/` → React app (admin/judge)
- `http://platform.gestimus.local:5173/` → super-admin
- `http://ente1.gestimus.local:4000/` → backend directly (no Vite proxy)
- Demo credentials: see `npm run db:seed` output (also summarised in [`ONBOARDING.md`](ONBOARDING.md))

> **Do not use `localhost`**: the backend resolves the tenant from the subdomain — `/api/*` returns 400 without a `*.gestimus.local` host. To skip `/etc/hosts` and get clean URLs (no port) use the built-in dev-proxy: `./scripts/dev-proxy.sh up` (details in [`ONBOARDING.md`](ONBOARDING.md)).

To reset the dev database: `cd server && npm run db:reset`.

---

## Production build

```bash
# Frontend: type-check + bundle
cd frontend && npm run build      # tsc -b && vite build → frontend/dist/

# Backend
cd server && npm run build        # tsc → server/dist/
```

The Fastify server serves static files from `frontend/dist/` in production (via `@fastify/static`).

---

## Project structure

```
gestimus/
├── frontend/                    # React frontend (the only frontend)
│   ├── src/
│   │   ├── api/                 # fetch modules per entity (auth, concorsi, fasi, …)
│   │   ├── components/
│   │   │   ├── ui/              # shadcn-style primitives (Button, Dialog, Select, …)
│   │   │   ├── admin/           # admin tabs (FasiTab, CandidatiTab, RisultatiTab, CalendarioTab, …)
│   │   │   └── layout/          # AppLayout (authenticated shell)
│   │   ├── contexts/            # AuthContext · ThemeContext
│   │   ├── hooks/               # useFaseRuntime · useOnline · useDirtyDialogClose · …
│   │   ├── i18n/                # i18next init + locales/it|en|fr|es.json
│   │   ├── lib/                 # api.ts (http client) · scoring · tiebreak · rng · sentry · pwa
│   │   ├── pages/               # Home · Login · Commissario · Superadmin · admin/ · public/
│   │   ├── types/               # API contract (User, Concorso, Fase, …)
│   │   ├── index.css            # Tailwind 4 + custom tokens (brand/ink palette)
│   │   ├── legacy.css           # shadcn/ui HSL tokens (design heritage)
│   │   └── main.tsx             # entry point (BrowserRouter + QueryClient + AuthProvider)
│   ├── tests/e2e/               # Playwright smoke spec
│   ├── vite.config.ts           # Vite + PWA + Sentry + dev proxy (manualChunks tuned for rolldown)
│   ├── playwright.config.ts     # E2E config (base: ente1.gestimus.local:5173)
│   └── package.json
├── packages/
│   └── scoring/                 # Shared @gestimus/scoring package (single source of truth: means, tiebreak)
├── server/                      # Fastify + Drizzle backend
│   ├── src/
│   │   ├── db/                  # Drizzle schema + RLS policies (policies.sql)
│   │   ├── routes/              # REST endpoints for domain entities + super-admin
│   │   ├── services/            # auth · session · storage · email · SMTP crypto · scoring · outbox · audit (HMAC)
│   │   ├── middleware/          # tenant resolver (subdomain → tenant_id) + auth guard + runtime-metrics
│   │   └── realtime/            # SSE hub + LISTEN/NOTIFY bridge
│   ├── scripts/                 # bootstrap-db · apply-policies · seed-dev · seed-prod · seed-piani · backup · migrate
│   ├── tests/                   # rls/ · auth/ · crud/ · realtime/
│   └── package.json
├── tests/
│   └── load/                    # autocannon load tests (hot paths) — perf
├── deploy/                      # install.sh (bare-metal IONOS provisioning) + nginx rate-limit snippet
├── scripts/
│   └── dev-proxy.sh             # local nginx+dnsmasq reverse-proxy (clean *.gestimus.local URLs)
├── docs/                        # Documentation (deploy, HA Postgres, admin manual)
└── .github/                     # CI + Dependabot + issue/PR templates
```

---

## npm scripts

### Backend (`server/`)

```bash
npm run dev              # tsx watch on :4000
npm run build            # compile TypeScript
npm run start            # run production build
npm run db:bootstrap     # create gestimus_app / gestimus_super roles + DB gestimus
npm run db:setup         # db:push + apply RLS policies
npm run db:seed          # demo data (tenants + accounts)
npm run db:seed:prod     # bootstrap production super-admin
npm run db:reset         # drop + rebuild + seed (dev only)
npm run db:studio        # Drizzle Studio (table inspection UI)
npm run db:sql:status    # incremental migration ledger status
npm run db:sql:up        # apply pending migrations
npm run db:sql:down      # rollback last migration
npm run db:sql:baseline  # mark existing DB as aligned
npm run db:backup        # streaming PG dump (used by systemd timer in prod)
npm run test             # all suites (rls + auth + crud + realtime)
npm run test:rls         # cross-tenant isolation only
npm run test:auth        # login/logout/me + cross-tenant guard + TOTP
npm run test:crud        # CRUD + triggers + privacy + calendar + cleanup + platform
npm run test:realtime    # LISTEN/NOTIFY → SSE
npm run lint             # tsc --noEmit (tsconfig.lint.json)
```

### Frontend (`frontend/`)

```bash
npm run dev              # Vite dev server :5173 (with HMR)
npm run build            # tsc -b && vite build → dist/
npm run typecheck        # tsc -b --noEmit (type-check only)
npm run lint             # ESLint strict-type-checked
npm run lint:fix         # ESLint + autofix
npm run test             # Vitest (unit/components, jsdom)
npm run test:coverage    # Vitest + v8 coverage
npm run e2e              # Playwright E2E (requires backend :4000 + dev server :5173)
```

### Root

```bash
# Load tests (autocannon) — backend must be running
node tests/load/<scenario>.js
```

---

## Documentation

| File | Content |
|------|---------|
| [`ONBOARDING.md`](ONBOARDING.md) | **Local dev setup** (Italian) — env vars, db:bootstrap/setup/seed, nginx+dnsmasq dev-proxy, demo credentials |
| [`docs/manuale-admin.md`](docs/manuale-admin.md) | **Tenant-admin operational manual** (Italian) — also reachable in-app from *Admin → Manuale* |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | **IONOS deploy guide** (Italian) — `deploy/install.sh` (Node + PG18 + nginx + systemd + ufw), DNS-01 wildcard certbot, daily backup, TLS renewal |
| [`docs/HA-POSTGRES.md`](docs/HA-POSTGRES.md) | **Postgres high availability** (Italian) — streaming replication, Patroni + etcd, HAProxy, PITR, failover runbook |
| [`server/README.md`](server/README.md) | **Backend reference** — REST endpoints, RLS, DB triggers, scoring + outbox, 2FA TOTP, runtime metrics |
| [`deploy/README.md`](deploy/README.md) | **Provisioning script** (Italian) — `install.sh` flags, `TLS_MODE`, main env vars |

---

## Contributing

See [.github/pull_request_template.md](.github/pull_request_template.md) for the PR flow.

Commits follow a minimal convention:
- `feat:` new feature
- `fix:` bug fix
- `chore:` infra/ops
- `deps:` dependencies (Dependabot)
- `ci:` GitHub Actions workflows
- `docs:` documentation

## License

Proprietary code — not distributable without the owner's authorization.

---

<div align="center">

Crafted with ❤ for music institutions. Questions or proposals? Open an [issue](https://github.com/danilorussosax/gestimus/issues/new/choose).

</div>
