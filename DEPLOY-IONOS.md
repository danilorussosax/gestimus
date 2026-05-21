# Deploy Gestimus su VPS IONOS — dominio `gestimus.it`

Guida pratica per pubblicare **Gestimus** su un VPS IONOS, con il dominio **`gestimus.it`** già configurato come default in tutti gli script. Tempo stimato: **~30-40 minuti** dalla VPS appena creata.

## Architettura finale

```
                        ┌─────────────────────────┐
                        │   nginx (porta 443/80)  │  ← Let's Encrypt wildcard
                        │   *.gestimus.it          │
                        └──┬──────────────────────┘
            ┌──────────────┼─────────────────────┬────────────┐
            ▼              ▼                     ▼            ▼
   platform.gestimus.it  ente1.gestimus.it   ente2.gestimus.it  ente3.…
       :8093                :8091                :8092            :809…
   pb@platform          pb@ente1              pb@ente2          pb@ente3
   (super admin)        (Liceo musicale)      (Conservatorio)   …
```

- **`platform.gestimus.it`** → pannello super admin (gestione enti, SMTP, branding)
- **`<slug>.gestimus.it`** → app cliente (admin + commissari + form iscrizione)

## Prerequisiti

- Dominio **`gestimus.it`** registrato su IONOS (o trasferito)
- VPS IONOS Ubuntu 24.04
- Accesso SSH come `root` con chiave SSH

### Taglia VPS consigliata per gestimus.it

Listino IONOS Italia (aggiornato — promo 24 mesi · poi rinnovo automatico al prezzo pieno · IVA 22% esclusa · attivazione una tantum **€10**):

| Piano | vCPU | RAM | NVMe | €/mese (promo) | €/mese (rinnovo) | Enti supportati |
|-------|----:|----:|----:|----:|----:|------|
| VPS XS+ | 1 | 1 GB | 10 GB | €1,00 | – (mensile) | demo / single tenant |
| VPS S+ | 2 | 2 GB | 80 GB | €2,00 | €2,50 | 3–8 enti leggeri |
| VPS M+ | 4 | 4 GB | 120 GB | €3,00 | €4,50 | 8–20 enti standard |
| **VPS L+** ⭐ *(più venduto)* | **6** | **8 GB** | **240 GB** | **€5,00** | **€8,00** | **20–50 enti completi** |
| VPS XL+ | 8 | 16 GB | 480 GB | €9,00 | €15,00 | 40–100 enti |
| VPS XXL+ | 12 | 24 GB | 720 GB | €15,00 | €29,50 | 60–150 enti |

**Consiglio**: per Gestimus parti con **VPS L+** (€5/mese promo, €8 a rinnovo) — è il piano "best seller", offre 240 GB NVMe (sufficienti per anni anche con upload foto+CV degli iscritti) e 8 GB RAM (margine per N processi PocketBase + nginx + buffer SSE realtime). Il datacenter più vicino fisicamente è la **Germania (Francoforte)** → conforme GDPR, latenza ~25-40 ms dall'Italia.

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

## Step 3 — Setup VPS

```bash
ssh root@<IP-VPS>

git clone <repo-gestimus-url> /opt/gestimus
cd /opt/gestimus

# Tutto il default è su gestimus.it grazie a deploy/gestimus.env
sudo bash scripts/setup-server.sh
```

Lo script (~3-5 min):
- Crea utenti `gestimus` (sudo) + `pb` (system)
- Installa: nginx, certbot, plugin DNS IONOS, fail2ban, ufw, nodejs, jq, sqlite3
- Configura firewall (SSH/HTTP/HTTPS)
- Hardening SSH (no root login, no password)
- Scarica PocketBase v0.22.27 in `/srv/pb/`
- Installa systemd template `pb@.service`
- Prepara `/srv/pb/{data,pb_migrations,pb_hooks,archive}` + `/etc/pb`

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

## Step 6 — Deploy del codice

```bash
# Frontend statico in /var/www/gestimus
sudo rsync -av --exclude=node_modules --exclude=.git --exclude=pocketbase --exclude='pb_data*' \
  /opt/gestimus/ /var/www/gestimus/

# Migrations + hooks in /srv/pb/
sudo cp -v /opt/gestimus/pb_migrations/* /srv/pb/pb_migrations/
sudo cp -v /opt/gestimus/pb_hooks/* /srv/pb/pb_hooks/
sudo chown -R pb:pb /srv/pb
```

## Step 7 — Provisiona il super admin

```bash
sudo /opt/gestimus/scripts/provision-tenant.sh platform
```

Lo slug `platform` viene riconosciuto come speciale → dominio `platform.gestimus.it`, porta `8093`. Lo script ti chiederà email + password del super admin.

A fine procedura:
```
URL:     https://platform.gestimus.it
Admin:   https://platform.gestimus.it/_/
```

## Step 8 — Primo ente cliente

Per ogni cliente assegna uno **slug univoco** (ASCII minuscolo, no spazi):

```bash
sudo /opt/gestimus/scripts/provision-tenant.sh liceo-musicale-milano
```

