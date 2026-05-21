#!/usr/bin/env bash
# apply-ente-plan.sh — Propaga il piano commerciale dal PB platform al PB del singolo tenant.
#
# Usage:
#   ./scripts/apply-ente-plan.sh <slug>          # singolo ente
#   ./scripts/apply-ente-plan.sh --all           # tutti gli enti con piano configurato
#
# Cosa fa:
#   1. Si autentica come super admin sulla piattaforma (8093 o PLATFORM_URL)
#   2. Per ogni ente target, chiama POST /api/admin/tenants/<id>/plan-for-apply
#      → ottiene piano + scadenza + limiti
#   3. Si autentica come admin sul PB del tenant
#   4. Fa upsert (create se assente, update altrimenti) della riga singleton
#      in `tenant_config` con i valori del piano
#   5. L'hook `pb_hooks/tenant_config.pb.js` sul tenant invaliderà la cache e
#      applicherà subito i nuovi limiti al prossimo create di concorsi/iscrizioni.
#
# Env richieste:
#   SUPERADMIN_PWD    password del super admin
#   ENTE_ADMIN_PWD    password admin del tenant (la stessa per tutti gli enti
#                     se uniformata, o esportala per singolo ente)
#   PLATFORM_URL      (default da deploy/gestimus.env)
#   SUPERADMIN_EMAIL  (default da deploy/gestimus.env)

set -euo pipefail

# Carica deploy/gestimus.env se presente.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ENV="${DEPLOY_ENV:-${SCRIPT_DIR}/../deploy/gestimus.env}"
if [ -f "$DEPLOY_ENV" ]; then
    # shellcheck source=/dev/null
    source "$DEPLOY_ENV"
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    echo "Usage: $0 <slug> | --all"
    exit 1
fi

: "${PLATFORM_URL:=http://127.0.0.1:8093}"
: "${SUPERADMIN_EMAIL:?SUPERADMIN_EMAIL non impostata (gestimus.env o env)}"
: "${SUPERADMIN_PWD:?SUPERADMIN_PWD richiesta in env}"
: "${ENTE_ADMIN_PWD:?ENTE_ADMIN_PWD richiesta in env (password admin del PB tenant)}"

if ! command -v jq >/dev/null 2>&1; then
    echo "✗ jq non installato. brew install jq (mac) o apt install jq (linux)"
    exit 1
fi

# 1. Login super admin
echo "→ Login super admin su $PLATFORM_URL..."
SA_TOKEN=$(curl -sf -X POST "$PLATFORM_URL/api/collections/accounts/auth-with-password" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$SUPERADMIN_EMAIL\",\"password\":\"$SUPERADMIN_PWD\"}" \
    | jq -r .token)
[ -n "$SA_TOKEN" ] && [ "$SA_TOKEN" != "null" ] || { echo "✗ Login super admin fallito"; exit 1; }
echo "  ✓ token super admin"

# 2. Recupera enti
if [ "$TARGET" = "--all" ]; then
    FILTER='filter=piano!=""'
    echo "→ Recupero tutti gli enti con piano configurato..."
else
    FILTER="filter=slug=%22${TARGET}%22"
    echo "→ Recupero ente con slug '$TARGET'..."
fi
ENTI_RESP=$(curl -sf -H "Authorization: Bearer $SA_TOKEN" "$PLATFORM_URL/api/collections/tenants/records?perPage=500&${FILTER}")
COUNT=$(echo "$ENTI_RESP" | jq '.items | length')
if [ "$COUNT" = "0" ]; then
    echo "✗ Nessun ente trovato${TARGET:+ per '$TARGET'}"
    exit 1
fi
echo "  ✓ $COUNT ent$([ "$COUNT" = "1" ] && echo 'e' || echo 'i') trovat$([ "$COUNT" = "1" ] && echo 'o' || echo 'i')"

