# Deploy Gestimus su VPS IONOS — dominio `gestimus.it`

Guida pratica per pubblicare **Gestimus** (stack Fastify + Postgres + Drizzle) su un VPS IONOS. Il dominio **`gestimus.it`** è il default; sostituiscilo se diverso. Tempo stimato: **~25-35 minuti** dalla VPS appena creata.

## Architettura finale

```
                        ┌─────────────────────────┐
                        │   nginx (porta 443/80)  │  ← Let's Encrypt wildcard
                        │   *.gestimus.it          │     (DNS-01 IONOS)
                        └──┬──────────────────────┘
                           │  proxy_pass http://127.0.0.1:4000
                           ▼
                  ┌────────────────────────────┐
                  │  gestimus.service          │  systemd · single unit
                  │  Node 22 + Fastify 5       │  TypeScript strict
                  │  TCP :4000 (localhost)     │  Drizzle ORM
                  └─────┬──────────────────────┘
                        │  resolve subdomain → tenant_id
                        ▼
                  ┌────────────────────────────┐
                  │  PostgreSQL 18             │  RLS per tabella
                  │  database "gestimus"       │  app.tenant_id per sessione
                  │  socket /var/run/postgresql│  LISTEN/NOTIFY → SSE
                  └────────────────────────────┘
```

- **`platform.gestimus.it`** → pannello super admin (gestione enti, SMTP, branding, metriche realtime)
- **`<slug>.gestimus.it`** → app cliente (admin + commissari + form iscrizione)

**Multitenancy logica**: un solo processo Node + un solo database. L'isolamento avviene a livello DB via Row-Level Security: il middleware Fastify legge il sottodominio dal `Host:` header, risolve il `tenant_id`, e setta `app.tenant_id` nella sessione PG (`SELECT app_set_tenant(...)` per ogni request). Le policy RLS rifiutano ogni cross-tenant read/write.

## Prerequisiti

- Dominio **`gestimus.it`** registrato su IONOS (o trasferito)
- VPS IONOS Ubuntu 24.04
- Accesso SSH come `root` con chiave SSH

### Taglia VPS consigliata per gestimus.it

Listino IONOS Italia (aggiornato — promo 24 mesi · poi rinnovo automatico al prezzo pieno · IVA 22% esclusa · attivazione una tantum **€10**):

| Piano | vCPU | RAM | NVMe | €/mese (promo) | €/mese (rinnovo) | Enti supportati |
|-------|----:|----:|----:|----:|----:|------|
| VPS XS+ | 1 | 1 GB | 10 GB | €1,00 | – (mensile) | demo / fino a ~20 enti idle |
| VPS S+ | 2 | 2 GB | 80 GB | €2,00 | €2,50 | 50–100 enti |
| VPS M+ | 4 | 4 GB | 120 GB | €3,00 | €4,50 | 150–300 enti |
| **VPS L+** ⭐ *(più venduto)* | **6** | **8 GB** | **240 GB** | **€5,00** | **€8,00** | **300–500 enti (fino a ~800 con tenant prevalentemente idle)** |
| VPS XL+ | 8 | 16 GB | 480 GB | €9,00 | €15,00 | 800–1500 enti |
| VPS XXL+ | 12 | 24 GB | 720 GB | €15,00 | €29,50 | 1500–3000 enti |

> **Nota — capacità cambiata con il nuovo stack PG+Fastify+Drizzle.** Lo stack PocketBase (legacy) richiedeva **1 processo per ente** (~50-150 MB RAM ciascuno), per cui la VPS L+ si fermava a 20-50 enti. Con multitenancy logica via `tenant_id`+RLS l'app è **un solo processo Node + un solo Postgres** condiviso: la RAM/CPU non scalano più col numero di enti ma col **traffico totale**, e il vincolo si sposta sul disco (~300 MB/tenant medio fra DB e allegati CV/foto) e sui picchi di utenti concorrenti (form pubblici aperti contemporaneamente). I numeri in tabella sono stime conservative basate sul nuovo modello, non ancora validate da load test in produzione.

