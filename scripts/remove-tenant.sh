#!/usr/bin/env bash
# remove-tenant.sh — Rimuove COMPLETAMENTE un tenant.
# Funziona sia in LOCALE (macOS/Linux dev, nohup + pocketbase/pb_data_<slug>)
# sia in PRODUZIONE (systemd + /srv/pb/data/<slug>).
#
# Cosa fa:
#   1. Ferma il processo PocketBase del tenant
#   2. Rimuove la configurazione del reverse-proxy (Caddy / nginx)
#   3. Archivia o cancella i dati su disco
#   4. Suggerisce il comando per cancellare il record da `tenants` su platform
#
# Usage:
#   ./scripts/remove-tenant.sh <slug>           # archivia i dati
#   ./scripts/remove-tenant.sh <slug> --purge   # cancella i dati definitivamente
#   ./scripts/remove-tenant.sh <slug> -y        # salta la conferma interattiva
#   ./scripts/remove-tenant.sh <slug> --purge -y
#
# Esempio:
#   ./scripts/remove-tenant.sh ente3
#   ./scripts/remove-tenant.sh ente3 --purge -y

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <slug> [--purge] [-y]"
    exit 1
fi

SLUG="$1"
shift || true
PURGE=false
YES=false
for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=true ;;
        -y|--yes) YES=true ;;
        *) echo "✗ Argomento sconosciuto: $arg"; exit 1 ;;
    esac
done

# ----- Path detection: locale vs produzione -----
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_DATA_DIR="${PROJECT_DIR}/pocketbase/pb_data_${SLUG}"
PROD_DATA_DIR="/srv/pb/data/${SLUG}"

if [ -d "$LOCAL_DATA_DIR" ]; then
    MODE="local"
    DATA_DIR="$LOCAL_DATA_DIR"
    ARCHIVE_DIR="${PROJECT_DIR}/pocketbase/_archive/${SLUG}-$(date +%Y%m%d_%H%M%S)"
elif [ -d "$PROD_DATA_DIR" ]; then
    MODE="prod"
    DATA_DIR="$PROD_DATA_DIR"
    ARCHIVE_DIR="/srv/pb/archive/${SLUG}-$(date +%Y%m%d_%H%M%S)"
else
    echo "✗ Nessuna directory dati trovata per '${SLUG}':"
    echo "    locale:    $LOCAL_DATA_DIR"
    echo "    produzione: $PROD_DATA_DIR"
    exit 1
fi

ENV_FILE="/etc/pb/${SLUG}.env"
CADDY_CONF="/etc/caddy/tenants/${SLUG}.conf"
NGINX_CONF="/etc/nginx/sites-available/${SLUG}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${SLUG}.conf"

echo "========================================="
echo "  Rimozione tenant: ${SLUG}"
echo "  Ambiente: ${MODE}"
echo "  Dati:     ${DATA_DIR}"
if [ "$PURGE" = "true" ]; then
    echo "  Azione:   PURGE (cancellazione definitiva dei dati)"
else
    echo "  Azione:   ARCHIVIO (sposta in ${ARCHIVE_DIR})"
fi
echo "========================================="

# ----- Conferma esplicita (skippabile con -y) -----
if [ "$YES" != "true" ]; then
    echo ""
    read -rp "Sei SICURO? Digita '${SLUG}' per confermare: " CONFIRM
    if [ "$CONFIRM" != "$SLUG" ]; then
        echo "✗ Annullato (input non corrisponde)."
        exit 1
    fi
fi

