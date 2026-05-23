# Piano di migrazione multitenant *(ARCHIVED — strategia fisica abbandonata)*

> ⚠️ **Questo documento descrive una strategia ABBANDONATA**: una istanza PocketBase per ente con multitenancy "fisica" (N processi, N porte, systemd template `pb@.service`).
>
> La piattaforma è stata migrata a **multitenancy logica con PostgreSQL RLS**: un singolo processo Node/Fastify + un singolo DB Postgres con `app.tenant_id` per sessione. La documentazione attuale è in [`MIGRATION_POSTGRES.md`](MIGRATION_POSTGRES.md).
>
> Tenuto in repo solo per riferimento storico delle decisioni di architettura.

---

## Strategia originale (legacy)

## Strategia: una istanza PocketBase per ente

Ogni ente (scuola, conservatorio, associazione) ottiene:
- Un sottodominio (`ente1.concorso.app`)
- Una istanza PocketBase dedicata su porta dedicata (`pb_data_ente1/`)
- Lo stesso frontend statico servito da Caddy per tutti i sottodomini

Nessun `tenant_id` nel database. Isolamento totale dei dati.

---

## FASE 0 — Fondamenta multitenant (2-3 giorni)

Obiettivo: rendere il deploy multitenant possibile con il minimo cambiamento al codice esistente.

### 0.1 Frontend: PB_URL dinamico

**File**: `js/pb.js`

Modifica la singola riga che impedisce il multitenant:

```js
// Prima:
return 'http://127.0.0.1:8090';

// Dopo:
return `${location.protocol}//${location.host}`;
```

In sviluppo locale, continuare a supportare l'override via query param o variabile globale (già presente alle righe 6-9). In produzione, Caddy farà da reverse proxy e il frontend si auto-configurerà.

### 0.2 Reverse proxy: Caddyfile

Creare `deploy/Caddyfile`:

```caddy
{
    on_demand_tls {
        ask https://admin.concorso.app/api/tenants/check-domain
    }
    servers :80 :443 {
        protocols h1 h2
    }
}