Risultato: `https://liceo-musicale-milano.gestimus.it`. La porta è auto-assegnata (prima libera dal 8091).

> **Tip**: l'admin dell'ente può anche essere creato DOPO via super admin → "Gestione Enti" → icona chiave 🔓 sulla card. È più rapido se hai molti enti da provisionare in serie senza interagire con il prompt password.

## Step 9 — Test finale

| URL | Cosa testare |
|-----|--------------|
| `https://platform.gestimus.it` | Login super admin → Gestione Enti |
| `https://liceo-musicale-milano.gestimus.it` | Login admin dell'ente |
| `https://liceo-musicale-milano.gestimus.it/#/iscrizione` | Form iscrizione pubblico (se il concorso è aperto) |
| `https://liceo-musicale-milano.gestimus.it/_/` | UI admin PocketBase (per debug) |

## Comandi quotidiani

### Aggiungere un nuovo ente
```bash
sudo /opt/gestimus/scripts/provision-tenant.sh conservatorio-roma
# Crea automaticamente:
# - data dir /srv/pb/data/conservatorio-roma
# - systemd unit pb@conservatorio-roma + start
# - config nginx /etc/nginx/sites-available/conservatorio-roma.conf
# - sottodominio https://conservatorio-roma.gestimus.it
```

### Aggiornare il codice
```bash
cd /opt/gestimus && sudo -u gestimus git pull
sudo rsync -av --exclude=node_modules --exclude=.git --exclude=pocketbase --exclude='pb_data*' \
  /opt/gestimus/ /var/www/gestimus/
sudo cp -v /opt/gestimus/pb_migrations/* /srv/pb/pb_migrations/
sudo cp -v /opt/gestimus/pb_hooks/* /srv/pb/pb_hooks/
sudo chown -R pb:pb /srv/pb
sudo /opt/gestimus/scripts/rolling-restart.sh
```

### Propagare SMTP a un ente
Dopo aver configurato SMTP dal pannello super admin:
```bash
source /opt/gestimus/deploy/gestimus.env
SUPERADMIN_PWD="<password>" \
ENTE_ADMIN_PWD="<password admin di quell'ente>" \
sudo -E -u gestimus /opt/gestimus/scripts/apply-ente-smtp.sh liceo-musicale-milano
```

(Le variabili `PLATFORM_URL`, `SUPERADMIN_EMAIL` arrivano da `gestimus.env`.)

### Rimuovere un ente
```bash
sudo /opt/gestimus/scripts/remove-tenant.sh ente-vecchio              # archivia dati
sudo /opt/gestimus/scripts/remove-tenant.sh ente-vecchio --purge -y   # cancella
```

### Monitoraggio
```bash
# Stato di tutti i PB
sudo systemctl list-units 'pb@*.service'

# Log live di un ente
sudo journalctl -u pb@liceo-musicale-milano -f

# Test health di tutti gli enti
for f in /etc/pb/*.env; do
  port=$(grep PORT= "$f" | cut -d= -f2 | tr -d '[:space:]')
  slug=$(basename "$f" .env)
  code=$(curl -so /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health")
  echo "$slug (porta $port) → HTTP $code"
done

# Spazio disco residuo
df -h /srv/pb
```

### Backup
```bash
# Backup giornaliero di tutti i tenant (configura una cron)
sudo /opt/gestimus/scripts/backup-all-tenants.sh
```

## Sicurezza in produzione

1. **Cambia password di default** (`admin123` su seed/test) — usa quelle generate dal pannello super admin
2. **fail2ban** è attivo per SSH (vedi `/etc/fail2ban/jail.d/`)
3. **Aggiornamenti automatici**:
   ```bash
   sudo apt install unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```
4. **Backup off-site**: pianifica `backup-all-tenants.sh` con `restic` puntato a S3/B2

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

Per **enti illimitati** (~20-50 sul VPS L+, vedi tabella sopra). Se servono più enti, scala a VPS XL+ (€132/anno promo).

### Costo "per ente" (ammortizzato)

Con 20 enti sul VPS L+ a regime: **€5,40/ente/anno (lordo)** — confronta con piattaforme SaaS dedicate che partono da €30/mese per istanza.

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

- `deploy/gestimus.env` — configurazione dominio (sourceabile)
- `deploy/pb@.service` — systemd unit
- `deploy/nginx-tenant.conf.template` — template config nginx
- `scripts/setup-server.sh` — provisioning VPS
- `scripts/provision-tenant.sh` — provisioning ente
- `scripts/remove-tenant.sh` — rimozione ente
- `scripts/apply-ente-smtp.sh` — propagazione SMTP
- `scripts/rolling-restart.sh` — restart sequenziale post-update
- `scripts/backup-all-tenants.sh` — backup restic

---

**Domanda frequente**: posso usare un dominio diverso?
→ Sì: modifica `deploy/gestimus.env` (cambia `DOMAIN_BASE` e `LE_EMAIL`), tutti gli script lo leggeranno. Non rinominare il file (lo cercano gli script).
