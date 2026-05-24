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

### 🎼 Judge
- **Autonomous** judging or **synchronous** (piloted by the chair)
- **Phase timer** shared in real time via Postgres `LISTEN/NOTIFY` + SSE
- Score per criterion with configurable weights (sum = 100%), decimal scores (`numeric(5,2)`)

### 📝 Public registration
- Single-page self-service form, no login required
- Automatic **save & resume** via localStorage
- Email verification + admin approval workflow
- Server-side anti-spam: honeypot, min-time-on-page, IP rate-limit

### 🔒 Hardening
- **Tenant isolation via Row-Level Security** at the database layer
- **SMTP passwords** encrypted at-rest (AES-GCM)
- **Auth**: `HttpOnly` `SameSite=Strict` session cookie, Argon2id, no JWT in localStorage
- **Optional TOTP 2FA** self-service (QR enrollment + recovery codes)
- **GDPR export/erase** endpoints per tenant with audit trail

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

> The legacy vanilla frontend (`js/`, `css/`, `index.html` at the repo root) is **superseded** by the React frontend in `frontend/`. The vanilla code is preserved but no longer actively developed.

### Backend

| | |
|---|---|
| **Runtime** | Node.js 22 LTS + Fastify 5 + strict TypeScript |
| **ORM** | Drizzle + drizzle-kit migrations |
| **Database** | PostgreSQL 18 (logical multitenancy via RLS, native `uuidv7()` for PKs) |
| **Auth** | HttpOnly session cookie + Argon2id (`@node-rs/argon2`) |
| **Realtime** | Postgres `LISTEN/NOTIFY` + Fastify SSE plugin |
| **Storage** | Local filesystem partitioned per tenant |
| **Email** | Nodemailer + AES-GCM credential encryption |

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

Add the subdomains to `/etc/hosts`:

```
127.0.0.1  platform.gestimus.local
127.0.0.1  ente1.gestimus.local
127.0.0.1  ente2.gestimus.local
```

After boot:
- `http://ente1.gestimus.local:5173/` → React app (admin/judge)
- `http://platform.gestimus.local:5173/` → super-admin
- `http://ente1.gestimus.local:4000/` → backend directly (no Vite proxy)
- Demo credentials: see `npm run db:seed` output

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
├── frontend/                    # React frontend (current stack)
│   ├── src/
│   │   ├── api/                 # fetch modules per entity (auth, concorsi, fasi, …)
│   │   ├── components/
│   │   │   ├── ui/              # shadcn-style primitives (Button, Dialog, Select, …)
│   │   │   ├── admin/           # admin tabs (FasiTab, CandidatiTab, RisultatiTab, …)
│   │   │   └── layout/          # AppLayout (authenticated shell)
│   │   ├── contexts/            # AuthContext · ThemeContext
│   │   ├── hooks/               # useFaseRuntime · useOnline · useDirtyDialogClose · …
│   │   ├── i18n/                # i18next init + locales/it|en|fr|es.json
│   │   ├── lib/                 # api.ts (http client) · scoring · tiebreak · rng · sentry · pwa
│   │   ├── pages/               # Home · Login · Commissario · Superadmin · admin/ · public/
│   │   ├── types/               # API contract (User, Concorso, Fase, …)
│   │   ├── index.css            # Tailwind 4 + custom tokens (brand/ink palette)
│   │   ├── legacy.css           # shadcn/ui HSL tokens ported from vanilla
│   │   └── main.tsx             # entry point (BrowserRouter + QueryClient + AuthProvider)
│   ├── tests/e2e/               # Playwright smoke spec
│   ├── vite.config.ts           # Vite + PWA + Sentry + dev proxy
│   ├── playwright.config.ts     # E2E config (base: ente1.gestimus.local:5173)
│   └── package.json
├── server/                      # Fastify + Drizzle backend
│   ├── src/
│   │   ├── db/                  # Drizzle schema + RLS policies (policies.sql)
│   │   ├── routes/              # REST endpoints for domain entities
│   │   ├── services/            # auth · session · storage · email · SMTP crypto
│   │   ├── middleware/          # tenant resolver (subdomain → tenant_id) + auth guard
│   │   └── realtime/            # SSE hub + LISTEN/NOTIFY bridge
│   ├── scripts/                 # bootstrap-db · apply-policies · seed-dev · reset-dev
│   ├── tests/                   # rls/ · auth/ · crud/ · realtime/ (~154 tests)
│   └── package.json
├── tests/
│   ├── unit/                    # node --test (scoring, tiebreak, rng) — no DB
│   └── e2e/                     # legacy Playwright (client + super-admin smoke)
├── js/                          # [SUPERSEDED] Vanilla frontend (preserved, not developed)
├── css/                         # [SUPERSEDED] Vanilla styles
├── deploy/                      # nginx/systemd config templates
├── docs/                        # Documentation (architecture, deploy, manuals)
└── .github/                     # CI + Dependabot + issue/PR templates
```

---

## npm scripts

### Backend (`server/`)

```bash
npm run dev              # tsx watch on :4000
npm run build            # compile TypeScript
npm run start            # run production build
npm run db:bootstrap     # create gestimus_app / gestimus_super roles
npm run db:setup         # db:push + apply RLS policies
npm run db:seed          # demo data
npm run db:reset         # drop + rebuild + seed (dev only)
npm run db:studio        # Drizzle Studio (table inspection UI)
npm run test             # all suites (rls + auth + crud + realtime)
npm run test:rls         # cross-tenant isolation only
npm run lint             # tsc --noEmit
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
npm run test:unit        # tests/unit (scoring + rng) — no DB
npm run test:e2e         # legacy Playwright (requires running server)
```

---

## Documentation

| File | Content |
|------|---------|
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | **React frontend guide** — stack, src/ layout, conventions, how to add a page, build/lint/test |
| [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) | **Full technical architecture** — DB schema, RLS policies, backend module layout, tenant soft-delete, TOTP 2FA, roadmap milestones (Italian) |
| [`docs/AUDIT.md`](docs/AUDIT.md) | **Security/hardening status** (Italian) — current snapshot + audit-round history |
| [`docs/TEST.md`](docs/TEST.md) | **Testing & verification** (Italian) — test pyramid (unit/server/E2E frontend+legacy/type-check/load), commands, prerequisites, load-test reference results, CI gates |
| [`docs/LISTINO.md`](docs/LISTINO.md) | **Commercial plan listing** (Italian) |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | **IONOS VPS deploy guide** (Italian) — single systemd unit, certbot DNS-01, PG backups, PgBouncer |
| [`docs/HA-POSTGRES.md`](docs/HA-POSTGRES.md) | **High availability** (Italian) — streaming replication + automatic failover, PITR, ops runbook |
| [`docs/manuale-admin.md`](docs/manuale-admin.md) | **Tenant-admin operational manual** (Italian) — also reachable in-app from *Admin → Manuale* |
| [`server/README.md`](server/README.md) | **Backend reference** — Drizzle schema, REST endpoints, middleware, migrations, runtime metrics |

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
