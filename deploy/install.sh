#!/usr/bin/env bash
# =============================================================================
# Gestimus — provisioning all-in-one per VPS IONOS (Ubuntu/Debian)
# -----------------------------------------------------------------------------
# Installa e configura, su una macchina vergine, l'intero stack di produzione:
#   • Node.js 22 (NodeSource)
#   • PostgreSQL 18 (repo PGDG) + ruoli/db + schema + RLS + super-admin
#   • build di server (Fastify) e frontend (SPA React)
#   • servizio systemd (avvio automatico, restart, hardening)
#   • Nginx reverse-proxy (Host preservato per il routing multitenant) + TLS
#   • timer di backup giornaliero + firewall ufw
#
# USO (come root o con sudo):
#   sudo GESTIMUS_DOMAIN=gestimus.it LE_EMAIL=tu@example.com ./deploy/install.sh
#
# Va lanciato DA DENTRO il checkout del repo (deve vedere ../server e
# ../frontend), oppure imposta REPO_URL per farlo clonare in APP_DIR.
# È idempotente: rilanciarlo aggiorna build + schema e riavvia, SENZA
# rigenerare i segreti già presenti in server/.env.
#
# Variabili (env, con default):
#   GESTIMUS_DOMAIN     (OBBLIGATORIO) dominio base, es. gestimus.it
#   LE_EMAIL            email per Let's Encrypt (se assente: TLS saltato)
#   APP_DIR            /opt/gestimus       dove vive il codice in prod
#   APP_USER           gestimus            utente di sistema del servizio
#   REPO_URL           (vuoto)             se APP_DIR non ha il codice, clona da qui
#   REPO_BRANCH        main
#   GESTIMUS_ADMIN_EMAIL     admin@<dominio>   super-admin iniziale
#   GESTIMUS_ADMIN_PASSWORD  (auto-generata)   password super-admin iniziale
#   APP_PORT           4000
#   TLS_MODE           http  (http = certbot http-01 su apex+platform+www | skip)
#   SETUP_FIREWALL     1     (1 = configura ufw | 0 = salta)
#   SETUP_BACKUP       1     (1 = timer backup giornaliero | 0 = salta)
# =============================================================================
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
GESTIMUS_DOMAIN="${GESTIMUS_DOMAIN:-}"
LE_EMAIL="${LE_EMAIL:-}"
APP_DIR="${APP_DIR:-/opt/gestimus}"
APP_USER="${APP_USER:-gestimus}"
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_PORT="${APP_PORT:-4000}"
TLS_MODE="${TLS_MODE:-http}"
SETUP_FIREWALL="${SETUP_FIREWALL:-1}"
SETUP_BACKUP="${SETUP_BACKUP:-1}"
NODE_MAJOR=22
PG_MAJOR=18

# ── Output helpers ─────────────────────────────────────────────────────────--
c_blue='\033[1;34m'; c_green='\033[1;32m'; c_yellow='\033[1;33m'; c_red='\033[1;31m'; c_reset='\033[0m'
step() { echo -e "\n${c_blue}==> $*${c_reset}"; }
ok()   { echo -e "${c_green}  ✓ $*${c_reset}"; }
warn() { echo -e "${c_yellow}  ! $*${c_reset}"; }
die()  { echo -e "${c_red}✗ $*${c_reset}" >&2; exit 1; }
trap 'die "fallito alla riga $LINENO. Output sopra per il dettaglio."' ERR

# ── Preflight ─────────────────────────────────────────────────────────────────
step "Preflight"
[ "$(id -u)" -eq 0 ] || die "esegui come root o con sudo."
command -v apt-get >/dev/null 2>&1 || die "questo script richiede Debian/Ubuntu (apt)."
[ -n "$GESTIMUS_DOMAIN" ] || die "GESTIMUS_DOMAIN è obbligatorio (es. GESTIMUS_DOMAIN=gestimus.it)."
# shellcheck disable=SC1091
. /etc/os-release
[ -n "${VERSION_CODENAME:-}" ] || die "impossibile leggere VERSION_CODENAME da /etc/os-release."
GESTIMUS_ADMIN_EMAIL="${GESTIMUS_ADMIN_EMAIL:-admin@${GESTIMUS_DOMAIN}}"
export DEBIAN_FRONTEND=noninteractive
ok "OS: ${PRETTY_NAME:-$ID $VERSION_CODENAME} · dominio: ${GESTIMUS_DOMAIN} · app dir: ${APP_DIR}"