# ----- 1. Ferma il processo PocketBase -----
if [ "$MODE" = "local" ]; then
    echo "→ Cerco processi pocketbase per pb_data_${SLUG}..."
    # pgrep cerca processi con la directory dati nel comando.
    PIDS=$(pgrep -f "pb_data_${SLUG}" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "  Trovati PID: $PIDS"
        kill $PIDS 2>/dev/null || true
        sleep 1
        # Verifica + forza kill se ancora attivo
        STILL=$(pgrep -f "pb_data_${SLUG}" 2>/dev/null || true)
        if [ -n "$STILL" ]; then
            echo "  Processi ancora attivi, KILL -9..."
            kill -9 $STILL 2>/dev/null || true
        fi
        echo "  ✓ PocketBase di '${SLUG}' fermato"
    else
        echo "  ⚠ Nessun processo attivo per '${SLUG}'"
    fi
else
    if systemctl list-units --type=service 2>/dev/null | grep -q "pb@${SLUG}.service"; then
        echo "→ Fermo pb@${SLUG}..."
        systemctl stop "pb@${SLUG}" 2>/dev/null || echo "  ⚠ Servizio già fermo"
        systemctl disable "pb@${SLUG}" 2>/dev/null || true
        echo "  ✓ Servizio disabilitato"
    else
        echo "  ⚠ Unit pb@${SLUG}.service non presente"
    fi
fi

# ----- 2. Reverse-proxy config (Caddy / nginx) — solo in produzione -----
if [ "$MODE" = "prod" ]; then
    if [ -f "${CADDY_CONF}" ]; then
        echo "→ Rimuovo blocco Caddy: ${CADDY_CONF}"
        rm -f "${CADDY_CONF}"
        command -v caddy >/dev/null 2>&1 && systemctl reload caddy 2>/dev/null || true
    fi
    if [ -f "${NGINX_LINK}" ]; then
        echo "→ Rimuovo link nginx: ${NGINX_LINK}"
        rm -f "${NGINX_LINK}"
    fi
    if [ -f "${NGINX_CONF}" ]; then
        echo "→ Rimuovo conf nginx: ${NGINX_CONF}"
        rm -f "${NGINX_CONF}"
    fi
    if command -v nginx >/dev/null 2>&1 && nginx -t 2>/dev/null; then
        systemctl reload nginx 2>/dev/null || true
    fi
    if [ -f "${ENV_FILE}" ]; then
        echo "→ Rimuovo env file: ${ENV_FILE}"
        rm -f "${ENV_FILE}"
    fi
else
    echo "→ Locale: nessuna config reverse-proxy da rimuovere (la rotta del tenant resta nel Caddyfile dev; rimuovila a mano se necessario)"
fi

# ----- 3. Dati su disco: archivia o cancella -----
if [ -d "${DATA_DIR}" ]; then
    if [ "$PURGE" = "true" ]; then
        echo "→ PURGE: cancello ${DATA_DIR}..."
        rm -rf "${DATA_DIR}"
        echo "  ✓ Dati eliminati definitivamente"
    else
        echo "→ Archivio in ${ARCHIVE_DIR}..."
        mkdir -p "$(dirname "${ARCHIVE_DIR}")"
        mv "${DATA_DIR}" "${ARCHIVE_DIR}"
        echo "  ✓ Dati archiviati"
        echo "    Ripristino:        mv \"${ARCHIVE_DIR}\" \"${DATA_DIR}\""
        echo "    Cancella archivio: rm -rf \"${ARCHIVE_DIR}\""
    fi
else
    echo "  ⚠ Directory dati non trovata"
fi

# ----- 4. Suggerimento finale per pulire il registro -----
echo ""
echo "========================================="
echo "  ✓ Tenant '${SLUG}' rimosso ($MODE)"
echo ""
if [ "$MODE" = "local" ]; then
    echo "  Suggerimento:"
    echo "   - Se non l'hai già fatto, elimina anche il record da super admin"
    echo "     (Gestione Enti → riga '${SLUG}' → cestino)"
    echo "   - Per cancellare definitivamente l'archivio:"
    echo "     rm -rf ${ARCHIVE_DIR%-*}-*"
else
    echo "  Prossimo passo (dal super admin web UI):"
    echo "    Apri https://platform.<tuo-dominio>/_/  → Gestione Enti → elimina '${SLUG}'"
fi
echo "========================================="
