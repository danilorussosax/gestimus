<div align="center">

# Gestimus

**Music Competition Manager** — multitenant platform to organize and judge music competitions across multiple phases.

[🇮🇹 Italiano](README.md) · 🇬🇧 English

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![PocketBase](https://img.shields.io/badge/PocketBase-0.22-4169E1)
![Migrating to](https://img.shields.io/badge/migrating%20to-Postgres%20%2B%20Fastify%20%2B%20Drizzle-336791)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS-yellow)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

---

> ⚠️ **Stack migration in progress** — the backend is moving from PocketBase to **PostgreSQL 16 + Node 22 + Fastify 5 + Drizzle ORM** with logical multitenancy via Row-Level Security. The new backend lives in [`server/`](server/) (Phases 0-5c complete: schema, RLS, auth, CRUD, realtime SSE, storage, encrypted SMTP, 48 tests passing). The PocketBase binary remains the reference stack until the port clears the full E2E suite. Detailed plan: [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md).

## What is Gestimus

Gestimus is a web app for **institutions running music competitions** (conservatories, associations, schools). It covers the whole lifecycle of a competition: public candidate registration, phase and criteria configuration, live judging sessions, average computation with several statistical methods, protocol and minutes export.

The architecture is **multitenant native**: a single server hosts N independent institutions, each on its own subdomain with isolated database and dedicated administrator. A central super admin panel manages all institutions.

## Main features

### 👑 Super admin
- Manage institutions (create / edit / remove)
- SMTP configuration **per institution** (different providers per tenant)
- Create admin via UI without SSH access
- Aggregated stats (competitions, judges, candidates per tenant)

### 🛠 Institution admin
- **Phases** with 5 average methods (arithmetic, olympic, winsorized, median, std-dev filter) + automatic suggestion based on judge count
- **Sections and categories** (e.g. Strings → Senior/Junior) + **copy categories across sections** (one click to replicate the structure)
- **Candidates** as solo or groups (with multiple members)
- **Judges** with chair designation
- **Commissions** that group judges + sections + categories
- **Phase scoping**: a phase can be restricted to a single section (parallel tracks) or open to everyone
- **Order shuffling** with reproducible seed
- **Results**: live leaderboard, podium, CSV export (RFC 4180 + UTF-8 BOM, formula-injection safe) and PDF protocol
- **Minutes** with template + dynamic tags (`{competition}`, `{chair}`, …)
- **Append-only audit log** for every operation

### 🎼 Judge
- **Autonomous** judging (each judge at their own pace) or **synchronous** (everyone on the same candidate, piloted by the chair)
- **Phase timer** shared in real time via PocketBase SSE
- Score per criterion with configurable weights (sum = 100%)
- Pictograms and sliders for quick scoring
- Last evaluations history visible

### 📝 Public registration
- **Single-page** self-service form, no login required
- Dedicated subdomain per competition
- Demographics, contacts, artistic data, repertoire, attachments (photo/ID/payment receipt)
- **Group mode** with dynamic member composition
- Guardian section required if candidate is under 16 (server-side, GDPR Art. 8)
- Automatic **save & resume** via localStorage
- Email verification link (token regenerated server-side)
- Admin approval workflow → generates candidate record
- Server-side anti-spam: honeypot, min-time-on-page, IP rate-limit (3/h, 10/day)

### 🔒 Bundled hardening (see `docs/MULTITENANT_PLAN.md` § Security)
- **PocketBase admin UI** (`/_/`) reachable only from localhost or an explicit IP allowlist
- **SMTP passwords** encrypted at-rest (AES-GCM, key from env `GESTIMUS_SECRET_KEY`)
- **audit_log** append-only (no delete, not even by tenant admin)
- **valutazioni** with unique index `(candidato_fase, commissario, criterio)` + vote clamp + freeze when phase is CONCLUSA
- **iscrizioni** with server-side validation of GDPR consents + competition state + deadline
- **accounts** with `createRule` closed (no public privilege escalation) + hook preventing self-promotion of `role`
- **Public form** with honeypot + app-level rate-limit (plus the nginx rate-limit in `deploy/nginx-snippet-rl.conf`)

### 🌐 Internationalization
Italian (master), English, French, Spanish. Untranslated keys fall back to Italian automatically. The **Gestimus** name stays the same across languages, the subtitle is localized.

## Architecture

```
                       ┌─────────────────────────┐
                       │   nginx (port 443/80)   │  ← Let's Encrypt wildcard
                       │   *.gestimus.it          │     (DNS-01 IONOS)
                       └──┬──────────────────────┘
            ┌─────────────┼─────────────────────┬────────────┐
            ▼             ▼                     ▼            ▼
   platform.gestimus.it  ente1.gestimus.it   ente2.gestimus.it  ente3.…
       :8093                :8091                :8092            :809…
   pb@platform          pb@ente1              pb@ente2          pb@ente3
   (super admin)        (Conservatory MI)     (School RM)       …
```

Each tenant is an **isolated PocketBase process** with its own SQLite. nginx reverse-proxies via subdomain. A single wildcard certificate covers all current and future tenants.

> In the new backend under `server/`, this physical multitenancy (one binary per tenant) is replaced by **logical multitenancy**: a single Node/Fastify process + a single PostgreSQL database, with isolation enforced by Row-Level Security policies on `tenant_id` resolved from the subdomain. All administration (create tenant, suspend, archive, configure SMTP) becomes a super-admin UI action instead of an SSH script.

## Stack

- **Frontend**: HTML + vanilla JavaScript (no framework), Tailwind CSS (CDN), service worker for PWA
- **Current backend (production)**: [PocketBase](https://pocketbase.io) 0.22 (Go binary, embedded SQLite, JS hooks via Goja)
- **Target backend (in `server/`, development)**: PostgreSQL 16 + Node.js 22 LTS + Fastify 5 + Drizzle ORM + strict TypeScript, Argon2id auth + session cookie, realtime via Postgres `LISTEN/NOTIFY` + SSE, logical multitenancy via **Row-Level Security** instead of one process per tenant
- **Reverse proxy**: nginx (preferred) or Caddy (fallback)
- **TLS**: Let's Encrypt wildcard via certbot DNS-01
- **DNS**: IONOS (dedicated certbot plugin)
- **CI**: GitHub Actions (lint JS + bash + migration check + i18n coverage)
- **Dependencies kept up to date**: weekly Dependabot

## Quick start (local)

Requires macOS or Linux, Node 18+, `caddy` for the multitenant dev setup.

```bash
git clone https://github.com/danilorussosax/gestimus.git
cd gestimus

# Download the PocketBase binary (~40 MB)
mkdir -p pocketbase
wget -O /tmp/pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.22.27/pocketbase_0.22.27_darwin_arm64.zip
unzip -o /tmp/pb.zip -d pocketbase

# Start 2 tenants + 1 platform + reverse-proxy Caddy
./scripts/start-local-multitenant.sh
```

After boot:
- `http://ente1.test:8000/` → client app
- `http://platform.test:8000/` → super admin
- Default credentials: `admin@ente1.test` / `admin123` (change them in production!)

To stop everything: `./scripts/start-local-multitenant.sh stop`.

## Production deploy

Full guide: [**docs/DEPLOY-IONOS.md**](docs/DEPLOY-IONOS.md) (in Italian).

In short (~30 minutes from a blank VPS):

1. **Ubuntu 24.04 VPS** (recommended IONOS **VPS L+**: 6 vCPU, 8 GB RAM, 240 GB NVMe — **€5/month promo · €8 on renewal**, VAT excluded)
2. **Wildcard DNS** for the domain (`*.gestimus.it` + root)
3. **IONOS API key** for certbot DNS-01
4. `sudo bash scripts/setup-server.sh` → installs everything + generates `GESTIMUS_SECRET_KEY` in `/etc/pb/platform.env` + installs nginx rate-limit snippet
5. `sudo certbot certonly ... -d gestimus.it -d "*.gestimus.it"` → wildcard cert
6. `sudo ./scripts/provision-tenant.sh platform` → super admin live (admin UI `/_/` exposed to localhost only)
7. `sudo ./scripts/provision-tenant.sh tenant-slug` → first client
   - To grant `/_/` access to specific IPs (office, VPN): `ADMIN_ALLOW_IPS="1.2.3.4,5.6.7.0/24" sudo ./scripts/provision-tenant.sh tenant1`

### Reaching the PocketBase admin UI after hardening

After provisioning, `/_/` is reachable only from `127.0.0.1`. To access from your laptop:

```bash
# Local SSH tunnel + open in browser
ssh -L 8091:localhost:8091 user@server
# Then: http://localhost:8091/_/
```

Alternatively add your static IP/range to the allowlist (see `ADMIN_ALLOW_IPS` in `provision-tenant.sh`).

**Yearly cost (year 1 promo, VAT excl.)**: ~€80 (VPS €60 + setup €10 + domain €10). From year 3: ~€108 net of VAT. Hosts **20-50 tenants** on the same server.

## Project structure

```
gestimus/
├── js/                          # frontend (vanilla JS, shared across both backends)
│   ├── app.js                   # router + bootstrap
│   ├── db.js                    # data layer — REST adapter (legacy signatures preserved)
│   ├── db.legacy.js             # pre-migration PocketBase data-layer snapshot
│   ├── pb.js                    # client (compat stub against new backend)
│   ├── pb.legacy.js             # pre-migration PocketBase client
│   ├── api.js                   # REST client targeting server/ (Postgres)
│   ├── i18n.js                  # IT/EN/FR/ES translations
│   ├── scoring.js               # average algorithms + suggestions
│   ├── tiebreak.js              # tiebreak logic
│   ├── icons.js                 # Carbon SVG icon set
│   └── views/                   # views per role
│       ├── home.js · login.js · iscrizione.js · admin*.js · commissario.js · superadmin.js
├── server/                      # ⬅ NEW Postgres+Fastify+Drizzle backend (in development)
│   ├── src/
│   │   ├── db/                  # Drizzle schema + RLS policies
│   │   ├── routes/              # REST endpoints (concorsi, fasi, valutazioni, …)
│   │   ├── services/            # auth, session, storage, email, SMTP crypto
│   │   ├── middleware/          # tenant resolver + auth guard
│   │   └── realtime/            # SSE hub + LISTEN/NOTIFY
│   ├── scripts/                 # bootstrap-db, apply-policies, seed-dev, reset-dev
│   ├── tests/                   # rls/, auth/, crud/, realtime/ (48 tests)
│   └── drizzle.config.ts
├── pb_migrations/               # versioned PocketBase schema (43 migrations)
├── pb_hooks/                    # PocketBase server-side custom endpoints
│   ├── iscrizioni.pb.js         # approval workflow + email + anti-bot + rate-limit
│   ├── accounts.pb.js           # blocks self-promote role/attivo/email
│   ├── valutazioni.pb.js        # vote clamp + freeze on CONCLUSA phase
│   ├── tenants.pb.js            # SMTP password encryption + decrypt endpoint
│   ├── tenant_config.pb.js      # SaaS plan config + server-side gating
│   ├── fasi.pb.js               # phase logic (tiebreak)
│   ├── privacy.pb.js            # GDPR export/erase
│   └── setup.pb.js              # has-admin probe + create-admin
├── tests/
│   ├── unit/                    # node --test (scoring.js, rng.js)
│   └── e2e/                     # playwright
├── scripts/                     # deploy/ops automation
│   ├── setup-server.sh · provision-tenant.sh · remove-tenant.sh
│   ├── apply-ente-smtp.sh · encrypt-existing-smtp.mjs
│   ├── seed-demo-manual.js · take-screenshots*.mjs
│   └── start-local-multitenant.sh
├── deploy/                      # nginx/systemd/Caddy config templates
└── docs/                        # documentation (deploy, migration, manuals, screenshots)
```

## npm scripts

```bash
npm run test:unit     # node --test on tests/unit/ (scoring + rng) — no PB needed
npm run test:e2e      # playwright (requires local PB on 127.0.0.1:8090)
npm run backup        # tar.gz backup of local pb_data
npm run cleanup:e2e   # purges test records from the DB
```

## Documentation

| File | Content |
|------|---------|
| [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) | **Postgres+Fastify+Drizzle migration plan** — schema, RLS, PB→new-backend module mapping, tenant soft-delete, TOTP 2FA, milestones |
| [`docs/LISTINO.md`](docs/LISTINO.md) | **Commercial plan listing** — customer-facing pricing doc (Italian) |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | Full IONOS VPS deploy guide (Italian) |
| [`docs/MULTITENANT_PLAN.md`](docs/MULTITENANT_PLAN.md) | Multitenant architecture design (PocketBase stack, historical) |
| [`docs/POCKETBASE.md`](docs/POCKETBASE.md) | Backend notes (PocketBase) |
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
