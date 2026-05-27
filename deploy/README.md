# deploy/

Artefatti di deploy per Gestimus.

| File | Scopo |
|------|-------|
| `install.sh` | **Provisioning all-in-one** per VPS IONOS (Ubuntu/Debian): Node 22, PostgreSQL 18, build, schema+RLS, super-admin, systemd, Nginx, TLS, backup, firewall. Idempotente. |
| `nginx-snippet-rl.conf` | Zone rate-limit Nginx di riferimento (l'`install.sh` le rigenera in `/etc/nginx/conf.d/gestimus-rl.conf`). |

## Quick start

Su una VPS Ubuntu/Debian vergine, come root:

```bash
git clone <REPO_URL> /opt/gestimus
cd /opt/gestimus
sudo GESTIMUS_DOMAIN=gestimus.it LE_EMAIL=tu@example.com ./deploy/install.sh
```

Oppure senza clone manuale (lo fa lo script):

```bash
sudo GESTIMUS_DOMAIN=gestimus.it LE_EMAIL=tu@example.com \
     REPO_URL=https://github.com/tuo/gestimus.git \
     APP_DIR=/opt/gestimus bash install.sh
```

A fine run stampa URL platform, email/password super-admin e i prossimi passi.

Runbook completo (DNS, TLS wildcard, aggiornamenti, backup/restore, troubleshooting): **[../docs/DEPLOY-IONOS.md](../docs/DEPLOY-IONOS.md)**.

## Variabili principali

| Var | Default | Note |
|-----|---------|------|
| `GESTIMUS_DOMAIN` | — (**obbligatoria**) | dominio base, es. `gestimus.it` |
| `LE_EMAIL` | — | email Let's Encrypt; se assente, TLS saltato |
| `APP_DIR` | `/opt/gestimus` | dove vive il codice |
| `APP_USER` | `gestimus` | utente di sistema del servizio |
| `REPO_URL` / `REPO_BRANCH` | — / `main` | clona se il codice non è già in `APP_DIR` |
| `GESTIMUS_ADMIN_EMAIL` | `admin@<dominio>` | super-admin iniziale |
| `GESTIMUS_ADMIN_PASSWORD` | auto-generata | password super-admin (stampata a fine run) |
| `TLS_MODE` | `http` | `http` = certbot http-01 su apex/platform/www · `skip` |
| `SETUP_FIREWALL` / `SETUP_BACKUP` | `1` / `1` | ufw · timer backup giornaliero |

Rilanciare lo script **aggiorna** (pull + rebuild + push schema + restart) senza rigenerare i segreti già in `server/.env`.
