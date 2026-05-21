#!/usr/bin/env bash
# apply-ente-smtp.sh — Propaga la configurazione SMTP di UN ente specifico al
# suo PocketBase, leggendo i settings dal record `tenants` sulla piattaforma.
#
# Usage:
#   ./scripts/apply-ente-smtp.sh <slug>      # singolo ente
#   ./scripts/apply-ente-smtp.sh --all       # tutti gli enti con smtp_enabled
#
# Variabili d'ambiente richieste:
#   PLATFORM_URL      URL del PB piattaforma (es. http://127.0.0.1:8093)
#   SUPERADMIN_EMAIL  email super admin
#   SUPERADMIN_PWD    password super admin
#
# Variabili opzionali:
#   ENTE_ADMIN_PWD    password admin del singolo ente (default: admin123)
#   ENTI_BASE_URL     prefisso per gli URL degli enti (default: http://127.0.0.1:<porta>)

set -euo pipefail

TARGET="${1:?Usage: $0 <slug> | --all}"

# Carica deploy/gestimus.env per default su gestimus.it
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
DEPLOY_ENV="${DEPLOY_ENV:-${SCRIPT_DIR}/../deploy/gestimus.env}"
if [ -f "$DEPLOY_ENV" ]; then
    # shellcheck source=/dev/null
    source "$DEPLOY_ENV"
fi

PLATFORM_URL="${PLATFORM_URL:?Imposta PLATFORM_URL (es. https://platform.gestimus.it)}"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:?Imposta SUPERADMIN_EMAIL}"
SUPERADMIN_PWD="${SUPERADMIN_PWD:?Imposta SUPERADMIN_PWD}"
ENTE_ADMIN_PWD="${ENTE_ADMIN_PWD:-admin123}"

if ! command -v jq >/dev/null 2>&1; then
    echo "✗ jq non installato. brew install jq (mac) o apt install jq (linux)"
    exit 1
fi

# 1. Login super admin sulla piattaforma
echo "→ Login super admin su $PLATFORM_URL..."
SA_TOKEN=$(curl -sf -X POST "$PLATFORM_URL/api/collections/accounts/auth-with-password" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$SUPERADMIN_EMAIL\",\"password\":\"$SUPERADMIN_PWD\"}" \
    | jq -r .token)
[ -n "$SA_TOKEN" ] && [ "$SA_TOKEN" != "null" ] || { echo "✗ Login fallito"; exit 1; }
echo "  ✓ token super admin"

# 2. Recupera enti
if [ "$TARGET" = "--all" ]; then
    FILTER='filter=smtp_enabled=true'
    echo "→ Recupero TUTTI gli enti con SMTP abilitato..."
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

