#!/usr/bin/env bash
# provision-tenant.sh — Crea un nuovo tenant PocketBase.
#
# Usage: ./scripts/provision-tenant.sh <tenant-slug> [port]
#
# Esempio: ./scripts/provision-tenant.sh conservatorio-milano 8091
#
# Lo script:
#   1. Crea la directory dati per il tenant
#   2. Scrive il file env con la porta
#   3. Abilita e avvia il servizio systemd pb@<slug>
#   4. Attende che PocketBase risponda su /api/health
#   5. Crea il primo account admin
#   6. Aggiunge il blocco Caddy per il sottodominio
#   7. Ricarica Caddy
#
# Prerequisiti:
#   - PocketBase binary in /srv/pb/pocketbase
#   - Migrations in /srv/pb/pb_migrations
#   - Caddy installato e configurato
#   - systemd template pb@.service installato
#   - Node.js >= 18 (per lo script create-admin.js)

set -euo pipefail

SLUG="${1:?Usage: $0 <tenant-slug> [port]}"
PORT="${2:-}"

# Carica la configurazione di deploy se presente (default: dominio gestimus.it).
# Permette di sovrascrivere DOMAIN_BASE, WWW_DIR, ecc. da un file centrale.
PROVISION_SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
DEPLOY_ENV="${DEPLOY_ENV:-${PROVISION_SCRIPT_DIR}/../deploy/gestimus.env}"
if [ -f "$DEPLOY_ENV" ]; then
    # shellcheck source=/dev/null
    source "$DEPLOY_ENV"
fi

# Default se gestimus.env non è disponibile (es. checkout parziale).
PB_BIN="${PB_BIN:-/srv/pb/pocketbase}"
DATA_DIR="${PB_DATA_ROOT:-/srv/pb/data}/${SLUG}"
MIGRATIONS="${PB_MIGRATIONS:-/srv/pb/pb_migrations}"
HOOKS="${PB_HOOKS:-/srv/pb/pb_hooks}"
ENV_FILE="${ENV_DIR:-/etc/pb}/${SLUG}.env"
CADDY_DIR="/etc/caddy/tenants"
WWW_DIR="${WWW_DIR:-/var/www/gestimus}"
DOMAIN_BASE="${DOMAIN_BASE:-gestimus.it}"
# Sottodominio del tenant. Eccezione: lo slug "platform" usa platform.<base>
# (per il super admin), gli altri usano <slug>.<base>.
if [ "$SLUG" = "platform" ]; then
    DOMAIN="${PLATFORM_DOMAIN:-platform.${DOMAIN_BASE}}"
else
    DOMAIN="${SLUG}.${DOMAIN_BASE}"
fi