*.concorso.app, :80, :443 {
    tls {
        on_demand
    }

    # Static frontend (comune a tutti i tenant)
    @static not path /api/* /_/*
    root * /var/www/gestionale
    file_server @static

    # Proxy API + admin UI + realtime SSE al PB del tenant
    @api path /api/* /_/*
    handle @api {
        reverse_proxy {handler}  # risolto dal Caddy tenant module o script
    }
}
```

Per MVP, usare un Caddyfile esplicito per tenant:

```caddy
ente1.concorso.app {
    tls { on_demand }
    root * /var/www/gestionale
    @api path /api/* /_/*
    reverse_proxy @api localhost:8091
    file_server
}
```

### 0.3 Systemd: templated unit per PB

Creare `deploy/pb@.service`:

```ini
[Unit]
Description=PocketBase tenant %i
After=network.target

[Service]
Type=simple
User=pb
WorkingDirectory=/srv/pb
EnvironmentFile=/etc/pb/%i.env
ExecStart=/srv/pb/pocketbase serve \
    --http=127.0.0.1:${PORT} \
    --dir=/srv/pb/data/%i \
    --migrationsDir=/srv/pb/pb_migrations
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Esempio `/etc/pb/ente1.env`:
```
PORT=8091
```

### 0.4 Script di provisioning tenant

Creare `scripts/provision-tenant.sh`:

```bash
#!/usr/bin/env bash
# Usage: ./scripts/provision-tenant.sh <tenant-slug> <port>
# Es:   ./scripts/provision-tenant.sh conservatorio-milano 8091

set -euo pipefail
SLUG="${1:?Usage: $0 <tenant-slug> <port>}"
PORT="${2:?}"
PB_BIN="/srv/pb/pocketbase"
DATA_DIR="/srv/pb/data/${SLUG}"
MIGRATIONS="/srv/pb/pb_migrations"
ENV_FILE="/etc/pb/${SLUG}.env"
CADDY_FILE="/etc/caddy/tenants/${SLUG}.conf"
WWW_DIR="/var/www/gestionale"

# 1. Crea directory dati
mkdir -p "${DATA_DIR}"

# 2. Scrivi env file
echo "PORT=${PORT}" > "${ENV_FILE}"

# 3. Avvia PB (le migrations creano le collection)
systemctl enable --now "pb@${SLUG}"

# 4. Attendi che PB sia healthly
for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
        echo "✓ PocketBase tenant ${SLUG} healthy su porta ${PORT}"
        break
    fi
    sleep 1
done

# 5. Crea il primo admin
read -rp "Email admin per ${SLUG}: " ADMIN_EMAIL
read -rsp "Password: " ADMIN_PASSWORD; echo
node "${WWW_DIR}/scripts/create-admin.js" "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" \
    "PB_URL=http://127.0.0.1:${PORT}" 2>/dev/null || \
    "${PB_BIN}" --dir="${DATA_DIR}" admin create "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" 2>/dev/null || true

# 6. Aggiungi blocco Caddy
cat > "${CADDY_FILE}" <<EOF
${SLUG}.concorso.app {
    tls { on_demand }
    root * ${WWW_DIR}
    @api path /api/* /_/*
    reverse_proxy @api localhost:${PORT}
    file_server
}
EOF
systemctl reload caddy

echo "✓ Tenant ${SLUG} provisionato: https://${SLUG}.concorso.app"
```

### 0.5 Script di deploy frontend

Creare `scripts/deploy-frontend.sh`:

```bash
#!/usr/bin/env bash
# Copia il frontend statico su /var/www/gestionale sul server di produzione.
# Uso locale: rsync verso il VPS.

set -euo pipefail
TARGET="${1:?Usage: $0 <user@host>}"

rsync -avz --delete \
    --exclude='node_modules' \
    --exclude='.DS_Store' \
    --exclude='pb_data' \
    --exclude='pocketbase' \
    --exclude='backups' \
    --exclude='test-results' \
    --exclude='.claude' \
    --exclude='*.md' \
    ./ "${TARGET}:/var/www/gestionale/"
```

### 0.6 Script di backup per-tenant

Estendere `scripts/backup-pb.mjs` per supportare il backup di tutti i tenant:

```bash
#!/usr/bin/env bash
# backup-all-tenants.sh — backup di ogni pb_data_*/ usando restic
for ENV in /etc/pb/*.env; do
    SLUG=$(basename "${ENV}" .env)
    echo "→ Backup tenant ${SLUG}..."
    restic backup "/srv/pb/data/${SLUG}" --tag "${SLUG}"
done
```

**Deliverable Fase 0**:
- [x] `js/pb.js` con PB_URL dinamico
- [x] `deploy/Caddyfile` di esempio
- [x] `deploy/pb@.service`
- [x] `scripts/provision-tenant.sh`
- [x] `scripts/deploy-frontend.sh`
- [x] `scripts/backup-all-tenants.sh`

---

## FASE 1 — Nuova collection `enti` + Impostazioni tenant (2-3 giorni)

Ogni istanza PB ha un proprio set di concorsi, ma manca il concetto di "ente organizzatore" a livello di branding, contatti, impostazioni. Aggiungiamo una collection singleton `enti` per memorizzare i metadati del tenant.

### 1.1 Migration: collection `enti`

Creare `pb_migrations/1700000018_enti.js`:

```js
// Collection singleton: un solo record per istanza PB.
// L'admin dell'ente crea il record al primo accesso.
// Contiene branding, impostazioni, contatti.
migrate((db) => {
  const dao = new Dao(db);
  const enti = new Collection({
    name: 'enti',
    type: 'base',
    listRule:   '',  // chiunque può leggere (serve per branding pubblico)
    viewRule:   '',
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: null, // non cancellabile
    schema: [
      new SchemaField({ name: 'nome',          type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'descrizione',   type: 'text', options: {} }),
      new SchemaField({ name: 'logo',          type: 'file', options: { maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/png','image/jpeg','image/webp','image/svg+xml'] } }),
      new SchemaField({ name: 'sito_web',       type: 'url', options: { max: 500 } }),
      new SchemaField({ name: 'email_contatto', type: 'email', options: {} }),
      new SchemaField({ name: 'telefono',       type: 'text', options: { max: 50 } }),
      new SchemaField({ name: 'indirizzo',      type: 'text', options: { max: 500 } }),
      new SchemaField({ name: 'colore_primario', type: 'text', options: { max: 7 } }), // hex, es #4169E1
      new SchemaField({ name: 'colore_secondario', type: 'text', options: { max: 7 } }),
      new SchemaField({ name: 'impostazioni',   type: 'json', options: { maxSize: 65536 } }), // config libbre
    ],
  });
  dao.saveCollection(enti);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('enti')); } catch {}
});
```

### 1.2 Frontend: data layer per `enti`

Aggiungere a `js/db.js`:

```js
// ---------- Ente ----------
function mapEnte(r) {
  return {
    id: r.id,
    nome: r.nome || '',
    descrizione: r.descrizione || '',
    logo_url: r.logo ? fileURL(r, r.logo) : null,
    sito_web: r.sito_web || '',
    email_contatto: r.email_contatto || '',
    telefono: r.telefono || '',
    indirizzo: r.indirizzo || '',
    colore_primario: r.colore_primario || '#4169E1',
    colore_secondario: r.colore_secondario || '#F5A623',
    impostazioni: r.impostazioni || {},
  };
}

// In state:
//   ente: null,

// In empty():
//   ente: null,

// In loadAll():
//   const enti = await pb.collection('enti').getFullList().catch(() => []);
//   state.ente = enti.length > 0 ? mapEnte(enti[0]) : null;

// Metodi:
async getEnte() {
  if (state.ente) return state.ente;
  const list = await pb.collection('enti').getFullList();
  state.ente = list.length > 0 ? mapEnte(list[0]) : null;
  return state.ente;
},

async saveEnte(patch) {
  if (state.ente) {
    let rec;
    if ('logo' in patch) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'logo') continue;
        fd.append(k, v == null ? '' : String(v));
      }
      appendFileField(fd, 'logo', patch.logo, 'logo.png');
      rec = await pb.collection('enti').update(state.ente.id, fd);
    } else {
      rec = await pb.collection('enti').update(state.ente.id, patch);
    }
    state.ente = mapEnte(rec);
  } else {
    const fd = new FormData();
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'logo') { appendFileField(fd, 'logo', v, 'logo.png'); continue; }
      if (v != null) fd.append(k, String(v));
    }
    const rec = await pb.collection('enti').create(fd);
    state.ente = mapEnte(rec);
  }
  notify();
  return state.ente;
},
```

### 1.3 Frontend: branding dinamico

Modificare `js/app.js` — `updateHeader()` per usare `state.ente` per il logo e il nome:

```js
// header-logo: se ente ha logo → ente.logo_url, altrimenti ./logo.png
// header-title: se ente ha nome → ente.nome, altrimenti fallback i18n
// header-subtitle: ente.descrizione se presente
```

Modificare `index.html` — `<title>` dinamico basato su `state.ente.nome`.

**Deliverable Fase 1**:
- [ ] Migration `enti`
- [ ] `db.js` con metodi `getEnte()` / `saveEnte()`
- [ ] Header dinamico con branding ente
- [ ] `<title>` dinamico

---

## FASE 2 — Sezione Amministrazione (5-7 giorni)

La navbar admin attuale ha solo sezioni per-concorso (fasi, candidati, ecc.). Aggiungiamo una sezione "Amministrazione" a livello tenant con le sottopagine richieste.

### 2.1 Routing aggiuntivo

Aggiungere a `js/app.js` il route `#/admin/impostazioni` e tabs aggiuntivi.

La sidebar admin esistente guadagna un gruppo in fondo:

```
── Concorso ──
  Fasi
  Sezioni
  Candidati
  Commissari
  Commissioni
  Risultati
  Audit
── Amministrazione ──
  Panoramica
  Statistiche
  Utenti
  Aule
  Prenotazioni
  Impostazioni
```

### 2.2 Panoramica (Dashboard tenant)

KPI a livello istanza:
- Concorsi attivi / conclusi
- Candidati totali, candidati in corso
- Valutazioni registrate
- Commissari registrati
- Utilizzo storage (via `pb.collection('concorsi').getList()` + stima file)
- Stato fasi (quante PIANIFICATA / IN_CORSO / CONCLUSA)

File: `js/views/admin-dashboard.js` (~200 linee)

### 2.3 Statistiche

Grafici e tabelle:
- Distribuzione candidati per strumento (bar chart)
- Distribuzione per nazionalità
- Andamento valutazioni medie per fase
- Tempo medio di valutazione per commissario
- Percentuale ammessi vs eliminati per fase

Uso di `<canvas>` + semplice libreria chart (es. Chart.js via CDN, ~10 KB gzippato se si usa solo bar/line), oppure rendering SVG inline senza dipendenze.

File: `js/views/admin-stats.js` (~300 linee)

### 2.4 Utenti (miglioramento UI esistente)

La gestione account è già parzialmente in `admin.js` (righe垂直 `createAccount`, `updateAccount`, ecc.). Creare una view dedicata:

- Lista utenti con filtri (ruolo, attivo/disabilitato)
- Creazione utente con form
- Reset password
- Disabilitazione/abilitazione account
- Collegamento account → commissario
- Invito via email (link di setup password)

File: `js/views/admin-users.js` (~350 linee)

### 2.5 Aule

Nuova collection + CRUD UI.

**Migration** `pb_migrations/1700000019_aule.js`:

```js
// Aule/spazi fisici dove si svolgono le fasi del concorso.
// Per-ente (no relation a concorso: un'aula vale per tutti i concorsi dell'ente).
migrate((db) => {
  const dao = new Dao(db);
  const aule = new Collection({
    name: 'aule',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
    schema: [
      new SchemaField({ name: 'nome',         type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'capienza',      type: 'number', options: { min: 1, noDecimal: true } }),
      new SchemaField({ name: 'descrizione',    type: 'text', options: {} }),
      new SchemaField({ name: 'piano',          type: 'text', options: { max: 20 } }),
      new SchemaField({ name: 'note',           type: 'text', options: {} }),
      new SchemaField({ name: 'attrezzatura',   type: 'json', options: { maxSize: 65536 } }), // ["pianoforte", "leggio", ...]
    ],
  });
  dao.saveCollection(aule);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('aule')); } catch {}
});
```

**Frontend:** lista aule, form creazione/modifica, eliminazione. Tabella con nome, capienza, piano, attrezzatura.

File: `js/views/admin-aule.js` (~250 linee)
Aggiornare `db.js` con `auleByConcorso()`, `createAula()`, `updateAula()`, `deleteAula()`.

### 2.6 Prenotazioni

Collega un'aula a una fase con data/ora.

**Migration** `pb_migrations/1700000020_prenotazioni.js`:

```js
migrate((db) => {
  const dao = new Dao(db);
  const fasi = dao.findCollectionByNameOrId('fasi');
  const aule = dao.findCollectionByNameOrId('aule');

  const prenotazioni = new Collection({
    name: 'prenotazioni',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.role = "admin" || (@request.auth.role = "commissario" && @request.auth.commissario.is_presidente = true)',
    updateRule: '@request.auth.role = "admin" || (@request.auth.role = "commissario" && @request.auth.commissario.is_presidente = true)',
    deleteRule: '@request.auth.role = "admin"',
    schema: [
      new SchemaField({ name: 'fase',       type: 'relation', required: true, options: { collectionId: fasi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'aula',        type: 'relation', required: true, options: { collectionId: aule.id, cascadeDelete: false, maxSelect: 1 } }),
      new SchemaField({ name: 'data_ora_inizio', type: 'date', required: true, options: {} }),
      new SchemaField({ name: 'data_ora_fine',   type: 'date', required: true, options: {} }),
      new SchemaField({ name: 'note',        type: 'text', options: {} }),
    ],
  });
  dao.saveCollection(prenotazioni);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('prenotazioni')); } catch {}
});
```

**Frontend:** vista calendario settimanale (grid CSS, no dipendenza esterna) con prenotazioni per aula. Form di creazione rapida (drag-like). Vista lista alternativa.

File: `js/views/admin-prenotazioni.js` (~400 linee)
Aggiornare `db.js` con mapper, CRUD, e `prenotazioniByFase()`, `prenotazioniByAula()`.

### 2.7 Impostazioni

Form per l'ente singleton (`enti` collection della Fase 1):
- Nome, descrizione, logo, sito web
- Email contatto, telefono, indirizzo
- Colori primario/secondario (con preview live)
- Impostazioni avanzate (JSON editor semplice)

File: `js/views/admin-impostazioni.js` (~300 linee)

**Deliverable Fase 2**:
- [ ] 3 migration (`enti`, `aule`, `prenotazioni`)
- [ ] `db.js` esteso con mapper e CRUD per enti, aule, prenotazioni
- [ ] 6 nuove view: `admin-dashboard.js`, `admin-stats.js`, `admin-users.js`, `admin-aule.js`, `admin-prenotazioni.js`, `admin-impostazioni.js`
- [ ] Routing aggiornato in `app.js`
- [ ] Sidebar admin con gruppo "Amministrazione"
- [ ] i18n keys per tutte le nuove view (4 lingue)

---

## FASE 3 — Commissario: prenotazioni visibili (1-2 giorni)

La vista commissario deve mostrare le prenotazioni delle fasi a cui è assegnato.

### 3.1 Agenda commissario

Aggiungere alla vista commissario un pannello "Prossime sessioni" che mostra:
- Data/ora e aula di ogni fase assegnata
- Link alla mappa dell'edificio (se specificata nelle note dell'aula)

File: aggiornare `js/views/commissario.js`

**Deliverable Fase 3**:
- [ ] Pannello "Prossime sessioni" nella vista commissario
- [ ] Dati di prenotazione caricati in `loadAll()`

---

## FASE 4 — Hardening produzione (2-3 giorni)

> **Stato**: l'hardening descritto sotto è **già applicato** dalle migration `1700000022` (lockdown_v1), `1700000025` (security_lockdown_v2), `1700000036` (accounts createRule chiusa), `1700000037` (audit_log append-only) e `1700000038` (valutazioni unique + own-commissario rule). Hook server-side correlati: `pb_hooks/accounts.pb.js`, `pb_hooks/valutazioni.pb.js`, `pb_hooks/iscrizioni.pb.js`, `pb_hooks/tenants.pb.js`. Questo capitolo va letto come **mappa di cosa c'è**, non come TODO.

### 4.1 Restringere le regole di accesso PB

Le collection attuali hanno regole aperte (`""`). Per produzione multitenant, servono regole più strette:

| Collection | listRule | viewRule | createRule | updateRule | deleteRule |
|---|---|---|---|---|---|
| `concorsi` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `commissari` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `candidati` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `fasi` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `candidati_fase` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `valutazioni` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` |
| `fase_runtime` | `@request.auth.id != ""` | `@request.auth.id != ""` | *(come ora)* | *(come ora)* | *(come ora)* |
| `sezioni` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `categorie` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `commissioni` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` |
| `accounts` | *(come ora)* | *(come ora)* | `""` | `""` | `@request.auth.role = "admin"` |
| `audit_log` | *(come ora)* | *(come ora)* | `""` | `null` | `@request.auth.role = "admin"` |
| `enti` | `""` | `""` | `@request.auth.role = "admin"` | `@request.auth.role = "admin"` | `null` |
| `aule` | *(vedi migration)* | | | | |
| `prenotazioni` | *(vedi migration)* | | | | |

**Attenzione**: le regole più strette richiedono che il client sia sempre autenticato per leggere i dati. Questo è un breaking change rispetto al comportamento attuale ( oggi un utente non autenticato può leggere tutto via API). Serve una migration dedicata.

### 4.2 Login obbligatorio

Modificare `js/app.js` per forzare il login se l'utente non è autenticato (già parzialmente fatto: la `render()` controlla `pb.authStore.isValid`). Assicurarsi che la sidebar admin e i dati sensibili non siano mai visibili senza auth.

### 4.3 Rate limiting PB

PocketBase (v0.22+) ha rate limiting built-in per auth endpoints. Per le API regolari, configurare i limiti via Caddy:

```caddy
# Nel blocco globale
rate_limit {
    zone api_zone 10r/s
}
```

Oppure aggiungere middleware custom se si usa un reverse proxy diverso.

### 4.4 CORS e sicurezza

In produzione, PB non deve accettare richieste cross-origin. Caddy serve sia frontend che API sullo stesso dominio, quindi CORS non è necessario. Rimuovere eventuale config CORS lato PB.

### 4.5 Health check per rolling deploy

Aggiungere a `scripts/rolling-restart.sh`:

```bash
#!/usr/bin/env bash
# Rolling restart di tutti i tenant PB dopo un aggiornamento del binario.
for ENV in /etc/pb/*.env; do
    SLUG=$(basename "${ENV}" .env)
    PORT=$(grep '^PORT=' "${ENV}" | cut -d= -f2)
    echo "→ Restarting pb@${SLUG} (port ${PORT})..."
    systemctl restart "pb@${SLUG}"
    # Wait for healthy
    for i in $(seq 1 30); do
        if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
            echo "  ✓ Healthy"
            break
        fi
        sleep 1
    done
done
echo "✓ All tenants restarted"
```

**Deliverable Fase 4** (✅ = fatto in repo):
- [x] Migration che restringe le regole di accesso (`1700000022`, `1700000025`)
- [x] Login obbligato nel frontend
- [x] Health check + rolling restart script (`scripts/rolling-restart.sh`)
- [x] CORS rimossa / same-origin via nginx
- [x] **Anti privilege-escalation**: `accounts.createRule=null` (`1700000036`) + hook `accounts.pb.js` blocca self-promote `role/attivo/email`
- [x] **audit_log append-only**: `1700000037` (delete=null, create solo auth)
- [x] **valutazioni hardening**: `1700000038` (unique `(candidato_fase,commissario,criterio)` + own-commissario rule) + hook `valutazioni.pb.js` (clamp voto + freeze su CONCLUSA)
- [x] **iscrizioni anti-spam**: hook con rate-limit IP (3/h, 10/giorno) + honeypot + min-time-on-page + validazione consensi GDPR + minore→tutore + scadenza concorso
- [x] **SMTP password cifrate**: hook `tenants.pb.js` con `$security.encrypt(val, GESTIMUS_SECRET_KEY)` + endpoint `POST /api/admin/tenants/:id/smtp-decrypt`
- [x] **CSV anti formula-injection**: `js/views/admin.js` (`csvField` prefissa `'` per `=+-@\t\r`)
- [x] **Admin UI `/_/` ristretta**: solo localhost di default (`deploy/Caddyfile`, `deploy/nginx-tenant.conf.template`)
- [x] **Rate-limit nginx**: zone `iscrizioni_rl`/`auth_rl` in `deploy/nginx-snippet-rl.conf`
- [x] **Piani SaaS + gating server-side**: `pb_migrations/1700000039`+`1700000040` + `pb_hooks/tenant_config.pb.js`, ciclo annuale da `piano_inizio`
- [x] **Auto-propagazione piano**: `onRecordAfterUpdate('tenants')` chiama `$http.send` su `/api/admin/apply-plan` del tenant, autenticato via `X-Gestimus-Key`

### 4.6 Sicurezza dell'admin UI PocketBase (`/_/`)

Di default, `/_/` di ogni tenant è raggiungibile solo da `127.0.0.1`. Reverse-proxy config:
- **nginx**: `deploy/nginx-tenant.conf.template` ha due `location` separate per `/_/` e `/api/`. La prima ha `allow 127.0.0.1; deny all;` + placeholder `__ADMIN_ALLOW__` che `provision-tenant.sh` sostituisce con `allow ...;` se viene passato `ADMIN_ALLOW_IPS=...`.
- **Caddy**: snippet `(pb_routes)` in `deploy/Caddyfile` con matcher `remote_ip`.

Per accedere all'admin UI in produzione:
1. **SSH tunnel** (raccomandato): `ssh -L 8091:127.0.0.1:8091 user@server` → `http://localhost:8091/_/`.
2. **Allowlist IP statico**: `ADMIN_ALLOW_IPS="1.2.3.4" sudo -E ./scripts/provision-tenant.sh <slug>`.

### 4.7 Cifratura SMTP password

L'hook `pb_hooks/tenants.pb.js`:
- Su `beforeCreateRequest`/`beforeUpdateRequest` cifra `smtp_password` se non già cifrata (prefisso `enc:v1:`).
- Usa `$security.encrypt(plain, $os.getenv('GESTIMUS_SECRET_KEY'))` (AES-256-GCM).
- Espone `POST /api/admin/tenants/:id/smtp-decrypt` (solo superadmin) — `scripts/apply-ente-smtp.sh` lo chiama prima di propagare al PB del tenant.
- Se la chiave manca, **non blocca** il save ma logga warning (compat con tenant esistenti). Per migrare le password legacy: `node scripts/encrypt-existing-smtp.mjs`.

La UI super-admin (`js/views/superadmin.js`) mostra `••••••••` se esiste già una password e invia il campo solo se l'utente lo modifica (`autocomplete=new-password`).

### 4.8 Piani SaaS + gating server-side + auto-propagazione

Workflow:
1. Super admin assegna piano (trial/starter/pro/ultra/ppe) nel form ente del PB platform → record `tenants` ha piano, scadenza, limiti.
2. `pb_hooks/tenants.pb.js` (sul platform) ha `onRecordAfterUpdate/Create` che chiama `POST http://127.0.0.1:<porta_pb>/api/admin/apply-plan` (vedi `pb_hooks/tenant_config.pb.js` sul tenant) via `$http.send`.
3. L'endpoint valida `X-Gestimus-Key` contro la `GESTIMUS_SECRET_KEY` dell'env del tenant (replicata dal provisioning) e fa upsert sul singleton `tenant_config`.
4. `onRecordBeforeCreateRequest('concorsi'|'iscrizioni')` legge `tenant_config` (cache 60s) e blocca con `BadRequestError` se il limite è raggiunto o il piano è scaduto.
5. Cache invalidata istantaneamente all'upsert (`afterCreate/afterUpdate('tenant_config')`).

Componenti:
- `js/piani.js` — catalogo piani condiviso (single source of truth).
- `pb_migrations/1700000039_tenants_piano.js` — campi piano su `tenants` (PB platform).
- `pb_migrations/1700000040_tenant_config.js` — collection singleton sul PB del tenant.
- `pb_hooks/tenant_config.pb.js` — gating + endpoint apply-plan.
- `pb_hooks/tenants.pb.js` — auto-propagazione + endpoint plan-for-apply (fallback script).
- `scripts/apply-ente-plan.sh` — propagazione manuale (fallback se PB tenant offline).

Counter iscritti: per anno **dall'anniversario di `piano_inizio`** (es. attivato il 15 marzo → ciclo 15 mar - 14 mar). I concorsi `stato=CONCLUSO` non contano nel limite. Fail-open se `tenant_config` vuota (utile in dev).

---

## FASE 5 — Super-admin piattaforma (3-4 giorni)

Per gestire tutti i tenant da una singola interfaccia (utile per il provider del servizio), creare una dashboard separata su un dominio admin.

### 5.1 Dashboard super-admin

Dominio: `admin.concorso.app`

Rotte:
- `/` — Lista tenant con stato (online/offline, #concorsi, #utenti, storage)
- `/tenant/:slug` — Dettaglio singolo tenant (UUID, porta, data creazione, ultimi 10 eventi)
- `/new` — Provisioning nuovo tenant (form → chiama lo script di provisioning)

Questa dashboard ha bisogno di un listato di tenant. Opzioni:

**Opzione A — File config centralizzato** (`/etc/pb/tenants.json`):
```json
[
  { "slug": "conservatorio-milano", "port": 8091, "domain": "conservatorio-milano.concorso.app", "created": "2026-01-15" },
  { "slug": "associazione-berchielli", "port": 8092, "domain": "associazione-berchielli.concorso.app", "created": "2026-02-20" }
]
```
La dashboard lo legge via API (`/api/tenants`) servita da un piccolo server Node.js separato.

**Opzione B — PocketBase separato per la piattaforma**:
Un PB "meta" su porta 8090 con una collection `tenants` che tiene traccia degli slug, porte, domini, stato.

Consigliata l'Opzione B — coerente con lo stack esistente.

### 5.2 API di provisioning

Il piccolo server Node.js (o il PB meta) espone:
- `POST /api/tenants` — crea un nuovo tenant (provisioning script)
- `DELETE /api/tenants/:slug` — rimuove un tenant (ferma PB,archivia pb_data, rimuove config)
- `GET /api/tenants/:slug/health` — health check
- `GET /api/tenants/:slug/stats` — statistiche rapide (# records per collection)

File: `services/admin-api.js` (~200 linee, Express/Fastify o anche solo PB hooks)

**Deliverable Fase 5**:
- [ ] Dashboard super-admin statica
- [ ] PB meta con collection `tenants`
- [ ] Script provisioning via API
- [ ] Health check per tenant

---

## FASE 6 — Test E2E e documentazione (2-3 giorni)

### 6.1 Test E2E Playwright per multitenant

Aggiornare `playwright.config.js` e creare test per:
- Login come admin e commissario
- Creazione concorso, candidati, fasi
- Vista commissario con valutazione
- Prenotazione aula
- Verifica che tenant A non vede dati di tenant B

File: `tests/multitenant.spec.js`

### 6.2 Documentazione operativa

Aggiornare `README.md` o creare `docs/` con:
- Guida al deploy (requisiti VPS, DNS, TLS)
- Guide operatore (provisioning tenant, backup, ripristino, aggiornamento PB)
- Guida sviluppatore (struttura del codice, aggiungere collection, aggiungere view)
- CHANGELOG

**Deliverable Fase 6**:
- [ ] Test E2E Playwright per flussi multitenant
- [ ] Documentazione operativa completa

---

## Riepilogo stime

| Fase | Descrizione | Giorni | Dipende da |
|---|---|---|---|
| **0** | Fondamenta multitenant (PB_URL, Caddy, systemd, provisioning) | 2-3 | — |
| **1** | Collection `enti` + branding dinamico | 2-3 | Fase 0 |
| **2** | Sezione Amministrazione (6 view) | 5-7 | Fase 1 |
| **3** | Commissario: prenotazioni visibili | 1-2 | Fase 2 |
| **4** | Hardening produzione (regole, auth, deploy) | 2-3 | Fase 2 |
| **5** | Super-admin piattaforma | 3-4 | Fase 0 |
| **6** | Test E2E + documentazione | 2-3 | Fase 4, 5 |
| | **Totale** | **17-25** | |

Ordine consigliato: **0 → 1 → 2 → 3 → 4 → 5 → 6**

Fasi 4 e 5 possono procedere in parallelo (persona diversa o dopo la Fase 2).

---

## Nuove collection — schema completo

```
enti (singleton)
├── nome                text      required max=255
├── descrizione         text
├── logo                file      max=5MB png/jpg/webp/svg
├── sito_web            url       max=500
├── email_contatto      email
├── telefono            text      max=50
├── indirizzo           text      max=500
├── colore_primario     text      max=7 (hex)
├── colore_secondario   text      max=7 (hex)
└── impostazioni        json      max=64KB

aule
├── nome                text      required max=255
├── capienza            number    min=1
├── descrizione         text
├── piano               text      max=20
├── note                text
└── attrezzatura        json      max=64KB

prenotazioni
├── fase                relation  → fasi (cascadeDelete)
├── aula                relation  → aule (no cascade)
├── data_ora_inizio     date      required
├── data_ora_fine       date      required
└── note                text
```

---

## Nuovi file — struttura

```
gestionale_concorso/
├── js/
│   ├── app.js                  ← routing aggiornato
│   ├── db.js                  ← mapper + CRUD per enti, aule, prenotazioni
│   ├── pb.js                   ← PB_URL dinamico (FASE 0)
│   └── views/
│       ├── admin.js             ← sidebar aggiornata
│       ├── admin-dashboard.js   ← NUOVO (FASE 2)
│       ├── admin-stats.js       ← NUOVO (FASE 2)
│       ├── admin-users.js       ← NUOVO (FASE 2)
│       ├── admin-aule.js        ← NUOVO (FASE 2)
│       ├── admin-prenotazioni.js← NUOVO (FASE 2)
│       ├── admin-impostazioni.js← NUOVO (FASE 2)
│       ├── commissario.js        ← agenda sessioni (FASE 3)
│       ├── home.js
│       └── login.js
├── pb_migrations/
│   ├── 1700000018_enti.js       ← NUOVO (FASE 1)
│   ├── 1700000019_aule.js       ← NUOVO (FASE 2)
│   ├── 1700000020_prenotazioni.js← NUOVO (FASE 2)
│   └── 1700000021_lockdown_rules.js← NUOVO (FASE 4)
├── deploy/
│   ├── Caddyfile                ← NUOVO (FASE 0)
│   ├── pb@.service              ← NUOVO (FASE 0)
│   └── provision-tenant.sh      ← NUOVO (FASE 0)
├── scripts/
│   ├── backup-all-tenants.sh     ← NUOVO (FASE 0)
│   ├── deploy-frontend.sh        ← NUOVO (FASE 0)
│   ├── rolling-restart.sh        ← NUOVO (FASE 4)
│   ├── provision-tenant.sh       ← NUOVO (FASE 0)
│   ├── setup-pb.js              ← esistente
│   ├── create-admin.js          ← esistente
│   ├── backup-pb.mjs            ← esistente
│   └── cleanup-e2e.mjs          ← esistente
└── services/
    └── admin-api.js              ← NUOVO (FASE 5, opzionale per MVP)
```

---

## Nota su MVP vs produzione

Per un MVP funzionante nel minor tempo possibile, l'ordine di priorità è:

1. **FASE 0** (fondamenta) — 2-3 giorni → rende il deploy multitenant possibile
2. **FASE 1** (`enti` + branding) — 2-3 giorni → completamento del branding per-ente
3. **FASE 2** (Amministrazione) — solo Panoramica + Aule + Prenotazioni + Impostazioni → 4 giorni

**MVP totale: ~9 giorni** per avere un prodotto deployato multitenant con gestione aule e prenotazioni.

Le Statistiche e la dashboard super-admin (Fase 5) possono arrivare nella iterazione successiva.