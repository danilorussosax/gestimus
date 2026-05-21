#!/usr/bin/env bash
# start-local-multitenant.sh — Avvia un ambiente multitenant locale per sviluppo.
#
# Crea 2 tenant (ente1, ente2) con:
#   - Database separati in pocketbase/pb_data_ente1/ e pocketbase/pb_data_ente2/
#   -PocketBase su porte 8091 e 8092
#   - Caddy su porta 8000 come reverse proxy
#   - http://ente1.test:8000/ → PB ente1 (porta 8091)
#   - http://ente2.test:8000/ → PB ente2 (porta 8092)
#
# Prerequisiti: Caddy installato (`brew install caddy`)
#
# Uso:
#   ./scripts/start-local-multitenant.sh          # avvia tutto
#   ./scripts/start-local-multitenant.sh stop      # ferma tutto
#
# Dopo l'avvio, accedi a:
#   http://ente1.test:8000/     → App tenant 1
#   http://ente2.test:8000/     → App tenant 2
#   http://ente1.test:8000/_/   → Admin UI tenant 1
#   http://ente2.test:8000/_/   → Admin UI tenant 2

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PB_BIN="${PROJECT_DIR}/pocketbase/pocketbase"
PB_MIGRATIONS="${PROJECT_DIR}/pb_migrations"
PID_DIR="/tmp/gestionale-multitenant"

ENTE1_PORT=8091
ENTE2_PORT=8092
PLATFORM_PORT=8093
CADDY_PORT=8000

# DNS locales — aggiungo a /etc/hosts se non presenti
add_host_entry() {
  local host="$1"
  if ! grep -q "$host" /etc/hosts 2>/dev/null; then
    echo "→ Aggiungo $host a /etc/hosts (richiede sudo)..."
    echo "127.0.0.1 $host" | sudo tee -a /etc/hosts > /dev/null
  fi
}

stop_all() {
  echo "→ Fermando tutti i processi..."
  # 1. Stop via file PID (path "happy")
  for NAME in pb-ente1 pb-ente2 pb-platform caddy; do
    if [ -f "${PID_DIR}/${NAME}.pid" ]; then
      kill "$(cat "${PID_DIR}/${NAME}.pid")" 2>/dev/null || true
      rm -f "${PID_DIR}/${NAME}.pid"
    fi
  done
  # 2. Fallback: trova eventuali PB orfani lanciati da questo progetto (file PID
  #    persi/cancellati). Match sul flag --dir che contiene il path locale.
  ORPHANS=$(pgrep -f "${PROJECT_DIR}/pocketbase/pocketbase serve" 2>/dev/null || true)
  if [ -n "$ORPHANS" ]; then
    echo "  ⚠ Trovati PB orfani: $ORPHANS — termino..."
    echo "$ORPHANS" | xargs kill 2>/dev/null || true
    sleep 1
    # Se restano, SIGKILL come ultima risorsa
    STILL=$(pgrep -f "${PROJECT_DIR}/pocketbase/pocketbase serve" 2>/dev/null || true)
    [ -n "$STILL" ] && echo "$STILL" | xargs kill -9 2>/dev/null || true
  fi
  # 3. Caddy orfano (matcha il Caddyfile generato in PID_DIR)
  CADDY_ORPHANS=$(pgrep -f "caddy run --config ${PID_DIR}/Caddyfile" 2>/dev/null || true)
  if [ -n "$CADDY_ORPHANS" ]; then
    echo "$CADDY_ORPHANS" | xargs kill 2>/dev/null || true
  fi
  echo "✓ Tutti i processi fermati."
  exit 0
}

if [ "${1:-}" = "stop" ]; then
  stop_all
fi

mkdir -p "${PID_DIR}" \
  "${PROJECT_DIR}/pocketbase/pb_data_ente1" \
  "${PROJECT_DIR}/pocketbase/pb_data_ente2" \
  "${PROJECT_DIR}/pocketbase/pb_data_platform"

# Shared secret di SVILUPPO (non usare in produzione). Esportata a tutti i PB locali:
#   - cifratura SMTP password (pb_hooks/tenants.pb.js)
#   - auto-propagazione piano via $http.send (pb_hooks/tenants.pb.js → tenant_config.pb.js)
#   - validazione endpoint /api/admin/apply-plan (pb_hooks/tenant_config.pb.js)
# In produzione la chiave viene generata da setup-server.sh e scritta in /etc/pb/platform.env
# e replicata su /etc/pb/<slug>.env dai provision-tenant.sh.
export GESTIMUS_SECRET_KEY="${GESTIMUS_SECRET_KEY:-dev-multitenant-shared-key-32!!1}"

echo "========================================="
echo "  Gestionale Concorso — Multitenant Locale"
echo "========================================="
echo ""

# 1. Aggiungo host entries
add_host_entry "ente1.test"
add_host_entry "ente2.test"
add_host_entry "platform.test"

# 2. Verifico che le porte siano libere.
# Usiamo -sTCP:LISTEN per ignorare connessioni residue (CLOSE_WAIT, TIME_WAIT) di client.
for PORT in $ENTE1_PORT $ENTE2_PORT $PLATFORM_PORT $CADDY_PORT; do
  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ Porta ${PORT} già in ascolto da un altro processo. Liberala prima di continuare."
    echo "  Esegui: lsof -nP -iTCP:${PORT} -sTCP:LISTEN per vederlo."
    exit 1
  fi
done

# 3. Avvia PocketBase per ente1
echo "→ Avvio PocketBase ente1 su porta ${ENTE1_PORT}..."
"${PB_BIN}" serve \
  --http="127.0.0.1:${ENTE1_PORT}" \
  --dir="${PROJECT_DIR}/pocketbase/pb_data_ente1" \
  --migrationsDir="${PB_MIGRATIONS}" \
  --hooksDir="${PROJECT_DIR}/pb_hooks" \
  &>/tmp/pb-ente1.log &
