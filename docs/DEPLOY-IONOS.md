# Deploy su VPS IONOS (Ubuntu/Debian)

Runbook per portare Gestimus in produzione su una singola VPS con lo script
`deploy/install.sh`. Stack: **Node 22 + PostgreSQL 18 + Nginx**, servizio
`systemd`, TLS Let's Encrypt. App stateless (sessioni in DB) → il solo stato è
Postgres.

## Architettura runtime

```
Internet ──HTTPS──> Nginx (:443, edge, TLS, *.gestimus)
                      │  proxy_pass, Host preservato (tenant = sottodominio)
                      ▼
                 Fastify (127.0.0.1:4000)  ── serve API + SPA React (frontend/dist) + uploads
                      │
                      ▼
                 PostgreSQL 18 (127.0.0.1:5432)  ── RLS per-tenant, ruoli gestimus_app / gestimus_super
```

Niente PgBouncer di default: per una singola istanza il pool Node (`DB_APP_POOL_MAX`)
basta. Se in futuro scali a più processi, aggiungi PgBouncer in transaction-mode
solo per `DATABASE_URL_APP` (SUPER resta diretto: usa advisory lock di sessione).

## Prerequisiti

1. VPS IONOS Ubuntu 22.04/24.04 o Debian 12, accesso root/sudo.
2. Un dominio (es. `gestimus.it`) con accesso ai record DNS.
3. **DNS** — punta all'IP della VPS:
   - `A   gestimus.it`
   - `A   platform.gestimus.it`
   - `A   *.gestimus.it`  ← wildcard, indispensabile per i tenant per-sottodominio
   - (opz.) `A   www.gestimus.it`

## Installazione

```bash
git clone <REPO_URL> /opt/gestimus
cd /opt/gestimus
sudo GESTIMUS_DOMAIN=gestimus.it LE_EMAIL=tu@example.com ./deploy/install.sh
```

Lo script (idempotente) esegue in sequenza:

1. pacchetti base (curl, git, openssl, ufw)
2. Node 22 (NodeSource)
3. PostgreSQL 18 (repo PGDG) + avvio cluster
4. Nginx + certbot
5. utente di sistema `gestimus` + posizionamento codice in `/opt/gestimus`
6. ruoli `gestimus_app` / `gestimus_super` (password generate) + database `gestimus`
7. `server/.env` con segreti forti (`openssl rand`), `chmod 600`
8. `npm ci && npm run build` di server e frontend
9. **schema + RLS**: `drizzle-kit push --force` → `db:policies` (policies.sql) → `db:sql:baseline`
10. super-admin platform (`db:seed:prod`, password generata)
11. servizio `systemd` `gestimus.service` (restart automatico, hardening)
12. Nginx reverse-proxy (Host preservato, SSE-friendly) + zone rate-limit
13. TLS http-01 per apex/platform/www
14. timer backup giornaliero (02:30)
15. firewall ufw (SSH + 80/443)
16. healthcheck `/readyz`

A fine run vengono stampati URL platform, credenziali super-admin e i prossimi passi.

## TLS wildcard per i tenant (DNS-01) — necessario

`certbot --nginx` (http-01) copre solo i nomi noti (apex/platform/www). I
sottodomini tenant sono dinamici → serve un **certificato wildcard**, ottenibile
solo via challenge **DNS-01**:

```bash
# Manuale (one-shot, rinnovo manuale):
sudo certbot certonly --manual --preferred-challenges dns \
  -d '*.gestimus.it' -d 'gestimus.it'

# Automatico con IONOS (rinnovo automatico): installa il plugin DNS IONOS
sudo apt install -y python3-pip && sudo pip install certbot-dns-ionos
# crea /etc/letsencrypt/ionos.ini con le API key IONOS (chmod 600), poi:
sudo certbot certonly --authenticator dns-ionos \
  --dns-ionos-credentials /etc/letsencrypt/ionos.ini \
  -d '*.gestimus.it' -d 'gestimus.it'
```

Poi punta il server-block Nginx (`/etc/nginx/sites-available/gestimus`) al cert
wildcard (`ssl_certificate .../fullchain.pem`) su un blocco `listen 443 ssl;` e
`nginx -t && systemctl reload nginx`.

## Aggiornamenti

Rilancia lo stesso script: aggiorna codice (git pull), ricompila, riallinea lo
schema e riavvia, **senza** toccare i segreti in `server/.env`:

```bash
cd /opt/gestimus && sudo GESTIMUS_DOMAIN=gestimus.it ./deploy/install.sh
```

Oppure manualmente:

```bash
sudo -u gestimus git -C /opt/gestimus pull
sudo -u gestimus bash -lc 'cd /opt/gestimus/server   && npm ci && npm run build'
sudo -u gestimus bash -lc 'cd /opt/gestimus/frontend && npm ci && npm run build'
sudo -u gestimus bash -lc 'cd /opt/gestimus/server   && npx drizzle-kit push --force && npm run db:policies'
sudo systemctl restart gestimus
```

## Migrazioni schema

In prod lo schema è applicato via `drizzle-kit push` (sorgente: `schema.ts`) +
`policies.sql`, e il ledger migrazioni è messo a `baseline`. Per cambi futuri:
aggiungi una migration SQL in `server/scripts/migrations/` (con `.down.sql`) e
applicala con `npm run db:sql:up` (gira solo le nuove), oppure ri-`push`.

## Backup & restore

- Backup automatico: `gestimus-backup.timer` (giornaliero, 02:30) → `npm run db:backup`.
- Manuale: `sudo -u gestimus bash -lc 'cd /opt/gestimus/server && npm run db:backup'`.
- **Testa il restore prima del lancio** (non dare per scontato un backup mai ripristinato).
- Conserva una copia **off-site** (i dump contengono dati personali → cifrati).

## Operazioni utili

```bash
systemctl status gestimus          # stato servizio
journalctl -u gestimus -f          # log live
systemctl restart gestimus         # riavvio (dopo modifiche a .env)
curl -fsS http://127.0.0.1:4000/readyz   # readiness (DB up)
sudo -u gestimus bash -lc 'cd /opt/gestimus/server && npm run db:sql:status'  # stato migrazioni
```

## Troubleshooting

| Sintomo | Causa probabile | Fix |
|---------|-----------------|-----|
| `/readyz` 503 | DB non raggiungibile | `systemctl status postgresql`; verifica `DATABASE_URL_*` in `server/.env` |
| Login non parte / 400 | tenant non risolto | l'Host deve arrivare a Fastify: Nginx ha `proxy_set_header Host $host` (lo script lo fa) |
| certbot fallisce | DNS non ancora propagato | aspetta la propagazione dei record A, poi rilancia `certbot --nginx` |
| Servizio non parte | env invalido | `journalctl -u gestimus -n 50`; il boot rifiuta segreti placeholder in produzione |
| Sottodominio tenant → errore TLS | manca il cert wildcard | emetti il wildcard via DNS-01 (sopra) |
