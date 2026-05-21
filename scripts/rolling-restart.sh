#!/usr/bin/env bash
# rolling-restart.sh — Rolling restart di tutti i tenant PocketBase.
#
# Usage: ./scripts/rolling-restart.sh
#
# Riavvia un tenant alla volta, verificando che torni healthy
# prima di passare al successivo. Utile dopo un aggiornamento
# del binario PocketBase.
#
# Prerequisiti: systemd con template pb@.service installato.

set -euo pipefail

HEALTH_TIMEOUT=30

echo "→ Rolling restart di tutti i tenant PocketBase..."
echo ""

for ENV in /etc/pb/*.env; do
    [ -f "$ENV" ] || continue
    SLUG=$(basename "${ENV}" .env)
    PORT=$(grep '^PORT=' "${ENV}" | cut -d= -f2 | tr -d '[:space:]')
    if [ -z "$PORT" ]; then
        echo "  ⚠ ${SLUG}: PORT non impostata in ${ENV}, salto"
        continue
    fi

    echo "→ Restarting pb@${SLUG} (port ${PORT})..."
    systemctl restart "pb@${SLUG}"

    # Wait for healthy
    for i in $(seq 1 "${HEALTH_TIMEOUT}"); do
        if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
            echo "  ✓ Healthy (${i}s)"
            break
        fi
        if [ "$i" -eq "${HEALTH_TIMEOUT}" ]; then
            echo "  ✗ Non healthy dopo ${HEALTH_TIMEOUT}s — verifica manualmente"
            echo "    systemctl status pb@${SLUG}"
            echo "    curl http://127.0.0.1:${PORT}/api/health"
            # Non uscire: continua con gli altri tenant
        fi
        sleep 1
    done
done

echo ""
echo "✓ Rolling restart completato."