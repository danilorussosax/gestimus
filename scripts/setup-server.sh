#!/usr/bin/env bash
# setup-server.sh — Provisioning iniziale del VPS (es. IONOS, Hetzner, DigitalOcean).
# Esegui UNA SOLA VOLTA su un Ubuntu 22.04/24.04 vuoto, come root.
#
# Cosa installa:
#   - utente non-root 'gestimus' con sudo
#   - hardening base (ufw, fail2ban, ssh keys)
#   - nginx + certbot (Lets Encrypt)
#   - Node.js LTS (per gli script di seed/maintenance)
#   - PocketBase binario in /srv/pb/pocketbase
#   - systemd template pb@.service installato
#   - cartelle /srv/pb/{data,pb_migrations,pb_hooks,archive}
#   - jq + curl + sqlite3 (utility)
#
# Dopo questo script:
#   1. configura il DNS wildcard (vedi DEPLOY-IONOS.md)
#   2. ottieni il certificato wildcard
#   3. cloni il repo del progetto e provisioni il primo tenant

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "✗ Esegui questo script come root: sudo bash $0"
    exit 1
fi

# ----------------------- Variabili configurabili ----------------------------
# Carica deploy/gestimus.env se presente (dominio + path standard).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ENV="${DEPLOY_ENV:-${SCRIPT_DIR}/../deploy/gestimus.env}"
if [ -f "$DEPLOY_ENV" ]; then
    # shellcheck source=/dev/null
    source "$DEPLOY_ENV"
fi

DEPLOY_USER="${DEPLOY_USER:-gestimus}"
PB_VERSION="${PB_VERSION:-0.22.27}"
WWWDIR="${WWW_DIR:-/var/www/gestimus}"
DOMAIN_BASE="${DOMAIN_BASE:-gestimus.it}"
LE_EMAIL="${LE_EMAIL:-admin@${DOMAIN_BASE}}"
# ----------------------------------------------------------------------------

echo "========================================="
echo "  Gestimus — setup VPS"
echo "  Utente deploy: $DEPLOY_USER"
echo "  PocketBase v$PB_VERSION"
echo "  Email LE:      $LE_EMAIL"
echo "========================================="
sleep 1

# 1. Aggiornamento sistema
echo ""
echo "→ Aggiorno il sistema..."
apt-get update -y
apt-get upgrade -y

# 2. Pacchetti base
echo "→ Installo pacchetti base..."
apt-get install -y \
    nginx certbot python3-certbot-nginx python3-certbot-dns-ionos \
    ufw fail2ban \
    curl wget unzip jq sqlite3 \
    rsync git \
    build-essential

# 3. Node.js LTS (per gli script di seed/maintenance)
if ! command -v node >/dev/null 2>&1; then
    echo "→ Installo Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi

# 4. Utente non-root con sudo
if ! id "$DEPLOY_USER" &>/dev/null; then
    echo "→ Creo utente $DEPLOY_USER..."
    adduser --disabled-password --gecos '' "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
    # Copia chiavi SSH di root al nuovo utente (se presenti)
    if [ -f /root/.ssh/authorized_keys ]; then
        mkdir -p /home/$DEPLOY_USER/.ssh
        cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/
        chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
        chmod 700 /home/$DEPLOY_USER/.ssh
        chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
    fi
fi

# 5. Utente di sistema 'pb' per i processi PocketBase
if ! id "pb" &>/dev/null; then
    echo "→ Creo utente di sistema 'pb'..."
    useradd --system --no-create-home --shell /usr/sbin/nologin pb
fi

# 6. Firewall (ufw): SSH + HTTP + HTTPS
echo "→ Configuro firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# 7. Hardening SSH base (richiede chiave, no password)
if [ -f /etc/ssh/sshd_config ]; then
    echo "→ Hardening SSH..."
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
    systemctl reload sshd 2>/dev/null || systemctl reload ssh
fi

# 8. PocketBase
mkdir -p /srv/pb/{data,pb_migrations,pb_hooks,archive}
if [ ! -f /srv/pb/pocketbase ]; then
    echo "→ Scarico PocketBase v$PB_VERSION..."
    TMP=$(mktemp -d)
    wget -q -O $TMP/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
    unzip -q $TMP/pb.zip -d $TMP
    mv $TMP/pocketbase /srv/pb/pocketbase
    chmod +x /srv/pb/pocketbase
    rm -rf $TMP
fi
chown -R pb:pb /srv/pb

# 9. systemd template pb@.service — copiato dal repo se disponibile, altrimenti scritto inline
echo "→ Installo systemd template pb@.service..."
PROJECT_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_SRC="${PROJECT_SCRIPT_DIR}/../deploy/pb@.service"
if [ -f "$TEMPLATE_SRC" ]; then
    cp "$TEMPLATE_SRC" /etc/systemd/system/pb@.service
else
    # Fallback se lo script viene eseguito fuori dal repo (download standalone).
    UNIT_URL="https://raw.githubusercontent.com/your-org/gestimus/main/deploy/pb@.service"
    echo "  ⚠ Template locale non trovato in $TEMPLATE_SRC"
    echo "  → Scarica manualmente da $UNIT_URL in /etc/systemd/system/pb@.service"
fi
mkdir -p /etc/pb
systemctl daemon-reload