**Consiglio**: per Gestimus parti con **VPS L+** (€5/mese promo, €8 a rinnovo) — è il piano "best seller", offre 240 GB NVMe (sufficienti per anni anche con upload foto+CV degli iscritti) e 8 GB RAM (Postgres `shared_buffers` ~2 GB + Fastify + nginx + cache OS, con margine per i picchi concorsi). Il datacenter più vicino fisicamente è la **Germania (Francoforte)** → conforme GDPR, latenza ~25-40 ms dall'Italia.

**Cosa è incluso in tutti i piani**:
- 1× IPv4 dedicato + 1× IPv6 con rete /80
- Traffico illimitato fino a **1 Gbps**
- SLA 99,99%
- Datacenter UE (Germania, Spagna) o extra-UE (UK, USA) — per GDPR scegli **DE o ES**

**Backup**: Cloud Backup IONOS è opzionale a **€0,06/GB/mese**. In alternativa lo script `scripts/backup-all-tenants.sh` (restic verso S3/B2 esterno) → tipicamente più economico per dataset >50 GB.

## Step 1 — DNS

Pannello DNS IONOS per `gestimus.it`:

| Tipo | Nome | Valore |
|------|------|--------|
| A | `@` (root) | `<IP-del-VPS>` |
| A | `*` (wildcard) | `<IP-del-VPS>` |

Dopo la propagazione (1-30 min) il dominio `gestimus.it`, `platform.gestimus.it`, `ente1.gestimus.it`, `qualsiasi.gestimus.it` punta al VPS.

## Step 2 — API key DNS IONOS