# Posizione del codice: usa il checkout corrente se valido, altrimenti clona.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── 1. Pacchetti base ──────────────────────────────────────────────────────--
step "Pacchetti base"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release git openssl ufw >/dev/null
ok "curl, git, gnupg, openssl, ufw"

# ── 2. Node.js 22 ───────────────────────────────────────────────────────────--
step "Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v) · npm $(npm -v)"

# ── 3. PostgreSQL 18 (PGDG) ─────────────────────────────────────────────────--
step "PostgreSQL ${PG_MAJOR}"
if ! command -v psql >/dev/null 2>&1; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq "postgresql-${PG_MAJOR}" >/dev/null
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
# Attendi che il cluster accetti connessioni.
for _ in $(seq 1 30); do sudo -u postgres pg_isready -q && break || sleep 1; done
ok "postgres pronto ($(sudo -u postgres psql -tAc 'show server_version' | tr -d '[:space:]'))"

# ── 4. Nginx + certbot ──────────────────────────────────────────────────────--
step "Nginx + certbot"
apt-get install -y -qq nginx >/dev/null
if [ "$TLS_MODE" = "http" ] && [ -n "$LE_EMAIL" ]; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
fi
systemctl enable --now nginx >/dev/null 2>&1 || true
ok "nginx attivo"

# ── 5. Utente di sistema + codice ───────────────────────────────────────────--
step "Utente '${APP_USER}' + codice in ${APP_DIR}"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR"
if [ -d "${APP_DIR}/server" ] && [ -d "${APP_DIR}/frontend" ]; then
  ok "codice già presente in ${APP_DIR}"
  if [ -d "${APP_DIR}/.git" ]; then
    sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin "$REPO_BRANCH" \
      && sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/${REPO_BRANCH}" --quiet \
      && ok "aggiornato a origin/${REPO_BRANCH}" || warn "git pull saltato (repo locale con modifiche?)"
  fi
elif [ -d "${SRC_ROOT}/server" ] && [ -d "${SRC_ROOT}/frontend" ] && [ "$SRC_ROOT" != "$APP_DIR" ]; then
  ok "copio il checkout da ${SRC_ROOT} → ${APP_DIR}"
  cp -a "${SRC_ROOT}/." "${APP_DIR}/"
elif [ -n "$REPO_URL" ]; then
  ok "clono ${REPO_URL} (${REPO_BRANCH})"
  rm -rf "$APP_DIR"; mkdir -p "$APP_DIR"
  git clone --quiet --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
else
  die "codice non trovato in ${APP_DIR} né in ${SRC_ROOT}. Imposta REPO_URL o lancia dallo script dentro il repo."
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 6. Ruoli + database PostgreSQL ──────────────────────────────────────────--
step "Ruoli + database 'gestimus'"
ENV_FILE="${APP_DIR}/server/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env esistente → riuso i segreti già presenti (niente rigenerazione)"
  # Recupera le password DB dal .env per non perderle.
  APP_PW="$(sed -n 's#^DATABASE_URL_APP=postgres://gestimus_app:\([^@]*\)@.*#\1#p' "$ENV_FILE" | head -1)"
  SUPER_PW="$(sed -n 's#^DATABASE_URL_SUPER=postgres://gestimus_super:\([^@]*\)@.*#\1#p' "$ENV_FILE" | head -1)"
fi
APP_PW="${APP_PW:-$(openssl rand -hex 24)}"
SUPER_PW="${SUPER_PW:-$(openssl rand -hex 24)}"

