<div align="center">

# Gestimus

**Music Competition Manager** — multitenant platform to organize and judge music competitions across multiple phases.

[🇮🇹 Italiano](README.md) · 🇬🇧 English

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![PocketBase](https://img.shields.io/badge/PocketBase-0.22-4169E1)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS-yellow)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

---

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
- **Sections and categories** (e.g. Strings → Senior/Junior)
- **Candidates** as solo or groups (with multiple members)
- **Judges** with chair designation
- **Commissions** that group judges + sections + categories
- **Phase scoping**: a phase can be restricted to a single section (parallel tracks) or open to everyone
- **Order shuffling** with reproducible seed
- **Results**: live leaderboard, podium, CSV export (RFC 4180 + UTF-8 BOM) and PDF protocol
- **Minutes** with template + dynamic tags (`{competition}`, `{chair}`, …)
- **Audit log** for every operation

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
- Guardian section auto-shown if candidate is a minor
- Automatic **save & resume** via localStorage
- Email verification link
- Admin approval workflow → generates candidate record

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

## Stack

- **Frontend**: HTML + vanilla JavaScript (no framework), Tailwind CSS (CDN), service worker for PWA
- **Backend**: [PocketBase](https://pocketbase.io) 0.22 (Go binary, embedded SQLite, JS hooks via Goja)
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

Full guide: [**DEPLOY-IONOS.md**](DEPLOY-IONOS.md) (in Italian).

In short (~30 minutes from a blank VPS):

1. **Ubuntu 24.04 VPS** (recommended IONOS **VPS L+**: 6 vCPU, 8 GB RAM, 240 GB NVMe — **€5/month promo · €8 on renewal**, VAT excluded)
2. **Wildcard DNS** for the domain (`*.gestimus.it` + root)
3. **IONOS API key** for certbot DNS-01
4. `sudo bash scripts/setup-server.sh` → installs everything
5. `sudo certbot certonly ... -d gestimus.it -d "*.gestimus.it"` → wildcard cert
6. `sudo ./scripts/provision-tenant.sh platform` → super admin live
7. `sudo ./scripts/provision-tenant.sh tenant-slug` → first client

**Yearly cost (year 1 promo, VAT excl.)**: ~€80 (VPS €60 + setup €10 + domain €10). From year 3: ~€108 net of VAT. Hosts **20-50 tenants** on the same server.

## Project structure

```
gestimus/
├── js/                          # frontend
│   ├── app.js                   # router + bootstrap
│   ├── db.js                    # PocketBase data layer
│   ├── pb.js                    # PB client wrapper
│   ├── i18n.js                  # IT/EN/FR/ES translations
│   ├── scoring.js               # average algorithms + suggestions
│   ├── icons.js                 # Carbon SVG icon set
│   └── views/                   # views per role
│       ├── home.js              # landing
│       ├── login.js             # auth
│       ├── iscrizione.js        # public form (single page)
│       ├── admin.js             # admin tabs
│       ├── admin-*.js           # admin sections (dashboard, stats, …)
│       ├── commissario.js       # judging
│       └── superadmin.js        # tenant management
├── pb_migrations/               # versioned schema (32 migrations)
├── pb_hooks/                    # server-side custom endpoints
│   ├── iscrizioni.pb.js         # approval workflow + email
│   └── setup.pb.js              # has-admin probe + create-admin
├── scripts/                     # deploy/ops automation
│   ├── setup-server.sh          # VPS provisioning
│   ├── provision-tenant.sh      # new tenant
│   ├── remove-tenant.sh         # remove tenant
│   ├── apply-ente-smtp.sh       # SMTP propagation
│   └── start-local-multitenant.sh
├── deploy/                      # config templates
│   ├── gestimus.env             # domain + paths
│   ├── pb@.service              # systemd template
│   └── nginx-tenant.conf.template
├── DEPLOY-IONOS.md              # deploy guide
└── .github/                     # CI + Dependabot + templates
```

## Documentation

| File | Content |
|------|---------|
| [`DEPLOY-IONOS.md`](DEPLOY-IONOS.md) | Full IONOS VPS deploy guide |
| [`MULTITENANT_PLAN.md`](MULTITENANT_PLAN.md) | Multitenant architecture design |
| [`POCKETBASE.md`](POCKETBASE.md) | Backend notes (PocketBase) |
| [`Schema_Gestionale_Concorso_Musicale.docx`](Schema_Gestionale_Concorso_Musicale.docx) | Original data schema (Word) |

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