# Porta automatica: trova la prima porta libera a partire da 8091,
# evitando sia porte in ascolto sia porte già assegnate ad altri tenant.
if [ -z "$PORT" ]; then
    # Raccogli le porte già assegnate dai file env esistenti.
    ASSIGNED_PORTS=""
    for ENV in /etc/pb/*.env; do
        [ -f "$ENV" ] || continue
        P=$(grep '^PORT=' "$ENV" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
        [ -n "$P" ] && ASSIGNED_PORTS="${ASSIGNED_PORTS} ${P}"
    done

    PORT=8091
    while ss -tlnp 2>/dev/null | grep -q ":${PORT} " \
       || echo " ${ASSIGNED_PORTS} " | grep -q " ${PORT} "; do
        PORT=$((PORT + 1))
        if [ "$PORT" -gt 9999 ]; then
            echo "✗ Non riesco a trovare una porta libera nel range 8091-9999"
            exit 1
        fi
    done
fi

echo "========================================="
echo "  Provisioning tenant: ${SLUG}"
echo "  Port: ${PORT}"
echo "  Domain: ${DOMAIN}"
echo "========================================="

# 1. Crea directory dati
echo "→ Creo directory dati: ${DATA_DIR}"
mkdir -p "${DATA_DIR}"
chown pb:pb "${DATA_DIR}"

# 2. Scrivi env file
echo "→ Scrivo env file: ${ENV_FILE}"
cat > "${ENV_FILE}" <<EOF
PORT=${PORT}
EOF

# 3. Abilita e avvia il servizio
echo "→ Abilito e avvio pb@${SLUG}..."
systemctl enable "pb@${SLUG}"
systemctl restart "pb@${SLUG}"

# 4. Attendi che PB sia healthy
echo "→ Attendo che PocketBase risponda su porta ${PORT}..."
for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
        echo "  ✓ PocketBase healthy (${i}s)"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "✗ PocketBase non risponde dopo 30s. Controlla: systemctl status pb@${SLUG}"
        exit 1
    fi
    sleep 1
done

# 5. Crea il primo admin
echo ""
echo "--- Creazione account admin ---"
read -rp "Email admin per ${SLUG}: " ADMIN_EMAIL
read -rsp "Password: " ADMIN_PASSWORD; echo

if [ -f "${WWW_DIR}/scripts/create-admin.js" ]; then
    PB_URL="http://127.0.0.1:${PORT}" node "${WWW_DIR}/scripts/create-admin.js" "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" 2>/dev/null
elif command -v node >/dev/null 2>&1 && [ -f "${WWW_DIR}/../scripts/create-admin.js" ]; then
    PB_URL="http://127.0.0.1:${PORT}" node "${WWW_DIR}/../scripts/create-admin.js" "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" 2>/dev/null
else
    echo "  → Creazione admin via PocketBase CLI..."
    "${PB_BIN}" --dir="${DATA_DIR}" admin create "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" 2>/dev/null || {
        echo "  ⚠ Non sono riuscito a creare l'admin automaticamente."
        echo "    Crea l'admin manualmente dalla UI: http://127.0.0.1:${PORT}/_/"
    }
fi

# 6. Reverse-proxy: preferisci nginx (se installato), altrimenti fallback Caddy
#
# Sicurezza: la admin UI di PocketBase (/_/*) viene esposta SOLO a localhost di default.
# Per consentire l'accesso da remoto, esportare ADMIN_ALLOW_IPS prima dello script:
#   ADMIN_ALLOW_IPS="1.2.3.4,5.6.7.0/24" ./scripts/provision-tenant.sh <slug>
# (Caddy: usare un blocco con `remote_ip` o VPN. Per nginx il template viene patchato qui sotto.)
NGINX_TEMPLATE="$(dirname "$(readlink -f "$0")")/../deploy/nginx-tenant.conf.template"
if command -v nginx >/dev/null 2>&1 && [ -f "$NGINX_TEMPLATE" ]; then
    echo ""
    echo "→ Genero config nginx per ${DOMAIN}..."
    # Estraggo il dominio root per il path del cert wildcard.
    # Per dominio "ente1.tuodominio.it" → root = "tuodominio.it".
    DOMAIN_ROOT=$(echo "$DOMAIN" | awk -F. '{ if (NF > 2) print $(NF-1)"."$NF; else print $0 }')
    NGINX_CONF="/etc/nginx/sites-available/${SLUG}.conf"
    NGINX_LINK="/etc/nginx/sites-enabled/${SLUG}.conf"

    # Costruisci le righe `allow` per la admin UI partendo da ADMIN_ALLOW_IPS (CSV).
    ADMIN_ALLOW_BLOCK=""
    if [ -n "${ADMIN_ALLOW_IPS:-}" ]; then
        IFS=',' read -ra IPS <<< "${ADMIN_ALLOW_IPS}"
        for ip in "${IPS[@]}"; do
            ip_trim=$(echo "$ip" | xargs)
            [ -n "$ip_trim" ] && ADMIN_ALLOW_BLOCK="${ADMIN_ALLOW_BLOCK}        allow ${ip_trim};"$'\n'
        done
    fi

    sed -e "s|__DOMAIN__|${DOMAIN}|g" \
        -e "s|__DOMAIN_ROOT__|${DOMAIN_ROOT}|g" \
        -e "s|__PORT__|${PORT}|g" \
        -e "s|__WWWDIR__|${WWW_DIR}|g" \
        "$NGINX_TEMPLATE" > "$NGINX_CONF"
    # Sostituisci il placeholder __ADMIN_ALLOW__ (può essere multiline).
    if [ -n "$ADMIN_ALLOW_BLOCK" ]; then
        # Awk gestisce meglio multiline rispetto a sed
        awk -v repl="$ADMIN_ALLOW_BLOCK" '{gsub(/__ADMIN_ALLOW__/, repl); print}' "$NGINX_CONF" > "${NGINX_CONF}.tmp" && mv "${NGINX_CONF}.tmp" "$NGINX_CONF"
    else
        sed -i 's|__ADMIN_ALLOW__||g' "$NGINX_CONF"
    fi

    ln -sf "$NGINX_CONF" "$NGINX_LINK"
    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        echo "  ✓ nginx ricaricato"
        if [ -n "${ADMIN_ALLOW_IPS:-}" ]; then
            echo "  ℹ admin UI /_/ accessibile da: localhost + ${ADMIN_ALLOW_IPS}"
        else
            echo "  ℹ admin UI /_/ accessibile SOLO da localhost (usa ssh tunnel o ADMIN_ALLOW_IPS)"
        fi
    else
        echo "  ⚠ Configurazione nginx non valida. Controlla con: nginx -t"
    fi
elif command -v caddy >/dev/null 2>&1; then
    echo ""
    echo "→ Aggiungo blocco Caddy per ${DOMAIN}..."
    mkdir -p "${CADDY_DIR}"
    # Default: /_/ accessibile solo da localhost. Per allowlist remota, modificare
    # il matcher @admin_ui_allowed nel snippet (pb_routes) del Caddyfile globale.
    cat > "${CADDY_DIR}/${SLUG}.conf" <<EOF
${DOMAIN} {
    tls { on_demand }
    root * ${WWW_DIR}
    import pb_routes localhost:${PORT}
    file_server
}
EOF
    if caddy validate --config /etc/caddy/Caddyfile 2>/dev/null; then
        systemctl reload caddy
        echo "  ✓ Caddy ricaricato"
    else
        echo "  ⚠ Configurazione Caddy non valida"
    fi
else
    echo "  ⚠ Né nginx né Caddy trovati. Configura manualmente il reverse-proxy."
fi

echo ""
echo "========================================="
echo "  ✓ Tenant ${SLUG} provisionato!"
echo ""
echo "  URL:     https://${DOMAIN}"
echo "  Admin:   https://${DOMAIN}/_/"
echo "  Health:  http://127.0.0.1:${PORT}/api/health"
echo "  Service: pb@${SLUG}"
echo "  Data:    ${DATA_DIR}"
echo "========================================="