# 3. Per ogni ente, applica SMTP al suo PB via admin API
OK=0; KO=0
for i in $(seq 0 $((COUNT - 1))); do
    SLUG=$(echo "$ENTI_RESP" | jq -r ".items[$i].slug")
    ID=$(echo "$ENTI_RESP" | jq -r ".items[$i].id")
    PORTA=$(echo "$ENTI_RESP" | jq -r ".items[$i].porta_pb")
    EMAIL_ADMIN=$(echo "$ENTI_RESP" | jq -r ".items[$i].email_admin")
    ENABLED=$(echo "$ENTI_RESP" | jq -r ".items[$i].smtp_enabled")
    HOST=$(echo "$ENTI_RESP" | jq -r ".items[$i].smtp_host // \"\"")
    PORT=$(echo "$ENTI_RESP" | jq -r ".items[$i].smtp_port // 587")
    USERNAME=$(echo "$ENTI_RESP" | jq -r ".items[$i].smtp_username // \"\"")
    # Password cifrata at-rest in DB; chiama endpoint decrypt (richiede superadmin auth).
    RAW_PASSWORD=$(echo "$ENTI_RESP" | jq -r ".items[$i].smtp_password // \"\"")
    if [[ "$RAW_PASSWORD" == enc:v1:* ]]; then
        DEC_RESP=$(curl -fsS -X POST "${PLATFORM_URL}/api/admin/tenants/$ID/smtp-decrypt" \
            -H "Authorization: Bearer $SA_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{}' 2>/dev/null || true)
        PASSWORD=$(echo "$DEC_RESP" | jq -r '.smtp_password // ""')
        if [ -z "$PASSWORD" ]; then
            echo "    ✗ Decrypt SMTP password fallito per $SLUG (chiave GESTIMUS_SECRET_KEY mancante sul PB platform?)"
            KO=$((KO + 1))
            continue
        fi
    else
        PASSWORD="$RAW_PASSWORD"
    fi
    TLS=$(echo "$ENTI_RESP" | jq -r ".items[$i].smtp_tls // \"starttls\"")
    SENDER_ADDR=$(echo "$ENTI_RESP" | jq -r ".items[$i].sender_address // \"\"")
    SENDER_NAME=$(echo "$ENTI_RESP" | jq -r ".items[$i].sender_name // \"\"")
    ENTE_URL="${ENTI_BASE_URL:-http://127.0.0.1:$PORTA}"

    echo ""
    echo "  → $SLUG ($ENTE_URL)..."
    if [ "$ENABLED" != "true" ]; then
        echo "    ⚠ SMTP non abilitato per $SLUG, salto"
        continue
    fi
    if [ -z "$HOST" ] || [ -z "$SENDER_ADDR" ]; then
        echo "    ✗ Configurazione SMTP incompleta (host o mittente vuoti)"
        KO=$((KO + 1))
        continue
    fi

    # Mappa cifratura su flag PocketBase
    case "$TLS" in
        tls)      TLS_FLAG=true  ;;
        starttls) TLS_FLAG=false ;;
        *)        TLS_FLAG=false ;;
    esac

    # Login admin dell'ente
    ADMIN_TOKEN=$(curl -sf -X POST "$ENTE_URL/api/collections/accounts/auth-with-password" \
        -H 'Content-Type: application/json' \
        -d "{\"identity\":\"$EMAIL_ADMIN\",\"password\":\"$ENTE_ADMIN_PWD\"}" \
        2>/dev/null | jq -r .token 2>/dev/null || echo "")
    if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
        echo "    ✗ Login admin $EMAIL_ADMIN fallito (controlla ENTE_ADMIN_PWD)"
        KO=$((KO + 1))
        RESULT_MSG="login admin fallito"
    else
        # Costruisci body settings PB
        SETTINGS_BODY=$(jq -n \
            --arg host "$HOST" --argjson port "$PORT" \
            --arg user "$USERNAME" --arg pass "$PASSWORD" \
            --argjson tls $TLS_FLAG \
            --arg from "$SENDER_ADDR" --arg fromName "$SENDER_NAME" \
            '{ meta: { senderAddress: $from, senderName: $fromName },
               smtp: { enabled: true, host: $host, port: $port, username: $user, password: $pass, tls: $tls, authMethod: "PLAIN" } }')

        if curl -sf -X PATCH "$ENTE_URL/api/settings" \
                -H "Authorization: Bearer $ADMIN_TOKEN" \
                -H 'Content-Type: application/json' \
                -d "$SETTINGS_BODY" >/dev/null; then
            echo "    ✓ SMTP applicato a $SLUG ($HOST:$PORT, from $SENDER_ADDR)"
            OK=$((OK + 1))
            RESULT_MSG="OK"
        else
            echo "    ✗ PATCH settings fallito su $SLUG"
            KO=$((KO + 1))
            RESULT_MSG="PATCH /api/settings fallito"
        fi
    fi

    # Aggiorna last_propagated_at sulla piattaforma per questo ente
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    curl -sf -X PATCH "$PLATFORM_URL/api/collections/tenants/records/$ID" \
        -H "Authorization: Bearer $SA_TOKEN" \
        -H 'Content-Type: application/json' \
        -d "{\"smtp_last_propagated_at\":\"$NOW\",\"smtp_last_propagation_result\":\"$RESULT_MSG\"}" >/dev/null 2>&1 || true
done

echo ""
echo "========================================="
echo "  ✓ Propagazione SMTP: $OK OK · $KO KO · totale $COUNT"
echo "========================================="