# NB: niente blocco DO $$..$$ — psql NON interpola :vars dentro i dollar-quote.
# Pattern \gexec: la password è usata solo alla CREATE (al primo giro coincide
# con quella scritta in .env subito dopo); su re-run i ruoli esistono già e la
# password resta invariata. Solo gli attributi vengono riallineati (idempotente).
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -v app_pw="$APP_PW" -v super_pw="$SUPER_PW" >/dev/null <<'SQL'
SELECT format('CREATE ROLE gestimus_app LOGIN PASSWORD %L', :'app_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_app')\gexec
SELECT format('CREATE ROLE gestimus_super LOGIN BYPASSRLS CREATEDB PASSWORD %L', :'super_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_super')\gexec
ALTER ROLE gestimus_app   WITH LOGIN;
ALTER ROLE gestimus_super WITH LOGIN BYPASSRLS CREATEDB;
SELECT 'CREATE DATABASE gestimus OWNER gestimus_super'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'gestimus')\gexec
ALTER DATABASE gestimus OWNER TO gestimus_super;
SQL
ok "ruoli gestimus_app / gestimus_super + db 'gestimus' pronti"

# ── 7. server/.env (segreti generati una sola volta) ────────────────────────--
step "Configurazione (server/.env)"
if [ ! -f "$ENV_FILE" ]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  APP_SECRET="$(openssl rand -hex 32)"
  GESTIMUS_ADMIN_PASSWORD="${GESTIMUS_ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}"
  cat > "$ENV_FILE" <<EOF
# Generato da deploy/install.sh — NON committare. Contiene segreti.
NODE_ENV=production
HOST=127.0.0.1
PORT=${APP_PORT}
LOG_LEVEL=info

# DB locale (no PgBouncer): tutte le connessioni dirette a Postgres :5432.
DATABASE_URL_APP=postgres://gestimus_app:${APP_PW}@127.0.0.1:5432/gestimus
DATABASE_URL_SUPER=postgres://gestimus_super:${SUPER_PW}@127.0.0.1:5432/gestimus

# Segreti (32+ char, alta entropia).
SESSION_COOKIE_SECRET=${SESSION_SECRET}
GESTIMUS_SECRET_KEY=${APP_SECRET}

# Multitenant: il tenant è risolto dal sottodominio. {tenant} è sostituito a runtime.
PUBLIC_BASE_URL=https://{tenant}.${GESTIMUS_DOMAIN}
SUPERADMIN_SUBDOMAIN=platform

# Storage su disco.
UPLOADS_DIR=${APP_DIR}/server/uploads
ARCHIVE_DIR=${APP_DIR}/server/archive
BACKUP_RETENTION_DAYS=90

# SMTP platform (per inviti/notifiche) — compila per abilitare l'invio email.
#PLATFORM_SMTP_HOST=
#PLATFORM_SMTP_PORT=587
#PLATFORM_SMTP_USER=
#PLATFORM_SMTP_PASSWORD=
#PLATFORM_SMTP_FROM=Gestimus <no-reply@${GESTIMUS_DOMAIN}>

# Error tracking (opzionale).
#SENTRY_DSN=
EOF
  chmod 600 "$ENV_FILE"; chown "$APP_USER:$APP_USER" "$ENV_FILE"
  NEW_ENV=1
  ok ".env creato (segreti generati, chmod 600)"
else
  NEW_ENV=0
fi
sudo -u "$APP_USER" mkdir -p "${APP_DIR}/server/uploads" "${APP_DIR}/server/archive"

# ── 8. Build server + frontend ──────────────────────────────────────────────--
step "Build (server + frontend) — può richiedere qualche minuto"
sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server'   && npm ci --no-audit --no-fund && npm run build"
ok "server compilato (dist/)"
sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/frontend' && npm ci --no-audit --no-fund && npm run build"
ok "frontend buildato (frontend/dist/)"

# ── 9. Schema + RLS + migration ledger ("i dump sql") ───────────────────────--
step "Schema DB + policies RLS"
# Fresh vs update: su un DB già provvisto, drizzle-kit push --force può DROPpare
# colonne su schema-drift SENZA backup → pericoloso in prod. Rileviamo lo stato
# guardando se la tabella core 'concorsi' esiste già (BYPASSRLS via postgres).
DB_PROVISIONED="$(sudo -u postgres psql -d gestimus -tAc "SELECT to_regclass('public.concorsi') IS NOT NULL" 2>/dev/null | tr -d '[:space:]')"
if [ "$DB_PROVISIONED" = "t" ]; then
  # UPDATE: niente push (no DROP distruttivi). Migration versionate + RLS idempotenti.
  ok "DB già provvisto (tabella 'concorsi' presente) → percorso UPDATE: migration versionate, NIENTE drizzle push"
  sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server' && npm run db:sql:up"
  ok "migration versionate applicate (db:sql:up)"
  sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server' && npm run db:policies"
  ok "policies + RLS + grant ri-applicati (policies.sql, idempotente)"
