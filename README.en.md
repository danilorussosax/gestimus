<div align="center">

# Gestimus

**Music Competition Manager** — multitenant platform to organize and judge music competitions across multiple phases.

[🇮🇹 Italiano](README.md) · 🇬🇧 English

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-22%20LTS-339933)
![Fastify](https://img.shields.io/badge/Fastify-5-202020)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
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
- Platform audit log separated from per-tenant audit

### 🛠 Tenant admin
- **Phases** with 5 average methods (arithmetic, olympic, winsorized, median, std-dev filter) + automatic suggestion based on judge count
- **Sections and categories** (e.g. Strings → Senior/Junior) + **copy categories across sections** (one click to replicate the structure)
- **Candidates** as solo or groups (with multiple members)
- **Judges** with chair designation
- **Commissions** that group judges + sections + categories
- **Phase scoping**: a phase can be restricted to a single section (parallel tracks) or open to everyone
- **Order shuffling** with reproducible seed (mulberry32)
- **Results**: live leaderboard, podium, CSV export (RFC 4180 + UTF-8 BOM, formula-injection safe) and PDF protocol
- **Minutes** with template + dynamic tags (`{competition}`, `{chair}`, …)
- **Append-only audit log** for every operation

### 🎼 Judge
- **Autonomous** judging (each judge at their own pace) or **synchronous** (everyone on the same candidate, piloted by the chair)
- **Phase timer** shared in real time via Postgres `LISTEN/NOTIFY` + SSE
- Score per criterion with configurable weights (sum = 100%)
- Pictograms and sliders for quick scoring
- Last evaluations history visible

### 📝 Public registration
- **Single-page** self-service form, no login required
- Dedicated subdomain per tenant
- Demographics, contacts, artistic data, repertoire, attachments (photo/ID/payment receipt)
- **Group mode** with dynamic member composition
- Guardian section required if candidate is under 16 (server-side, GDPR Art. 8)
- Automatic **save & resume** via localStorage
- Email verification link (token regenerated server-side)
- Admin approval workflow → generates candidate record
- Server-side anti-spam: honeypot, min-time-on-page, IP rate-limit (3/h, 10/day)

### 🔒 Hardening
- **Tenant isolation via Row-Level Security**: every query runs with `app.tenant_id` set by middleware; RLS policies reject cross-tenant reads/writes at the database layer
- **SMTP passwords** encrypted at-rest (AES-GCM, key from env `GESTIMUS_SECRET_KEY`)
- **`audit_log`** append-only (no delete, not even by tenant admin) + separate **`platform_audit_log`** for super-admin actions
- **`valutazioni`** with unique index `(candidato_fase, commissario, criterio)` + vote clamp + freeze on CONCLUSA phase, enforced by DB triggers
- **`iscrizioni`** with server-side validation of GDPR consents + competition state + deadline
- **Auth**: `HttpOnly` `SameSite=Strict` session cookie, Argon2id password hashing, no JWT in localStorage
- **`accounts`** with closed creation rule (no public privilege escalation) + check preventing self-promotion of the `role` field
- **Public form** with honeypot + app-level rate-limit (on top of the nginx rate-limit in `deploy/nginx-snippet-rl.conf`)
- **GDPR export/erase** endpoints per tenant with audit trail

### 🌐 Internationalization
Italian (master), English, French, Spanish. Untranslated keys fall back to Italian automatically. The **Gestimus** name stays the same across languages, the subtitle is localized.

## Architecture

```
                       ┌─────────────────────────┐
                       │   nginx (port 443/80)   │  ← Let's Encrypt wildcard
                       │   *.gestimus.it          │     (DNS-01 IONOS)
                       └──┬──────────────────────┘
                          │
                          ▼
                ┌────────────────────────┐
                │  Gestimus server       │  Node 22 + Fastify 5
                │  (single process)      │  strict TypeScript
                │   :4000                │  Drizzle ORM
                └─────┬──────────────────┘
                      │   resolve subdomain → tenant_id
                      │   set app.tenant_id (per session)
                      ▼
                ┌────────────────────────┐
                │  PostgreSQL 16         │  RLS policy per table
                │  database "gestimus"   │  isolation by tenant_id
                │   :5432                │  LISTEN/NOTIFY → SSE
                └────────────────────────┘
```

A **single Node/Fastify process** + a **single Postgres database**. Tenant separation is enforced by **Row-Level Security**: each connection sets `app.tenant_id` based on the subdomain resolved by the middleware, and RLS policies automatically filter every `SELECT/INSERT/UPDATE/DELETE`. Administrative operations (create tenant, suspend, archive, configure SMTP) are super-admin UI actions, not shell scripts.

## Stack

- **Frontend**: HTML + vanilla JavaScript (no framework), Tailwind CSS, service worker for PWA
- **Backend**: Node.js 22 LTS + Fastify 5 + strict TypeScript
- **ORM**: Drizzle + drizzle-kit migrations
- **Database**: PostgreSQL 16 with logical multitenancy via Row-Level Security
- **Auth**: HttpOnly session cookie + Argon2id (`@node-rs/argon2`)
- **Realtime**: Postgres `LISTEN/NOTIFY` + Fastify SSE plugin
- **Storage**: local filesystem partitioned per tenant
- **Email**: Nodemailer + AES-GCM credential encryption
- **Reverse proxy**: nginx (preferred) or Caddy (fallback)
- **TLS**: Let's Encrypt wildcard via certbot DNS-01
- **DNS**: IONOS (dedicated certbot plugin)
- **CI**: GitHub Actions (lint TS + bash + i18n coverage)
- **Dependencies kept up to date**: weekly Dependabot

## Quick start (local)

Requires macOS or Linux, **Node 22 LTS**, **PostgreSQL 16**.

```bash
git clone https://github.com/danilorussosax/gestimus.git
cd gestimus

# 1. Local Postgres (macOS via Homebrew, or use Docker)
brew install postgresql@16
brew services start postgresql@16
createdb gestimus

# 2. Backend
cd server
npm install
cp .env.example .env
# → edit DATABASE_URL_*, SESSION_COOKIE_SECRET, GESTIMUS_SECRET_KEY (32-byte hex)

npm run db:bootstrap        # creates gestimus_app / gestimus_super roles
npm run db:setup            # push Drizzle schema + apply RLS policies
npm run db:seed             # demo data (1 super-admin + 2 tenants + sample competition)

npm run dev                 # backend + static frontend on :4000
```

Add the subdomains to `/etc/hosts` (dev only):

```
127.0.0.1  platform.gestimus.local
127.0.0.1  ente1.gestimus.local
127.0.0.1  ente2.gestimus.local
```

After boot:
- `http://ente1.gestimus.local:4000/` → client app
- `http://platform.gestimus.local:4000/` → super-admin
- Demo credentials seeded by `npm run db:seed` (see output log)

To reset the dev database: `npm run db:reset`.

## Production deploy

Schema, DB roles, RLS, tenant soft-delete, pre-archive backups and super-admin workflow are described in [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) (sections 4-5, 15, 17). The document is in Italian.

The platform is designed to run on a **Linux VPS** behind nginx + Let's Encrypt wildcard. Minimum components:

1. **Ubuntu 24.04 VPS** with PostgreSQL 16 + Node 22 LTS
2. **Wildcard DNS** for the domain (`*.gestimus.it` + root)
3. **nginx** reverse-proxy `*.gestimus.it → 127.0.0.1:4000` (single upstream, no longer one process per tenant)
4. **systemd unit** for the Gestimus process + env vars `DATABASE_URL_*`, `SESSION_COOKIE_SECRET`, `GESTIMUS_SECRET_KEY`
5. **Wildcard Let's Encrypt cert** via certbot DNS-01 (IONOS plugin or equivalent)
6. **Automated DB backups** + retention for pre-hard-delete archives (see plan § 17)

nginx/systemd templates and provisioning scripts for the new stack are being finalized.

## Project structure

```
gestimus/
├── js/                          # vanilla frontend
│   ├── app.js                   # router + bootstrap
│   ├── db.js                    # data layer (REST client targeting the backend)
│   ├── api.js                   # typed HTTP client
│   ├── i18n.js                  # IT/EN/FR/ES translations
│   ├── scoring.js               # average algorithms + suggestions
│   ├── tiebreak.js              # tiebreak logic
│   ├── icons.js                 # Carbon SVG icon set
│   └── views/                   # views per role
│       └── home.js · login.js · iscrizione.js · admin*.js · commissario.js · superadmin.js
├── server/                      # Fastify + Drizzle backend
│   ├── src/
│   │   ├── db/                  # Drizzle schema + RLS policies (policies.sql)
│   │   ├── routes/              # REST endpoints for domain entities
│   │   ├── services/            # auth (Argon2id) · session · storage · email · SMTP crypto
│   │   ├── middleware/          # tenant resolver (subdomain → tenant_id) + auth guard
│   │   └── realtime/            # SSE hub + LISTEN/NOTIFY bridge
│   ├── scripts/                 # bootstrap-db · apply-policies · seed-dev · reset-dev
│   ├── tests/                   # rls/ · auth/ · crud/ · realtime/ (48 tests)
│   ├── drizzle.config.ts
│   └── package.json
├── tests/
│   ├── unit/                    # node --test (scoring.js, rng.js)
│   └── e2e/                     # playwright (client + super-admin smoke)
├── deploy/                      # nginx/systemd config templates
├── docs/                        # documentation (architecture, deploy, manuals, screenshots)
└── .github/                     # CI + Dependabot + issue/PR templates
```

## npm scripts

Backend (in `server/`):

```bash
npm run dev              # tsx watch + serves static frontend
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

Root:

```bash
npm run test:unit        # tests/unit (scoring + rng) — no DB
npm run test:e2e         # playwright (requires running server)
```

## Documentation

| File | Content |
|------|---------|
| [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) | **Full technical architecture** — DB schema, RLS policies, backend module layout, tenant soft-delete with configurable cleanup, TOTP 2FA, roadmap milestones (Italian) |
| [`docs/LISTINO.md`](docs/LISTINO.md) | **Commercial plan listing** — customer-facing pricing doc (Italian) |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | Historical IONOS VPS deploy guide (being updated for the new stack, Italian) |
| [`docs/manuale-admin.md`](docs/manuale-admin.md) | **Tenant-admin operational manual** (Italian) — also reachable in-app from *Admin → Manuale*. Screenshots live in `docs/screenshots/`. |

## Contributing

See [.github/pull_request_template.md](.github/pull_request_template.md) for the PR flow and [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE) for issue templates.

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
