#!/usr/bin/env bash
# backup-all-tenants.sh — Backup di tutti i tenant PocketBase usando restic.
#
# Usage: ./scripts/backup-all-tenants.sh
#
# Prerequisiti:
#   - restic installato e configurato (restic init già eseguito sul repo)
#   - Variabili d'ambiente RESTIC_REPOSITORY e RESTIC_PASSWORD_FILE
#     (o passare --repo e --password-file come argomenti)
#
# Lo script itera su tutti i tenant configurati in /etc/pb/*.env
# e fa un backup di ogni directory dati separatamente.

set -euo pipefail

PB_DATA_ROOT="/srv/pb/data"
KEEP_DAILY=7
KEEP_WEEKLY=4
KEEP_MONTHLY=12

echo "→ Backup multi-tenant con restic..."
echo "  Repository: ${RESTIC_REPOSITORY:-<da configurare>}"

# Verifica che restic sia disponibile
if ! command -v restic >/dev/null 2>&1; then
    echo "✗ restic non trovato. Installa con: apt install restic"
    exit 1
fi

# Trova tutti i tenant
for ENV in /etc/pb/*.env; do
    [ -f "$ENV" ] || continue
    SLUG=$(basename "${ENV}" .env)
    DATA_DIR="${PB_DATA_ROOT}/${SLUG}"

    if [ ! -d "${DATA_DIR}" ]; then
        echo "  ⚠ ${SLUG}: directory ${DATA_DIR} non trovata, skip"
        continue
    fi

    echo "→ Backup tenant: ${SLUG} (${DATA_DIR})"
    restic backup "${DATA_DIR}" --tag "${SLUG}" --tag "pb_data"

    # Pulizia vecchi snapshot per questo tenant
    restic forget --tag "${SLUG}" \
        --keep-daily "${KEEP_DAILY}" \
        --keep-weekly "${KEEP_WEEKLY}" \
        --keep-monthly "${KEEP_MONTHLY}" \
        --prune
done

echo "✓ Backup completato per tutti i tenant."
echo ""
echo "Per ripristinare un tenant:"
echo "  restic restore latest --tag <slug> --target /tmp/restore-<slug>"
echo "  cp -r /tmp/restore-<slug>/*. ${PB_DATA_ROOT}/<slug>/"