echo $! > "${PID_DIR}/pb-ente1.pid"

# 4. Avvia PocketBase per ente2
echo "→ Avvio PocketBase ente2 su porta ${ENTE2_PORT}..."
"${PB_BIN}" serve \
  --http="127.0.0.1:${ENTE2_PORT}" \
  --dir="${PROJECT_DIR}/pocketbase/pb_data_ente2" \
  --migrationsDir="${PB_MIGRATIONS}" \
  --hooksDir="${PROJECT_DIR}/pb_hooks" \
  &>/tmp/pb-ente2.log &
echo $! > "${PID_DIR}/pb-ente2.pid"

# 4b. Avvia PocketBase per la piattaforma
echo "→ Avvio PocketBase platform su porta ${PLATFORM_PORT}..."
"${PB_BIN}" serve \
  --http="127.0.0.1:${PLATFORM_PORT}" \
  --dir="${PROJECT_DIR}/pocketbase/pb_data_platform" \
  --migrationsDir="${PB_MIGRATIONS}" \
  --hooksDir="${PROJECT_DIR}/pb_hooks" \
  &>/tmp/pb-platform.log &
echo $! > "${PID_DIR}/pb-platform.pid"

# 5. Attendi che PB sia healthy
echo "→ Attesa che PocketBase risponda..."
for PORT in $ENTE1_PORT $ENTE2_PORT $PLATFORM_PORT; do
  for i in $(seq 1 15); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      echo "  ✓ PB porta ${PORT} healthy"
      break
    fi
    sleep 1
  done
done

# 6. Crea il Caddyfile per locale
CADDYFILE="${PID_DIR}/Caddyfile"
cat > "${CADDYFILE}" <<EOF
:8000 {
    root * ${PROJECT_DIR}

    @ente1 host ente1.test
    @ente2 host ente2.test
    @platform host platform.test

    handle @ente1 {
        @api path /api/* /_/*
        reverse_proxy @api localhost:${ENTE1_PORT}
        file_server
    }

    handle @ente2 {
        @api path /api/* /_/*
        reverse_proxy @api localhost:${ENTE2_PORT}
        file_server
    }

    handle @platform {
        @api path /api/* /_/*
        reverse_proxy @api localhost:${PLATFORM_PORT}
        file_server
    }

    handle {
        @api path /api/* /_/*
        reverse_proxy @api localhost:8090
        file_server
    }
}
EOF

# 7. Avvia Caddy
echo "→ Avvio Caddy su porta ${CADDY_PORT}..."
caddy run --config "${CADDYFILE}" &>/tmp/caddy-multitenant.log &
echo $! > "${PID_DIR}/caddy.pid"
sleep 2

# 8. Crea admin per tutti i tenant (se non esistono già)
echo ""
echo "→ Creazione account admin..."
for TENANT in ente1 ente2 platform; do
  if [ "$TENANT" = "platform" ]; then
    PORT="${PLATFORM_PORT}"
    ROLE="superadmin"
  else
    PORT="${ENTE1_PORT}"
    [ "$TENANT" = "ente2" ] && PORT="${ENTE2_PORT}"
    ROLE="admin"
  fi

  ADMIN_COUNT=$(curl -sf "http://127.0.0.1:${PORT}/api/collections/accounts/records?perPage=1&filter=role%3D%22${ROLE}%22" 2>/dev/null \
    | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('totalItems',0))
except Exception: print(0)" 2>/dev/null || echo "0")

  if [ "$ADMIN_COUNT" = "0" ] 2>/dev/null; then
    if [ "$TENANT" = "platform" ]; then
      # Crea superadmin via API (create-admin.js usa role=admin)
      curl -sf "http://127.0.0.1:${PORT}/api/collections/accounts/records" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"superadmin@platform.test\",\"password\":\"admin123\",\"passwordConfirm\":\"admin123\",\"role\":\"superadmin\",\"nome\":\"Super\",\"cognome\":\"Admin\",\"attivo\":true,\"emailVisibility\":true}" >/dev/null 2>&1 && \
        echo "  ✓ Superadmin creato: superadmin@platform.test / admin123" || \
        echo "  ⚠ Superadmin per platform — crealo manualmente su http://platform.test:8000/_/"
    else
      PB_URL="http://127.0.0.1:${PORT}" node "${PROJECT_DIR}/scripts/create-admin.js" "admin@${TENANT}.test" "admin123" "Admin" "${TENANT}" 2>/dev/null && \
        echo "  ✓ Admin creato: admin@${TENANT}.test / admin123" || \
        echo "  ⚠ Admin per ${TENANT} — crealo manualmente"
    fi
  else
    echo "  ✓ ${TENANT}: admin già esistente"
  fi
done

echo ""
echo "========================================="
echo "  ✓ Ambiente multitenant locale pronto!"
echo ""
echo "  Tenant 1: http://ente1.test:8000/"
echo "            Admin UI: http://ente1.test:8000/_/"
echo "            Email: admin@ente1.test"
echo "            Password: admin123"
echo ""
echo "  Tenant 2: http://ente2.test:8000/"
echo "            Admin UI: http://ente2.test:8000/_/"
echo "            Email: admin@ente2.test"
echo "            Password: admin123"
echo ""
echo "  Piattaforma: http://platform.test:8000/"
echo "               Admin UI: http://platform.test:8000/_/"
echo "               Email: superadmin@platform.test"
echo "               Password: admin123"
echo ""
echo "  Per fermare: ./scripts/start-local-multitenant.sh stop"
echo "========================================="