# 10. Cartelle frontend + nginx
mkdir -p "$WWWDIR"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d
# Disabilita default site
rm -f /etc/nginx/sites-enabled/default
# Installa snippet rate-limit (zone iscrizioni_rl, auth_rl) se non già presente.
RL_SNIPPET_SRC="${PROJECT_SCRIPT_DIR}/../deploy/nginx-snippet-rl.conf"
RL_SNIPPET_DST="/etc/nginx/conf.d/gestimus-rl.conf"
if [ -f "$RL_SNIPPET_SRC" ] && [ ! -f "$RL_SNIPPET_DST" ]; then
    echo "→ Installo snippet rate-limit nginx in $RL_SNIPPET_DST"
    cp "$RL_SNIPPET_SRC" "$RL_SNIPPET_DST"
fi
systemctl enable nginx

# 11. Certbot DNS-IONOS plugin: prepara directory credenziali (riempire poi a mano)
mkdir -p /etc/letsencrypt
if [ ! -f /etc/letsencrypt/ionos.ini ]; then
    cat > /etc/letsencrypt/ionos.ini <<EOF
# Credenziali API IONOS per certbot DNS-01.
# Genera la tua API key/secret da: https://developer.hosting.ionos.it/keys
# Poi sostituisci i placeholder e proteggi il file: chmod 600.
dns_ionos_prefix = REPLACE_ME_PREFIX
dns_ionos_secret = REPLACE_ME_SECRET
dns_ionos_endpoint = https://api.hosting.ionos.com
EOF
    chmod 600 /etc/letsencrypt/ionos.ini
fi

# 12. Chiave applicativa per cifratura SMTP password (pb_hooks/tenants.pb.js)
#     E shared-secret per auto-propagazione piano (pb_hooks/tenant_config.pb.js).
#     Generata UNA VOLTA; cambiarla rende illeggibili le SMTP password salvate prima.
SECRET_KEY_FILE="/etc/pb/platform.env"
if [ ! -f "$SECRET_KEY_FILE" ] || ! grep -q '^GESTIMUS_SECRET_KEY=' "$SECRET_KEY_FILE" 2>/dev/null; then
    SECRET_KEY=$(openssl rand -hex 32)
    echo "→ Genero GESTIMUS_SECRET_KEY e la scrivo in $SECRET_KEY_FILE"
    mkdir -p "$(dirname "$SECRET_KEY_FILE")"
    echo "GESTIMUS_SECRET_KEY=${SECRET_KEY}" >> "$SECRET_KEY_FILE"
    chmod 600 "$SECRET_KEY_FILE"
    chown pb:pb "$SECRET_KEY_FILE"
    echo "  ⚠ Backup la chiave in un password manager! Cambiarla rende"
    echo "    illeggibili le SMTP password cifrate at-rest."
fi

# 13. Replica la GESTIMUS_SECRET_KEY su tutti i tenant esistenti (idempotente).
#     Necessaria per l'auto-propagazione del piano dal platform via $http.send.
if [ -f "$SECRET_KEY_FILE" ]; then
    KEY_LINE=$(grep '^GESTIMUS_SECRET_KEY=' "$SECRET_KEY_FILE" || true)
    if [ -n "$KEY_LINE" ]; then
        for ENV in /etc/pb/*.env; do
            [ -f "$ENV" ] || continue
            [ "$(basename "$ENV")" = "platform.env" ] && continue
            if ! grep -q '^GESTIMUS_SECRET_KEY=' "$ENV"; then
                echo "$KEY_LINE" >> "$ENV"
                chmod 600 "$ENV"
                echo "  ✓ chiave replicata in $ENV"
                # Riavvia il tenant se attivo per far rileggere l'env
                SLUG=$(basename "$ENV" .env)
                systemctl restart "pb@${SLUG}" 2>/dev/null || true
            fi
        done
    fi
fi

echo ""
echo "========================================="
echo "  ✓ Setup VPS completato"
echo "========================================="
echo ""
echo "  Prossimi passi MANUALI:"
echo ""
echo "  1. Configura il DNS wildcard sul dominio ${DOMAIN_BASE}:"
echo "       *.${DOMAIN_BASE}    A    <IP-del-VPS>"
echo "       ${DOMAIN_BASE}      A    <IP-del-VPS>"
echo ""
echo "  2. Inserisci le credenziali API IONOS in:"
echo "       /etc/letsencrypt/ionos.ini"
echo "     (vedi sito IONOS → API → Genera chiave)"
echo ""
echo "  3. Ottieni certificato wildcard:"
echo "       certbot certonly --authenticator dns-ionos --dns-ionos-credentials /etc/letsencrypt/ionos.ini --dns-ionos-propagation-seconds 60 -d ${DOMAIN_BASE} -d *.${DOMAIN_BASE} --email ${LE_EMAIL} --agree-tos --no-eff-email"
echo ""
echo "  4. Clona il repo nel server:"
echo "       sudo -u $DEPLOY_USER git clone <repo-url> /home/$DEPLOY_USER/gestimus"
echo "       sudo cp /home/$DEPLOY_USER/gestimus/pb_migrations/* /srv/pb/pb_migrations/"
echo "       sudo cp /home/$DEPLOY_USER/gestimus/pb_hooks/* /srv/pb/pb_hooks/"
echo "       sudo chown -R pb:pb /srv/pb"
echo ""
echo "  5. Deploy frontend statico:"
echo "       sudo rsync -av --exclude=node_modules --exclude=.git /home/$DEPLOY_USER/gestimus/ $WWWDIR/"
echo ""
echo "  6. Provisiona il super admin (platform.${DOMAIN_BASE}):"
echo "       sudo /home/$DEPLOY_USER/gestimus/scripts/provision-tenant.sh platform"
echo ""
echo "  7. Provisiona il primo ente cliente (sara <slug>.${DOMAIN_BASE}):"
echo "       sudo /home/$DEPLOY_USER/gestimus/scripts/provision-tenant.sh ente1"
echo ""
echo "========================================="
