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

### 🔒 Bundled hardening (see `MULTITENANT_PLAN.md` § Security)
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
├── pb_migrations/               # versioned schema (38 migrations)
├── pb_hooks/                    # server-side custom endpoints
│   ├── iscrizioni.pb.js         # approval workflow + email + anti-bot + rate-limit
│   ├── accounts.pb.js           # blocks self-promote role/attivo/email
│   ├── valutazioni.pb.js        # vote clamp + freeze on CONCLUSA phase
│   ├── tenants.pb.js            # SMTP password encryption + decrypt endpoint
│   ├── privacy.pb.js            # GDPR export/erase
│   └── setup.pb.js              # has-admin probe + create-admin
├── tests/
│   ├── unit/                    # node --test (scoring.js, rng.js)
│   └── e2e/                     # playwright
├── scripts/                     # deploy/ops automation
│   ├── setup-server.sh          # VPS provisioning (generates GESTIMUS_SECRET_KEY)
│   ├── provision-tenant.sh      # new tenant (opt ADMIN_ALLOW_IPS)
│   ├── remove-tenant.sh         # remove tenant
│   ├── apply-ente-smtp.sh       # SMTP propagation (decrypts via admin endpoint)
│   ├── encrypt-existing-smtp.mjs # migrate plaintext SMTP passwords → encrypted
│   └── start-local-multitenant.sh
├── deploy/                      # config templates
│   ├── gestimus.env             # domain + paths + GESTIMUS_SECRET_KEY hint
│   ├── pb@.service              # systemd template
│   ├── Caddyfile                # pb_routes snippet with IP-restricted /_/
│   ├── nginx-tenant.conf.template # split /api/ vs /_/, allow placeholder
│   └── nginx-snippet-rl.conf    # rate-limit zones (iscrizioni_rl, auth_rl)
├── DEPLOY-IONOS.md              # deploy guide
└── .github/                     # CI + Dependabot + templates
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
