<div align="center">

# Gestimus

**Gestionale Concorso Musicale** — piattaforma multitenant per organizzare e valutare concorsi musicali a fasi multiple.

🇮🇹 Italiano · [🇬🇧 English](README.en.md)

[![CI](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml/badge.svg)](https://github.com/danilorussosax/gestimus/actions/workflows/ci.yml)
![PocketBase](https://img.shields.io/badge/PocketBase-0.22-4169E1)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS-yellow)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

---

## Cos'è Gestimus

Gestimus è un'applicazione web per **enti che organizzano concorsi musicali** (conservatori, associazioni, scuole). Gestisce l'intero ciclo di vita di un concorso: iscrizione pubblica dei candidati, configurazione delle fasi e dei criteri di valutazione, sessioni live di commissione, calcolo delle medie con metodi statistici diversi, esportazione protocolli e verbali.

L'architettura è **multitenant nativa**: un solo server ospita N enti indipendenti, ciascuno con il proprio sottodominio, database isolato e amministratore separato. Un pannello super admin centrale gestisce tutti gli enti.

## Funzionalità principali

### 👑 Super admin
- Gestione enti (creazione/modifica/rimozione)
- Configurazione SMTP **per ogni singolo ente** (provider diversi per enti diversi)
- Creazione admin via UI senza accesso SSH al server
- Statistiche aggregate (concorsi, commissari, candidati per ente)

### 🛠 Admin ente
- **Fasi** con 5 metodi di calcolo media (aritmetica, olimpica, winsorizzata, mediana, deviazione standard) + suggerimento automatico in base al numero di commissari
- **Sezioni e categorie** del concorso (es. Archi → Senior/Junior)
- **Candidati** individuali o gruppi (con membri multipli)
- **Commissari** con designazione presidente
- **Commissioni** che raggruppano commissari + sezioni + categorie
- **Restrizione fasi**: una fase può essere limitata a una sezione specifica (tracce parallele) o aperta a tutti
- **Sorteggio ordine** candidati con seed riproducibile
- **Risultati**: classifica live, podio, export CSV (RFC 4180 + BOM UTF-8) e PDF protocollo
- **Verbale** con template + tag dinamici (`{concorso}`, `{presidente}`, ecc.)
- **Audit log** completo di tutte le operazioni

### 🎼 Commissario
- Valutazione **autonoma** (ogni commissario al proprio ritmo) o **sincrona** (tutti sullo stesso candidato, pilotata dal presidente)
- **Timer fase** condiviso in realtime via SSE PocketBase
- Voto per criterio con peso configurabile (somma = 100%)
- Pittogrammi e slider per voti rapidi
- Storico ultime valutazioni in vista

### 📝 Iscrizione pubblica
- Form auto-service **mono-pagina** accessibile senza login
- Sottodominio dedicato per ogni concorso
- Anagrafica, contatti, dati artistici, programma, allegati (foto/documento/ricevuta)
- Modalità **gruppo** con composizione membri dinamica
- Sezione tutore obbligatoria se candidato minorenne
- **Save & resume** automatico via localStorage
- Verifica email tramite link
- Workflow di approvazione dall'admin → genera record candidato

### 🌐 Internazionalizzazione
Italiano (master), Inglese, Francese, Spagnolo. Le chiavi non tradotte ricadono automaticamente sull'italiano. Il nome **Gestimus** resta uguale in tutte le lingue, il sottotitolo è localizzato.

## Architettura

```
                       ┌─────────────────────────┐
                       │   nginx (porta 443/80)  │  ← Let's Encrypt wildcard
                       │   *.gestimus.it          │     (DNS-01 IONOS)
                       └──┬──────────────────────┘
            ┌─────────────┼─────────────────────┬────────────┐
            ▼             ▼                     ▼            ▼
   platform.gestimus.it  ente1.gestimus.it   ente2.gestimus.it  ente3.…
       :8093                :8091                :8092            :809…
   pb@platform          pb@ente1              pb@ente2          pb@ente3
   (super admin)        (Conservatorio MI)    (Scuola RM)       …
```

Ogni tenant è un **processo PocketBase isolato** con il proprio SQLite. nginx fa reverse-proxy via sottodominio. Un certificato wildcard copre tutti gli enti presenti e futuri.

## Stack

- **Frontend**: HTML + JavaScript vanilla (no framework), Tailwind CSS (CDN), service worker per PWA
- **Backend**: [PocketBase](https://pocketbase.io) 0.22 (binario Go, SQLite embedded, JS hooks via Goja)
- **Reverse proxy**: nginx (preferito) o Caddy (fallback)
- **TLS**: Let's Encrypt wildcard via certbot DNS-01
- **DNS**: IONOS (plugin certbot dedicato)
- **CI**: GitHub Actions (lint JS + bash + migration check + i18n coverage)
- **Dipendenze aggiornate**: Dependabot settimanale

## Quick start in locale

Richiede macOS o Linux, Node 18+, `caddy` per lo sviluppo multitenant.

```bash
git clone https://github.com/danilorussosax/gestimus.git
cd gestimus

# Scarica il binario PocketBase (~40 MB)
mkdir -p pocketbase
wget -O /tmp/pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.22.27/pocketbase_0.22.27_darwin_arm64.zip
unzip -o /tmp/pb.zip -d pocketbase

# Avvia 2 tenant + 1 platform + Caddy reverse-proxy
./scripts/start-local-multitenant.sh
```

Dopo l'avvio:
- `http://ente1.test:8000/` → app cliente
- `http://platform.test:8000/` → super admin
- Credenziali default: `admin@ente1.test` / `admin123` (cambiale subito in produzione)

Per fermare tutto: `./scripts/start-local-multitenant.sh stop`.

## Deploy in produzione

Guida completa: [**DEPLOY-IONOS.md**](DEPLOY-IONOS.md).

In sintesi (~30 minuti dalla VPS vuota):

1. **VPS Ubuntu 24.04** (consigliato IONOS **VPS L+**: 6 vCPU, 8 GB RAM, 240 GB NVMe — **€5/mese in promo · €8 a rinnovo**, IVA escl.)
2. **DNS wildcard** per il dominio (`*.gestimus.it` + root)
3. **API key IONOS** per certbot DNS-01
4. `sudo bash scripts/setup-server.sh` → installa tutto
5. `sudo certbot certonly ... -d gestimus.it -d "*.gestimus.it"` → cert wildcard
6. `sudo ./scripts/provision-tenant.sh platform` → super admin live
7. `sudo ./scripts/provision-tenant.sh nome-ente` → primo cliente

**Costo annuo (anno 1 promo, IVA escl.)**: ~€80 (VPS €60 + attivazione €10 + dominio €10). Dal 3° anno: ~€108 al netto IVA. Supporta **20-50 enti** sullo stesso server.

## Struttura del progetto

```
gestimus/
├── js/                          # frontend
│   ├── app.js                   # router + bootstrap
│   ├── db.js                    # data layer PocketBase
│   ├── pb.js                    # client PB
│   ├── i18n.js                  # traduzioni IT/EN/FR/ES
│   ├── scoring.js               # algoritmi calcolo media + suggerimenti
│   ├── icons.js                 # set icone Carbon SVG
│   └── views/                   # view per ruolo
│       ├── home.js              # landing
│       ├── login.js             # auth
│       ├── iscrizione.js        # form pubblico (mono-pagina)
│       ├── admin.js             # tab admin
│       ├── admin-*.js           # sezioni admin (dashboard, stats, ecc.)
│       ├── commissario.js       # valutazione
│       └── superadmin.js        # gestione enti
├── pb_migrations/               # schema versionato (32 migration)
├── pb_hooks/                    # endpoint custom server-side
│   ├── iscrizioni.pb.js         # workflow approvazione + email
│   └── setup.pb.js              # has-admin probe + create-admin
├── scripts/                     # automazione deploy/ops
│   ├── setup-server.sh          # provisioning VPS
│   ├── provision-tenant.sh      # nuovo ente
│   ├── remove-tenant.sh         # rimuovi ente
│   ├── apply-ente-smtp.sh       # propaga SMTP
│   └── start-local-multitenant.sh
├── deploy/                      # template config
│   ├── gestimus.env             # dominio + path
│   ├── pb@.service              # systemd template
│   └── nginx-tenant.conf.template
├── DEPLOY-IONOS.md              # guida deploy
└── .github/                     # CI + Dependabot + templates
```

## Documentazione

| File | Contenuto |
|------|-----------|
| [`DEPLOY-IONOS.md`](DEPLOY-IONOS.md) | Guida completa per il deploy su VPS IONOS |
| [`MULTITENANT_PLAN.md`](MULTITENANT_PLAN.md) | Design dell'architettura multitenant |
| [`POCKETBASE.md`](POCKETBASE.md) | Note sul backend PocketBase |
| [`Schema_Gestionale_Concorso_Musicale.docx`](Schema_Gestionale_Concorso_Musicale.docx) | Schema dati originale (Word) |

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
