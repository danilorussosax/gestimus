#!/usr/bin/env bash
# deploy-frontend.sh — Copia il frontend statico sul server di produzione.
#
# Usage: ./scripts/deploy-frontend.sh [user@host]
#
# Esempio: ./scripts/deploy-frontend.sh deploy@concorso.app
#
# Lo script usa rsync per sincronizzare i file, escludendo
# tutto ciò che non serve in produzione.

set -euo pipefail

TARGET="${1:?Usage: $0 <user@host>}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/gestimus}"

# Validazione: TARGET deve essere user@host (no path, no spazi, no ::, no /).
# rsync --delete è distruttivo: una destinazione sbagliata cancella file remoti.
if ! [[ "$TARGET" =~ ^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$ ]]; then
    echo "✗ TARGET non valido: deve essere 'user@host' (era: $TARGET)"
    exit 1
fi

echo "→ Deploy frontend su ${TARGET}:${REMOTE_DIR}..."
echo "  Premi INVIO per confermare (5s timeout), Ctrl-C per annullare..."
read -r -t 5 _ || true

rsync -avz --delete \
    --exclude='node_modules' \
    --exclude='.DS_Store' \
    --exclude='pb_data' \
    --exclude='pocketbase' \
    --exclude='backups' \
    --exclude='test-results' \
    --exclude='.claude' \
    --exclude='.git' \
    --exclude='*.md' \
    --exclude='package-lock.json' \
    --exclude='playwright.config.js' \
    --exclude='tests/' \
    --exclude='scripts/' \
    --exclude='deploy/' \
    --exclude='pb_migrations/' \
    --exclude='Schema_*.docx' \
    --exclude='screen.png' \
    --exclude='sfondo.png' \
    --exclude='.env*' \
    ./ "${TARGET}:${REMOTE_DIR}/"

echo "✓ Deploy completato."