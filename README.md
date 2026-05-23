<div align="center">

# Gestimus

**Gestionale Concorso Musicale** — piattaforma multitenant per organizzare e valutare concorsi musicali a fasi multiple.

🇮🇹 Italiano · [🇬🇧 English](README.en.md)

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-22%20LTS-339933)
![Fastify](https://img.shields.io/badge/Fastify-5-202020)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
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
- **Sezioni e categorie** del concorso (es. Archi → Senior/Junior) + **copia categorie tra sezioni** (un click per replicare la struttura)
- **Candidati** individuali o gruppi (con membri multipli), modello N:1 candidato → sezione + categoria; **auto-derive sezione** dalla categoria scelta
- **Import CSV** candidati con template che include `tipo` (individuale/gruppo), `gruppo_nome`, `sezione`, `categoria`
- **Commissari** con designazione presidente
- **Commissioni** che raggruppano commissari + sezioni + categorie; toggle "Includi tutte le categorie" auto-espande al salvataggio
- **Presidente per-commissione**: ogni commissione ha il proprio presidente; non esiste più "il presidente del concorso" come ruolo unitario
- **Permessi fase granulari**: avvio/conclusione/sorteggio/timer di una fase eseguibili sia da admin sia dal presidente della commissione assegnata (`assertCanManageFase` server-side)
- **Restrizione fasi**: una fase può essere limitata a una o più sezioni specifiche (tracce parallele) o aperta a tutte; al `start` il backend pre-popola `candidati_fase` filtrati per quelle sezioni (idempotente)
- **Sorteggio ordine** candidati con seed riproducibile (mulberry32)
- **Risultati**: classifica live, podio, export CSV (RFC 4180 + BOM UTF-8, anti-formula-injection) e PDF protocollo. Firma del presidente della **fase finale** (non del concorso).
- **Verbale** con template + tag dinamici (`<concorso>`, `<presidente>`, `<fase_presidente>`, `<fase_classifica>`, ecc.) — le firme nel PDF si stampano solo se il template referenzia esplicitamente tag commissione/commissari E la fase ha commissione assegnata
- **Tab Impostazioni concorso** inline (niente più modale "Modifica"): anagrafica, logo, iscrizioni pubbliche, tiebreak default + zona pericolosa con **conferma "type-to-delete"** GitHub-style
- **Branding ente**: logo + colori + dati di contatto memorizzati in `brandingPublic`/`enteSettings` JSONB; PATCH server merge-style (non overwrite)
- **Audit log** append-only di tutte le operazioni

### 🎼 Commissario
- Valutazione **autonoma** (ogni commissario al proprio ritmo) o **sincrona** (tutti sullo stesso candidato, pilotata dal presidente)
- **Timer fase** condiviso in realtime via Postgres `LISTEN/NOTIFY` + SSE
- Voto per criterio con peso configurabile (somma = 100%) — supporta voti decimali con `numeric(5,2)` (mezzi punti su scale ≤ 10)
- Pittogrammi e slider per voti rapidi
- Storico ultime valutazioni in vista
- **Controllo sessione** presidente: KPI strip a gradient (fasi presiedute / candidati / valutati / % completamento), preflight check per avvio fase (commissione, criteri, candidati eleggibili), progress bar separate per "candidati con voto completo" e "commissari che hanno finito"

### 📝 Iscrizione pubblica
- Form auto-service **mono-pagina** accessibile senza login
- Sottodominio dedicato per ogni ente
- Anagrafica estesa (nome, cognome, sesso, codice fiscale, luogo nascita, nazionalità), residenza (indirizzo, città, CAP, provincia, paese), dati artistici (strumento, anni di studio, scuola di provenienza, docenti, programma)
- Selezione **sezione + categoria** con cascata: categorie filtrate per sezione, validazione cross-concorso lato server, auto-derive della sezione se l'utente sceglie solo la categoria
- Modalità **gruppo** con composizione membri dinamica + `gruppo_nome`
- Sezione tutore obbligatoria se candidato minorenne (validato server-side, soglia GDPR Art. 8: 16 anni)
- **Save & resume** automatico via localStorage
- Verifica email tramite link (token rigenerato server-side)
- Workflow di approvazione dall'admin → genera record candidato attivo (no più stato pending)
- Anti-spam server-side: honeypot, min-time-on-page, rate-limit per IP (3/h, 10/giorno)

### 🔒 Hardening
- **Isolamento tenant via Row-Level Security**: ogni query gira con `app.tenant_id` settato dal middleware, policy RLS rifiuta cross-tenant reads/writes lato database
- **SMTP password** cifrate at-rest (AES-GCM, chiave da env `GESTIMUS_SECRET_KEY`)
- **`audit_log`** append-only (no delete, neppure da admin del tenant) + **`platform_audit_log`** separato per le azioni super-admin
- **`valutazioni`** con unique index `(candidato_fase, commissario, criterio)` + clamp voto + freeze su fase CONCLUSA, garantito da trigger DB
- **`iscrizioni`** con validazione server-side dei consensi GDPR + stato concorso + scadenza
- **Auth**: session cookie `HttpOnly` `SameSite=Strict`, password Argon2id, no JWT in localStorage
- **`accounts`** con regola di creazione chiusa (no privilege escalation pubblica) + check anti self-promote del campo `role`
- **Form pubblico** con honeypot + rate-limit applicativo (oltre al rate-limit nginx in `deploy/nginx-snippet-rl.conf`)
- **GDPR export/erase** endpoint per-tenant con audit trail

### 🌐 Internazionalizzazione
Italiano (master), Inglese, Francese, Spagnolo. Le chiavi non tradotte ricadono automaticamente sull'italiano. Il nome **Gestimus** resta uguale in tutte le lingue, il sottotitolo è localizzato.

## Architettura

```
                       ┌─────────────────────────┐
                       │   nginx (porta 443/80)  │  ← Let's Encrypt wildcard
                       │   *.gestimus.it          │     (DNS-01 IONOS)
                       └──┬──────────────────────┘
                          │
                          ▼
                ┌────────────────────────┐
                │  Gestimus server       │  Node 22 + Fastify 5
                │  (singolo processo)    │  TypeScript strict
                │   :4000                │  Drizzle ORM
                └─────┬──────────────────┘
                      │   resolve subdomain → tenant_id
                      │   set app.tenant_id (per session)
                      ▼
                ┌────────────────────────┐
                │  PostgreSQL 16         │  RLS policy per tabella
                │  database "gestimus"   │  isolamento per tenant_id
                │   :5432                │  LISTEN/NOTIFY → SSE
                └────────────────────────┘
```

Un **singolo processo Node/Fastify** + un **singolo database Postgres**. La separazione tra enti è garantita da **Row-Level Security**: ogni connessione setta `app.tenant_id` in base al sottodominio risolto dal middleware e le policy RLS filtrano automaticamente ogni `SELECT/INSERT/UPDATE/DELETE`. Le operazioni amministrative (crea ente, sospendi, archivia, configura SMTP) sono azioni di UI super-admin, non script shell.

## Stack

- **Frontend**: HTML + JavaScript vanilla (no framework), Tailwind CSS, service worker per PWA
- **Backend**: Node.js 22 LTS + Fastify 5 + TypeScript strict
- **ORM**: Drizzle + drizzle-kit migrations
- **Database**: PostgreSQL 16 con multitenancy logica via Row-Level Security
- **Auth**: session cookie HttpOnly + Argon2id (`@node-rs/argon2`)
- **Realtime**: Postgres `LISTEN/NOTIFY` + SSE plugin Fastify
- **Storage**: filesystem locale strutturato per tenant
- **Email**: Nodemailer + cifratura credenziali AES-GCM
- **Reverse proxy**: nginx (preferito) o Caddy (fallback)
- **TLS**: Let's Encrypt wildcard via certbot DNS-01
- **DNS**: IONOS (plugin certbot dedicato)
- **CI**: GitHub Actions (lint TS + bash + i18n coverage)
- **Dipendenze aggiornate**: Dependabot settimanale

## Quick start in locale

Richiede macOS o Linux, **Node 22 LTS**, **PostgreSQL 16**.

```bash
git clone https://github.com/danilorussosax/gestimus.git
cd gestimus

# 1. Postgres locale (macOS via Homebrew, o usa Docker)
brew install postgresql@16
brew services start postgresql@16
createdb gestimus

# 2. Backend
cd server
npm install
cp .env.example .env
# → modifica DATABASE_URL_*, SESSION_COOKIE_SECRET, GESTIMUS_SECRET_KEY (32 byte hex)

npm run db:bootstrap        # crea ruoli gestimus_app / gestimus_super
npm run db:setup            # push schema Drizzle + applica policy RLS
npm run db:seed             # dati demo (1 super-admin + 2 enti + concorso campione)

npm run dev                 # backend + frontend statici su :4000
```

Aggiungi i sottodomini a `/etc/hosts` (solo dev):

```
127.0.0.1  platform.gestimus.local
127.0.0.1  ente1.gestimus.local
127.0.0.1  ente2.gestimus.local
```

Dopo l'avvio:
- `http://ente1.gestimus.local:4000/` → app cliente
- `http://platform.gestimus.local:4000/` → super-admin
- Credenziali demo seedate da `npm run db:seed` (vedi log di output)

Per resettare il DB di sviluppo: `npm run db:reset`.

## Deploy in produzione

Schema, ruoli DB, RLS, soft-delete tenant, backup pre-archiviazione e flusso super-admin sono descritti in [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) (sez. 4-5, 15, 17).

La piattaforma è progettata per girare su una **VPS Linux** dietro nginx + Let's Encrypt wildcard. I componenti minimi:

1. **VPS Ubuntu 24.04** con PostgreSQL 16 + Node 22 LTS
2. **DNS wildcard** per il dominio (`*.gestimus.it` + root)
3. **nginx** reverse-proxy `*.gestimus.it → 127.0.0.1:4000` (un solo upstream, non più un processo per ente)
4. **systemd unit** per il processo Gestimus + variabili `DATABASE_URL_*`, `SESSION_COOKIE_SECRET`, `GESTIMUS_SECRET_KEY`
5. **Certificato wildcard** Let's Encrypt via certbot DNS-01 (plugin IONOS o equivalente)
6. **Backup automatico** del database + retention archivi pre-hard-delete (sez. 17 del piano)

I template nginx/systemd e gli script di provisioning per il nuovo stack sono in fase di stesura.

## Struttura del progetto

```
gestimus/
├── js/                          # frontend vanilla
│   ├── app.js                   # router + bootstrap
│   ├── db.js                    # data layer (client REST verso il backend)
│   ├── api.js                   # client HTTP tipizzato
│   ├── i18n.js                  # traduzioni IT/EN/FR/ES
│   ├── scoring.js               # algoritmi calcolo media + suggerimenti
│   ├── tiebreak.js              # logiche spareggio
│   ├── icons.js                 # set icone Carbon SVG
│   └── views/                   # view per ruolo
│       └── home.js · login.js · iscrizione.js · admin*.js · commissario.js · superadmin.js
├── server/                      # backend Fastify + Drizzle
│   ├── src/
│   │   ├── db/                  # schema Drizzle + policy RLS (policies.sql)
│   │   ├── routes/              # endpoint REST per entità di dominio
│   │   ├── services/            # auth (Argon2id) · session · storage · email · crypto SMTP
│   │   ├── middleware/          # tenant resolver (subdomain → tenant_id) + auth guard
│   │   └── realtime/            # hub SSE + bridge LISTEN/NOTIFY
│   ├── scripts/                 # bootstrap-db · apply-policies · seed-dev · reset-dev
│   ├── tests/                   # rls/ · auth/ · crud/ · realtime/ (48 test)
│   ├── drizzle.config.ts
│   └── package.json
├── tests/
│   ├── unit/                    # node --test (scoring.js, rng.js)
│   └── e2e/                     # playwright (smoke client + super-admin)
├── deploy/                      # template config nginx/systemd
├── docs/                        # documentazione (architettura, deploy, manuali, screenshot)
└── .github/                     # CI + Dependabot + issue/PR templates
```

## Script npm

Backend (in `server/`):

```bash
npm run dev              # tsx watch + serve frontend statici
npm run build            # compila TypeScript
npm run start            # esegui build di produzione
npm run db:bootstrap     # crea ruoli gestimus_app / gestimus_super
npm run db:setup         # db:push + apply policies RLS
npm run db:seed          # dati demo
npm run db:reset         # drop + rebuild + seed (solo dev)
npm run db:studio        # Drizzle Studio (UI ispezione tabelle)
npm run test             # tutti i suite (rls + auth + crud + realtime)
npm run test:rls         # solo isolation cross-tenant
npm run lint             # tsc --noEmit
```

Root:

```bash
npm run test:unit        # tests/unit (scoring + rng) — no DB
npm run test:e2e         # playwright (richiede server in esecuzione)
```

## Documentazione

| File | Contenuto |
|------|-----------|
| [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md) | **Architettura tecnica completa** — schema DB, policy RLS, struttura moduli backend, soft-delete tenant con cleanup configurabile, 2FA TOTP, milestone roadmap |
| [`docs/LISTINO.md`](docs/LISTINO.md) | **Listino piani commerciali** — documento per i clienti finali |
| [`docs/DEPLOY-IONOS.md`](docs/DEPLOY-IONOS.md) | **Guida deploy IONOS** per il nuovo stack Fastify + Postgres (systemd single unit, certbot DNS-01, backup PG) |
| [`docs/manuale-admin.md`](docs/manuale-admin.md) | **Manuale operativo per l'admin di ente** — consultabile in-app da *Admin → Manuale* (TOC sticky, stampa A4 / esportazione PDF). Le immagini referenziate vivono in `docs/screenshots/`. |
| [`server/README.md`](server/README.md) | **Backend reference** — schema Drizzle, endpoint REST, middleware, migrations, runtime metrics |
| [`server/scripts/migrations/`](server/scripts/migrations/) | Migrazioni SQL incrementali applicabili con `psql -f` o tramite `db:push` di drizzle-kit |

## Contributi

Vedi [.github/pull_request_template.md](.github/pull_request_template.md) per il flusso PR e [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE) per i template di issue.

I commit seguono una convention minima:
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