OK=0; KO=0
for i in $(seq 0 $((COUNT - 1))); do
    SLUG=$(echo "$ENTI_RESP" | jq -r ".items[$i].slug")
    ID=$(echo "$ENTI_RESP" | jq -r ".items[$i].id")
    PORTA=$(echo "$ENTI_RESP" | jq -r ".items[$i].porta_pb")
    EMAIL_ADMIN=$(echo "$ENTI_RESP" | jq -r ".items[$i].email_admin")
    ENTE_URL="${ENTI_BASE_URL:-http://127.0.0.1:$PORTA}"

    echo ""
    echo "  → $SLUG ($ENTE_URL)..."

    # 3. Ottieni la config piano dal platform
    PLAN_RESP=$(curl -fsS -X POST "${PLATFORM_URL}/api/admin/tenants/$ID/plan-for-apply" \
        -H "Authorization: Bearer $SA_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{}' 2>/dev/null || true)
    PIANO=$(echo "$PLAN_RESP" | jq -r '.piano // ""')
    if [ -z "$PIANO" ] || [ "$PIANO" = "null" ]; then
        echo "    ✗ Piano non configurato per $SLUG, salto"
        KO=$((KO + 1))
        continue
    fi

    # 4. Login admin dell'ente
    ADMIN_TOKEN=$(curl -sf -X POST "$ENTE_URL/api/collections/accounts/auth-with-password" \
        -H 'Content-Type: application/json' \
        -d "{\"identity\":\"$EMAIL_ADMIN\",\"password\":\"$ENTE_ADMIN_PWD\"}" \
        2>/dev/null | jq -r .token 2>/dev/null || echo "")
    if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
        echo "    ✗ Login admin $EMAIL_ADMIN fallito (controlla ENTE_ADMIN_PWD)"
        KO=$((KO + 1))
        continue
    fi

    # 5. Costruisci body tenant_config
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    CFG_BODY=$(echo "$PLAN_RESP" | jq --arg now "$NOW" '{
        piano: .piano,
        piano_inizio: .piano_inizio,
        piano_scadenza: .piano_scadenza,
        limit_concorsi: .limit_concorsi,
        limit_iscritti_annui: .limit_iscritti_annui,
        ppe_setup_per_concorso: .ppe_setup_per_concorso,
        ppe_per_iscritto: .ppe_per_iscritto,
        grace_giorni: (.grace_giorni // 0),
        applied_at: $now
    }')

    # 6. Upsert: trova il record esistente, altrimenti create
    EXISTING=$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" \
        "$ENTE_URL/api/collections/tenant_config/records?perPage=1" 2>/dev/null || echo '{"items":[]}')
    EXISTING_ID=$(echo "$EXISTING" | jq -r '.items[0].id // ""')

    if [ -n "$EXISTING_ID" ]; then
        if curl -sf -X PATCH "$ENTE_URL/api/collections/tenant_config/records/$EXISTING_ID" \
                -H "Authorization: Bearer $ADMIN_TOKEN" \
                -H 'Content-Type: application/json' \
                -d "$CFG_BODY" >/dev/null; then
            echo "    ✓ Piano $PIANO applicato a $SLUG (update)"
            OK=$((OK + 1))
        else
            echo "    ✗ PATCH tenant_config fallito su $SLUG"
            KO=$((KO + 1))
        fi
    else
        if curl -sf -X POST "$ENTE_URL/api/collections/tenant_config/records" \
                -H "Authorization: Bearer $ADMIN_TOKEN" \
                -H 'Content-Type: application/json' \
                -d "$CFG_BODY" >/dev/null; then
            echo "    ✓ Piano $PIANO applicato a $SLUG (create)"
            OK=$((OK + 1))
        else
            echo "    ✗ POST tenant_config fallito su $SLUG"
            KO=$((KO + 1))
        fi
    fi
done

echo ""
echo "========================================="
echo "  ✓ Propagazione piano: $OK OK · $KO KO · totale $COUNT"
echo "========================================="