else
  # FRESH: nessuno schema → push completo + policies + baseline del ledger.
  ok "DB vergine (tabella 'concorsi' assente) → percorso FRESH: drizzle push + baseline"
  sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server' && npx drizzle-kit push --force"
  ok "schema applicato (drizzle push)"
  sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server' && npm run db:policies"
  ok "policies + RLS + grant applicati (policies.sql)"
  sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server' && npm run db:sql:baseline" || warn "baseline migration ledger saltato"
  ok "migration ledger allineato (baseline)"
fi

# ── 10. Super-admin iniziale ─────────────────────────────────────────────────
# Seed solo se abbiamo una password: fresh install (NEW_ENV=1, generata) oppure
# password passata esplicitamente. Su re-run senza password il super-admin
# esiste già → saltiamo (seed-prod.ts richiede comunque la password).
step "Super-admin platform"
if [ "${NEW_ENV:-0}" = "1" ] || [ -n "${GESTIMUS_ADMIN_PASSWORD:-}" ]; then
  SEED_OUT="$(sudo -u "$APP_USER" bash -lc "cd '${APP_DIR}/server' && GESTIMUS_ADMIN_EMAIL='${GESTIMUS_ADMIN_EMAIL}' GESTIMUS_ADMIN_PASSWORD='${GESTIMUS_ADMIN_PASSWORD:-}' npm run --silent db:seed:prod" 2>&1)" || true
  echo "$SEED_OUT" | sed 's/^/    /'
else
  warn "nessuna password admin fornita e .env già presente → seed super-admin saltato"
fi

# ── 11. Servizio systemd ─────────────────────────────────────────────────────
step "Servizio systemd (gestimus.service)"
cat > /etc/systemd/system/gestimus.service <<EOF
[Unit]
Description=Gestimus API + SPA (Fastify)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${APP_DIR}/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/server/uploads ${APP_DIR}/server/archive

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable gestimus >/dev/null 2>&1 || true
systemctl restart gestimus
ok "servizio abilitato e (ri)avviato"