Per il certificato **wildcard** TLS:
1. Vai su [developer.hosting.ionos.it/keys](https://developer.hosting.ionos.it/keys)
2. Crea API key → annota **prefix** e **secret**

## Step 3 — Setup VPS (Ubuntu 24.04)

```bash
ssh root@<IP-VPS>

# Pacchetti di sistema (senza Postgres: serve PG18, non nei repo Ubuntu 24.04)
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-dns-ionos \
  fail2ban ufw git curl ca-certificates

# PostgreSQL 18 dal repo ufficiale PGDG (Ubuntu 24.04 ferma a PG16 nei repo base,
# ma il backend richiede uuidv7() nativo introdotto in PG18)
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt noble-pgdg main" >/etc/apt/sources.list.d/pgdg.list
apt update
apt install -y postgresql-18 postgresql-contrib-18

# Node 22 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Firewall
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# Utente di servizio non-root
useradd -m -s /bin/bash gestimus
mkdir -p /opt/gestimus /etc/gestimus /var/log/gestimus
chown gestimus:gestimus /opt/gestimus /var/log/gestimus

# Clone del repo
sudo -u gestimus git clone <repo-gestimus-url> /opt/gestimus
cd /opt/gestimus/server
sudo -u gestimus npm ci --omit=dev
sudo -u gestimus npm run build   # compila TS in dist/
```

**Hardening SSH** (consigliato):
```bash
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

**Snippet rate-limit nginx**:
```bash
cp /opt/gestimus/deploy/nginx-snippet-rl.conf /etc/nginx/conf.d/gestimus-rl.conf
# Zone: iscrizioni_rl (5r/min) + auth_rl (10r/min). Caricate prima dei server block.
```

## Step 4 — Credenziali IONOS

```bash
sudo nano /etc/letsencrypt/ionos.ini
```

```ini
dns_ionos_prefix = il-tuo-prefix
dns_ionos_secret = il-tuo-secret
dns_ionos_endpoint = https://api.hosting.ionos.com
```

```bash
sudo chmod 600 /etc/letsencrypt/ionos.ini
```

## Step 5 — Certificato wildcard `*.gestimus.it`

```bash
sudo certbot certonly \
  --authenticator dns-ionos \
  --dns-ionos-credentials /etc/letsencrypt/ionos.ini \
  --dns-ionos-propagation-seconds 60 \
  -d gestimus.it -d "*.gestimus.it" \
  --email admin@gestimus.it --agree-tos --no-eff-email
```

Output atteso:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/gestimus.it/fullchain.pem
```

> **Rinnovo automatico**: certbot installa già una cron che rinnova entro 30 giorni dalla scadenza. Verifica: `sudo certbot renew --dry-run`.

## Step 6 — PostgreSQL + bootstrap del database

```bash
# Postgres 18 è già installato + avviato dall'apt step. Verifica:
systemctl status postgresql

# Bootstrap ruoli + DB gestimus
sudo -u postgres psql <<SQL
CREATE ROLE gestimus_super LOGIN PASSWORD '$(openssl rand -hex 16)' BYPASSRLS CREATEDB;
CREATE ROLE gestimus_app LOGIN PASSWORD '$(openssl rand -hex 16)';
CREATE DATABASE gestimus OWNER gestimus_super;
SQL
# Annota le password generate, le useremo in /etc/gestimus/server.env
```

Configura le variabili d'ambiente:

```bash
cat >/etc/gestimus/server.env <<EOF
NODE_ENV=production
PORT=4000
HOST=127.0.0.1

# Connessioni DB (sostituisci <pwd_super> / <pwd_app> con quelle generate sopra)
DATABASE_URL_SUPER=postgres://gestimus_super:<pwd_super>@localhost:5432/gestimus
DATABASE_URL_APP=postgres://gestimus_app:<pwd_app>@localhost:5432/gestimus

# Secret cookie sessione (32+ char random)
SESSION_COOKIE_SECRET=$(openssl rand -hex 32)
SESSION_COOKIE_NAME=gestimus_session
SESSION_TTL_HOURS=72

# Secret per cifrare le SMTP password dei tenant (AES-GCM)
# IMPORTANTE: salvala in un password manager. Cambiarla rende illeggibili le
# password SMTP già cifrate at-rest.
GESTIMUS_SECRET_KEY=$(openssl rand -hex 32)

# Subdomain del super-admin (resto dei subdomain = enti)
SUPERADMIN_SUBDOMAIN=platform

# Uploads
UPLOADS_DIR=/var/lib/gestimus/uploads
UPLOADS_MAX_FILE_SIZE_MB=5
EOF

chown gestimus:gestimus /etc/gestimus/server.env
chmod 600 /etc/gestimus/server.env

# Crea la dir uploads
mkdir -p /var/lib/gestimus/uploads
chown gestimus:gestimus /var/lib/gestimus/uploads
```

Applica schema + policy RLS + migrations incrementali:

```bash
cd /opt/gestimus/server
sudo -u gestimus -i bash -c "cd /opt/gestimus/server && \
  set -a && source /etc/gestimus/server.env && set +a && \
  npm run db:setup"
# db:setup = drizzle-kit push (crea tabelle dallo schema.ts) + apply-policies.ts (RLS + grants)

# Migrazioni ALTER TABLE incrementali (solo se il DB ha già lo schema base)
for f in /opt/gestimus/server/scripts/migrations/*.sql; do
  sudo -u postgres psql -d gestimus -f "$f"
done
```

## Step 7 — systemd unit

```bash
cat >/etc/systemd/system/gestimus.service <<'EOF'
[Unit]
Description=Gestimus backend (Fastify + Postgres)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=gestimus
Group=gestimus
WorkingDirectory=/opt/gestimus/server
EnvironmentFile=/etc/gestimus/server.env
ExecStart=/usr/bin/node /opt/gestimus/server/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/gestimus/server.log
StandardError=append:/var/log/gestimus/server.err

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/gestimus /var/log/gestimus

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gestimus
systemctl status gestimus
```

## Step 8 — Configurazione nginx

Un singolo virtual host gestisce `*.gestimus.it` (wildcard) + `gestimus.it` (root). Tutto il traffico viene proxied a `127.0.0.1:4000`.

```bash
cat >/etc/nginx/sites-available/gestimus.conf <<'EOF'
server {
  listen 80;
  listen [::]:80;
  server_name gestimus.it *.gestimus.it;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name gestimus.it *.gestimus.it;

  ssl_certificate     /etc/letsencrypt/live/gestimus.it/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/gestimus.it/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  # Body limit per upload (foto candidato/concorso + ricevuta iscrizione)
  client_max_body_size 8m;

  # SSE per il timer fase ha bisogno di buffering off + timeout lunghi
  location /api/realtime/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
  }

  # Rate-limit applicato dal snippet gestimus-rl.conf
  location /auth/login { limit_req zone=auth_rl burst=5 nodelay; try_files $uri @app; }
  location /api/public/iscrizioni { limit_req zone=iscrizioni_rl burst=2 nodelay; try_files $uri @app; }

  location / { try_files $uri @app; }
  location @app {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

ln -sf /etc/nginx/sites-available/gestimus.conf /etc/nginx/sites-enabled/gestimus.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## Step 9 — Provisioning del super-admin

A differenza del vecchio stack PocketBase, **non c'è uno script shell** per creare il super-admin: il primo super-admin si crea via Drizzle direttamente dal DB (one-shot, poi nuovi super-admin si creano dalla UI).

```bash
# Genera password hash Argon2id offline
sudo -u gestimus -i bash -c "cd /opt/gestimus/server && \
  set -a && source /etc/gestimus/server.env && set +a && \
  node -e \"
    import('./dist/services/password.js').then(async ({ hashPassword }) => {
      const h = await hashPassword('TUA_PASSWORD_FORTE');
      console.log(h);
    });
  \""
# Output: \$argon2id\$v=19\$...
```

Inserisci il record nel DB (super-admin non ha un tenant — è uno special "tenant null"):

```sql
INSERT INTO accounts (id, tenant_id, email, password_hash, role, attivo, email_verified)
VALUES (
  uuidv7(),
  NULL,  -- super-admin → niente tenant
  'super@gestimus.it',
  '<hash_argon2_dal_comando_sopra>',
  'superadmin',
  true,
  true
);
```

> Login: `https://platform.gestimus.it` con quelle credenziali. Da lì puoi creare nuovi super-admin, gli enti, gli admin di ente, e configurare SMTP — tutto da UI, senza accesso shell.

## Step 10 — Primo ente cliente

**Dalla UI super-admin** (`https://platform.gestimus.it` → "Gestione Enti" → "Nuovo ente"):
1. Slug univoco (es. `liceo-musicale-milano` → ASCII minuscolo, no spazi)
2. Nome esteso ("Liceo Musicale Milano")
3. Piano SaaS (trial/starter/pro/ultra/ppe)
4. Email admin → l'admin riceverà password temporanea (richiede SMTP configurato sul tenant; in alternativa la copia il super-admin manualmente)

Risultato automatico:
- Record `tenants` con `slug=liceo-musicale-milano`, `stato=attivo`
- Account `admin@<ente>` con `role=admin`, `tenant_id=<id>`
- L'app è subito raggiungibile su `https://liceo-musicale-milano.gestimus.it` (il wildcard nginx + middleware tenant resolver fanno il resto)

## Step 11 — Test finale

| URL | Cosa testare |
|-----|--------------|
| `https://platform.gestimus.it` | Login super admin → Gestione Enti → metriche realtime (RSS/CPU + sparkline) |
| `https://liceo-musicale-milano.gestimus.it` | Login admin dell'ente, crea concorso/sezione/categoria/fase |
| `https://liceo-musicale-milano.gestimus.it/#/iscrizione` | Form iscrizione pubblico (richiede `iscrizioni_aperte=true` sul concorso) |
| `curl https://gestimus.it/healthz` | `{ok:true, ts:"..."}` — sanity check |

## Comandi quotidiani

### Aggiungere un nuovo ente
**Dalla UI super-admin** (`https://platform.gestimus.it` → "Gestione Enti" → "Nuovo ente"). Tutto il provisioning è automatico: niente più script bash, niente più systemd per-tenant.

Sotto il cofano: viene inserita una riga in `tenants` con il nuovo slug, e il middleware tenant-resolver risolve immediatamente il nuovo sottodominio (`<slug>.gestimus.it`) sulla stessa istanza Fastify. La policy RLS isola automaticamente i dati.

### Aggiornare il codice
```bash
cd /opt/gestimus
sudo -u gestimus git pull

cd server
sudo -u gestimus npm ci --omit=dev
sudo -u gestimus npm run build

# Migrations incrementali (se sono state aggiunte nuove ALTER TABLE)
for f in scripts/migrations/*.sql; do
  sudo -u postgres psql -d gestimus -f "$f"
done

# Restart soft (zero-downtime non garantito su single-instance — per HA serve PM2 cluster o due VPS dietro LB)
sudo systemctl restart gestimus
```

### Configurazione SMTP per ente
Dalla UI super-admin: ogni ente ha la propria sezione SMTP. La password viene cifrata at-rest (AES-256-GCM) con `GESTIMUS_SECRET_KEY` di `/etc/gestimus/server.env`. **Backup-la in un password manager**: se la perdi, le SMTP password salvate diventano illeggibili e l'invio email smette di funzionare.

Test SMTP via UI: bottone "Test invio" sulla riga del tenant → invia mail di prova all'indirizzo specificato.

### Cleanup tenant archiviati
La UI super-admin permette di **sospendere** o **archiviare** un tenant. Un tenant archiviato è soft-deleted: i dati restano in DB ma:
- Il login admin/commissario è bloccato (`stato='archiviato'` → 403)
- Il form pubblico delle iscrizioni risponde 403
- Dopo `cleanup_after_days` giorni (default 30, configurabile per-tenant) il job `cleanup` esegue l'hard-delete (CASCADE su tutte le tabelle figlie via FK)

Job cleanup:
```bash
# Esegue manualmente (configura una cron per il run periodico)
sudo -u gestimus -i bash -c "cd /opt/gestimus/server && \
  set -a && source /etc/gestimus/server.env && set +a && \
  node dist/scripts/cleanup-tenants.js"
```

### Monitoraggio
```bash
# Stato del servizio
sudo systemctl status gestimus

# Log live
sudo journalctl -u gestimus -f
# oppure
sudo tail -f /var/log/gestimus/server.log

# Health check
curl https://gestimus.it/healthz

# Metriche realtime (dal pannello super-admin: card "Sistema" + sparkline 5min)
# Endpoint diretti:
curl -b cookies.txt https://platform.gestimus.it/api/platform/system   # RSS, CPU%, uptime
curl -b cookies.txt https://platform.gestimus.it/api/platform/runtime  # per-tenant req/min, p50, p95
```

### Backup PG

```bash
# Crontab di gestimus: backup giornaliero notturno
crontab -u gestimus -e
# 0 3 * * * pg_dump -h localhost -U gestimus_super gestimus | gzip > /var/backups/gestimus/$(date +\%F).sql.gz

# Backup off-site (consigliato): restic verso S3/B2
restic init --repo s3:s3.amazonaws.com/bucket/gestimus
restic --repo s3:... backup /var/backups/gestimus /var/lib/gestimus/uploads
```

Configurazione cron suggerita:
- **03:00 UTC**: `pg_dump` locale (~50MB compresso per ~5 enti di taglia media)
- **03:30 UTC**: `restic backup` su S3-compatibile
- **Domenica 04:00**: `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune` per retention

## Sicurezza in produzione

1. **Password root SSH disabilitata** (vedi Step 3 hardening). Login solo via chiave SSH.
2. **Firewall**: solo SSH (22) + HTTP (80) + HTTPS (443) esposti. Postgres (5432) NON è raggiungibile da remoto — solo `127.0.0.1`.
3. **fail2ban**: attivo di default per SSH. Le regole nginx per rate-limit sono integrate in `gestimus-rl.conf`.
4. **Aggiornamenti automatici** (sistema):
   ```bash
   sudo apt install unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```
5. **Chiave `GESTIMUS_SECRET_KEY`**: in `/etc/gestimus/server.env`. Cifra le password SMTP at-rest. **Salvala in password manager**: cambiarla rende illeggibili le password SMTP precedenti.
6. **`SESSION_COOKIE_SECRET`**: stesso file. Cambiandolo invalidi tutte le sessioni attive.
7. **Rate-limit form pubblico**: doppio livello:
   - **Fastify** (`@fastify/rate-limit`): 3 iscrizioni/h per IP, 10/giorno per IP.
   - **nginx** (`gestimus-rl.conf`): zone `iscrizioni_rl` (5r/min) — già integrata nel server block.
8. **RLS**: ogni connessione applicativa setta `app.tenant_id` e le policy filtrano. Anche se un endpoint avesse un bug logico, il DB rifiuta cross-tenant.
9. **Audit log immutabile**: `REVOKE UPDATE, DELETE ON audit_log, platform_audit_log FROM gestimus_app` (vedi `policies.sql`). Solo `gestimus_super` può cancellare (per GDPR Art. 17).
10. **Postgres listen address**: di default è `localhost` — verifica `/etc/postgresql/16/main/postgresql.conf` e `pg_hba.conf` per assicurarti che il DB non sia raggiungibile da rete pubblica.

## Costo annuo per `gestimus.it`

Costi reali IVA esclusa (aggiungi 22% per il totale lordo):

| Voce | Anno 1 (promo) | Anno 2 (promo) | Anno 3+ (rinnovo) |
|------|---------------:|---------------:|-------------------:|
| Dominio `gestimus.it` (IONOS, .it) | ~€10 | ~€12 | ~€12 |
| **VPS L+** (6 vCPU, 8 GB, 240 GB NVMe) | €60 (€5×12) | €60 (€5×12) | €96 (€8×12) |
| Attivazione VPS (una tantum) | €10 | – | – |
| Certificati Let's Encrypt wildcard | 0 | 0 | 0 |
| **Totale netto** | **~€80** | **~€72** | **~€108** |
| **Totale lordo (IVA 22%)** | **~€98** | **~€88** | **~€132** |

Per **enti illimitati** (~300-500 sul VPS L+ col nuovo stack PG+Fastify, vedi tabella sopra). Se servono più enti, scala a VPS XL+ (€132/anno promo).

### Costo "per ente" (ammortizzato)

| Enti sul VPS L+ | Costo infra/ente/anno (lordo) |
|---:|---:|
| 5 enti | €26,40 |
| 10 enti | €13,20 |
| 20 enti | €6,60 |
| 50 enti | €2,64 |
| 100 enti | €1,32 |
| 300 enti | **€0,44** |
| 500 enti (capacità realistica VPS L+) | **€0,26** |

Confronto: piattaforme SaaS dedicate equivalenti partono da €30/mese per istanza.

---

## Ricavi e margini con i piani SaaS Gestimus

Listino vendita (definito in `js/piani.js`, prezzi **IVA inclusa 22%**):

| Piano | Prezzo IVA incl. | Imponibile (al netto IVA 22%) | Stripe fee (~1,5% + €0,25) | **Margine netto incassato** |
|---|---:|---:|---:|---:|
| Trial | gratis · 30 gg | – | – | €0 (acquisizione) |
| **Starter** | €150 | €122,95 | €2,50 | **€120,45** |
| **Pro** ⭐ | €230 | €188,52 | €3,70 | **€184,82** |
| **Ultra** | €350 | €286,89 | €5,50 | **€281,39** |
| **PPE** (per concorso) | €100 setup + €1/iscr. | variabile | ~1,7% | margine medio ~96% |

Esempio PPE concorso medio (100 iscritti): €100 + €1×100 = **€200 IVA incl.** → €163,93 imponibile − €3,70 Stripe ≈ **€160 margine netto**.

### Scenario realistico — 20 enti sul VPS L+ (regime, anno 3+)

Mix tipico in un MVP che sta crescendo:

| Piano | Clienti | Ricavo annuo netto |
|---|---:|---:|
| Starter | 4 | €482 |
| Pro | 12 | €2.218 |
| Ultra | 3 | €844 |
| PPE (~5 concorsi/anno, 100 iscr/concorso) | 1 | €803 |
| **Totale ricavi netti** | **20** | **~€4.347** |
| **− Costi infra (VPS + dominio)** | | −€108 |
| **= Margine annuo** | | **~€4.239** |

Cliente che entra in Starter e nell'anno 2 passa a Pro → +€64 di MRR aggiuntivo gratis.

### Scenario "crescita matura" — 50 enti sul VPS L+

Mix possibile a regime con marketing attivo (la VPS L+ tecnicamente regge ~300-500 enti, qui mostriamo uno scenario commerciale realistico di medio termine):

| Piano | Clienti | Ricavo annuo netto |
|---|---:|---:|
| Starter | 15 | €1.807 |
| Pro | 30 | €5.545 |
| Ultra | 5 | €1.407 |
| **Totale ricavi netti** | **50** | **~€8.759** |
| − Costi infra | | −€108 |
| **= Margine annuo** | | **~€8.651** |

Headroom tecnico abbondante: la stessa VPS L+ può ospitare 6-10× questo volume prima di dover scalare. Quando si avvicina la saturazione reale (>500 enti o picchi di concorrenza elevati), si sale a **VPS XL+** (€132/anno promo, €180 rinnovo) — supporta 800-1500 enti, infra resta sotto €0,20/ente/anno.

### Break-even

Costo infra fisso (anno 3+): **€108/anno netto**.

| Quanti clienti per coprirlo? |  |
|---|---|
| Solo Pro | **1 cliente** Pro paga 1,7× i costi |
| Solo Starter | 1 cliente Starter copre il 112% dei costi |
| Solo PPE | <1 concorso PPE attivato nell'anno (100 iscr/concorso) copre già 1,5× i costi |

**ROI Anno 1**: con setup VPS €10 una tantum + €60 VPS promo + €10 dominio = €80 netti di investimento, basta 1 cliente Pro per andare in attivo dal primo anno.

### Note fiscali

- **IVA**: i prezzi listino sono IVA inclusa (22%). Se sei in regime forfettario, non addebiti IVA → marginalità reale = prezzo intero meno costi (es. Starter forfettario = €150 − €2,50 Stripe − €5,40 infra = €142 margine).
- **Costi deducibili**: VPS, dominio, Stripe fee, eventuali abbonamenti SMTP/backup sono interamente deducibili come costi di produzione.
- **Fattura elettronica**: per clienti italiani serve emettere fattura elettronica via SDI (gratuita su `fatture in cloud`, `Aruba`, etc.); per i piani annuali una fattura/anno, per PPE una fattura/concorso.

## Troubleshooting

| Sintomo | Verifica |
|---------|----------|
| PB non parte | `sudo journalctl -u pb@<slug> --no-pager -n 80` |
| nginx 502 | `curl 127.0.0.1:<porta>/api/health` — verifica che PB sia in ascolto |
| Sottodominio non risolve | `dig +short ente1.gestimus.it` deve ritornare l'IP del VPS |
| Cert scaduto | `sudo certbot certificates` per data; `sudo certbot renew --force-renewal` |
| Iscrizione pubblica fallisce | `sudo tail -f /var/log/nginx/error.log` + console browser |
| SMTP non spedisce | `sudo journalctl -u pb@<slug> --since "10 min ago"` → cerca "smtp" |
| Disco pieno | `sudo du -sh /srv/pb/data/* | sort -h` per identificare l'ente più grosso |

## File di riferimento del repo

- `deploy/gestimus.env` — configurazione dominio + hint `GESTIMUS_SECRET_KEY`
- `deploy/pb@.service` — systemd unit
- `deploy/nginx-tenant.conf.template` — template config nginx (con `__ADMIN_ALLOW__` placeholder)
- `deploy/nginx-snippet-rl.conf` — zone rate-limit nginx (installato in `/etc/nginx/conf.d/`)
- `deploy/Caddyfile` — snippet `(pb_routes)` con `/_/` IP-restricted
- `scripts/setup-server.sh` — provisioning VPS (genera `GESTIMUS_SECRET_KEY`, installa snippet rate-limit)
- `scripts/provision-tenant.sh` — provisioning ente (opt `ADMIN_ALLOW_IPS`)
- `scripts/remove-tenant.sh` — rimozione ente
- `scripts/apply-ente-smtp.sh` — propagazione SMTP (con decrypt automatico)
- `scripts/encrypt-existing-smtp.mjs` — migra SMTP password legacy → cifrate
- `scripts/rolling-restart.sh` — restart sequenziale post-update
- `scripts/backup-all-tenants.sh` — backup restic

---

**Domanda frequente**: posso usare un dominio diverso?
→ Sì: modifica `deploy/gestimus.env` (cambia `DOMAIN_BASE` e `LE_EMAIL`), tutti gli script lo leggeranno. Non rinominare il file (lo cercano gli script).