# ── 12. Nginx reverse-proxy ──────────────────────────────────────────────────
step "Nginx site (proxy → 127.0.0.1:${APP_PORT}, Host preservato)"
# Zone rate-limit (contesto http).
cat > /etc/nginx/conf.d/gestimus-rl.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=iscrizioni_rl:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=auth_rl:10m rate=10r/m;
EOF
cat > /etc/nginx/sites-available/gestimus <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${GESTIMUS_DOMAIN} *.${GESTIMUS_DOMAIN};

    # Upload candidati/iscrizioni (file max 5MB + overhead multipart).
    client_max_body_size 12m;

    # SSE realtime (GET /api/realtime/fase/:id): connessione long-lived,
    # niente buffering, read-timeout lungo. SOLO qui serve 3600s.
    location /api/realtime/ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        # CRITICO: il tenant è risolto dall'Host header → va preservato.
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # Auth (login / TOTP / logout): rate-limit zona auth_rl (10r/m, definita
    # in conf.d/gestimus-rl.conf). Difesa in profondità: l'app limita già.
    location /auth/ {
        limit_req zone=auth_rl burst=10 nodelay;
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        # CRITICO: il tenant è risolto dall'Host header → va preservato.
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }

    # Submit iscrizione pubblica (POST /api/public/iscrizioni): rate-limit
    # zona iscrizioni_rl (5r/m). Anti-spam edge oltre a quello applicativo.
    location /api/public/iscrizioni {
        limit_req zone=iscrizioni_rl burst=5 nodelay;
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        # CRITICO: il tenant è risolto dall'Host header → va preservato.
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        # CRITICO: il tenant è risolto dall'Host header → va preservato.
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Richieste normali: timeout breve (l'SSE ha la sua location dedicata).
        proxy_read_timeout 30s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/gestimus /etc/nginx/sites-enabled/gestimus
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "config nginx non valida (nginx -t)."
systemctl reload nginx
ok "nginx configurato"

# ── 13. TLS (Let's Encrypt) ──────────────────────────────────────────────────
if [ "$TLS_MODE" = "http" ] && [ -n "$LE_EMAIL" ]; then
  step "TLS http-01 (apex + platform + www)"
  certbot --nginx --non-interactive --agree-tos --redirect -m "$LE_EMAIL" \
    -d "$GESTIMUS_DOMAIN" -d "www.${GESTIMUS_DOMAIN}" -d "platform.${GESTIMUS_DOMAIN}" \
    && ok "certificato emesso per apex/platform/www" \
    || warn "certbot fallito (DNS non puntato? riprova dopo aver puntato i record A)."
  warn "I sottodomini TENANT (*.${GESTIMUS_DOMAIN}) richiedono un certificato WILDCARD via DNS-01."
  warn "  certbot certonly --manual --preferred-challenges dns -d '*.${GESTIMUS_DOMAIN}' -d '${GESTIMUS_DOMAIN}'"
  warn "  (o plugin certbot-dns-ionos con API key) — vedi docs/DEPLOY-IONOS.md."
else
  warn "TLS saltato (TLS_MODE=${TLS_MODE}${LE_EMAIL:+, LE_EMAIL set}). Configura HTTPS prima del lancio pubblico."
fi

# ── 14. Backup giornaliero (systemd timer) ───────────────────────────────────
if [ "$SETUP_BACKUP" = "1" ]; then
  step "Timer backup giornaliero"
  cat > /etc/systemd/system/gestimus-backup.service <<EOF
[Unit]
Description=Gestimus DB backup
After=postgresql.service

[Service]
Type=oneshot
User=${APP_USER}
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${APP_DIR}/server/.env
ExecStart=/usr/bin/npm run --silent db:backup
EOF
  cat > /etc/systemd/system/gestimus-backup.timer <<'EOF'
[Unit]
Description=Gestimus DB backup giornaliero

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now gestimus-backup.timer >/dev/null 2>&1 || true
  ok "timer attivo (02:30 ogni giorno). RICORDA: testa un restore prima del lancio."
fi

# ── 15. Firewall ─────────────────────────────────────────────────────────────
if [ "$SETUP_FIREWALL" = "1" ]; then
  step "Firewall ufw"
  ufw allow 22/tcp >/dev/null 2>&1 || true   # SSH PRIMA, per non chiudersi fuori
  ufw allow 'Nginx Full' >/dev/null 2>&1 || ufw allow 80,443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ok "ufw: SSH + 80/443 consentiti"
fi

# ── 16. Healthcheck + riepilogo ──────────────────────────────────────────────
step "Healthcheck"
READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/readyz" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" = "1" ]; then ok "/readyz OK — l'app risponde"; else warn "/readyz non pronto: 'journalctl -u gestimus -n 50'"; fi

echo -e "\n${c_green}============================================================${c_reset}"
echo -e "${c_green} Gestimus installato.${c_reset}"
echo -e "${c_green}============================================================${c_reset}"
echo "  App dir       : ${APP_DIR}"
echo "  Servizio      : systemctl status gestimus   (log: journalctl -u gestimus -f)"
echo "  Platform URL  : https://platform.${GESTIMUS_DOMAIN}/"
echo "  Super-admin   : ${GESTIMUS_ADMIN_EMAIL}"
if [ "${NEW_ENV:-0}" = "1" ]; then
  echo "  Password      : ${GESTIMUS_ADMIN_PASSWORD:-<vedi output seed sopra>}  (cambiala dopo il primo accesso)"
else
  echo "  Password      : invariata (.env e account già esistenti)"
fi
echo ""
echo "  Prossimi passi:"
echo "   1) Punta i DNS: record A di '${GESTIMUS_DOMAIN}', 'platform.${GESTIMUS_DOMAIN}' e wildcard '*.${GESTIMUS_DOMAIN}' all'IP del server."
echo "   2) TLS wildcard per i tenant (DNS-01) — vedi docs/DEPLOY-IONOS.md."
echo "   3) Login come super-admin → crea i tenant reali dalla UI platform."
echo "   4) (Opzionale) compila SMTP/Sentry in ${APP_DIR}/server/.env e 'systemctl restart gestimus'."
