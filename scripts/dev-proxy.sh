#!/usr/bin/env zsh
# =============================================================================
# dev-proxy.sh — reverse proxy nginx locale su porta 80 per Gestimus.
#
# Problema: il backend risolve il tenant dal sottodominio (es. ente1.gestimus.local).
# In dev gira tutto su porte alte (Vite :5173, Fastify :4000) e aprire l'app su
# `localhost` rompe la risoluzione tenant (400). Questo proxy mette davanti un
# nginx su :80 che instrada `*.gestimus.local` PRESERVANDO l'header Host:
#
#   browser → http://ente1.gestimus.local/  (porta 80, URL pulita)
#        ├── /api /auth /uploads /healthz /readyz  → Fastify 127.0.0.1:4000
#        └── tutto il resto                        → Vite   127.0.0.1:5173 (SPA + HMR)
#
# Comandi:
#   ./scripts/dev-proxy.sh start     genera la conf, assicura /etc/hosts, avvia nginx :80
#   ./scripts/dev-proxy.sh stop      ferma il proxy
#   ./scripts/dev-proxy.sh reload    rigenera la conf e ricarica
#   ./scripts/dev-proxy.sh status    stato + check raggiungibilità
#   ./scripts/dev-proxy.sh hosts     aggiunge solo le voci /etc/hosts mancanti
#
# Avviare PRIMA i due dev server: (cd server && npm run dev) e (cd frontend && npm run dev).
# Richiede nginx (brew install nginx) e sudo (porta 80 + /etc/hosts).
# =============================================================================
set -euo pipefail

# --- Config (override via env) ----------------------------------------------
BACKEND_ADDR="${BACKEND_ADDR:-127.0.0.1:4000}"
FRONTEND_ADDR="${FRONTEND_ADDR:-127.0.0.1:5173}"
LISTEN_PORT="${LISTEN_PORT:-80}"
BASE_DOMAIN="${BASE_DOMAIN:-gestimus.local}"
# Sottodomini tenant da mappare in /etc/hosts (lo split server_name usa wildcard).
SUBDOMAINS=(ente1 ente2 ente-archiviato platform)

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
PREFIX="${REPO_ROOT}/.devproxy"           # pid, log, temp, conf generata (gitignored)
CONF="${PREFIX}/nginx.conf"
PIDFILE="${PREFIX}/nginx.pid"

# --- Helpers -----------------------------------------------------------------
err() { print -P "%F{red}✗%f $*" >&2; }
ok()  { print -P "%F{green}✓%f $*"; }
inf() { print -P "%F{cyan}·%f $*"; }

find_nginx() {
  if command -v nginx >/dev/null 2>&1; then command -v nginx; return; fi
  if command -v brew >/dev/null 2>&1; then
    local p; p="$(brew --prefix 2>/dev/null)/bin/nginx"
    [[ -x "$p" ]] && { print "$p"; return; }
  fi
  return 1
}

server_names() {
  # "ente1.gestimus.local ente2.gestimus.local ... gestimus.local *.gestimus.local"
  local names=()
  for s in "${SUBDOMAINS[@]}"; do names+=("${s}.${BASE_DOMAIN}"); done
  names+=("${BASE_DOMAIN}" "*.${BASE_DOMAIN}")
  print -- "${names[*]}"
}

gen_conf() {
  mkdir -p "${PREFIX}/temp"
  cat > "${CONF}" <<EOF
# GENERATO da scripts/dev-proxy.sh — non modificare a mano.
worker_processes 1;
pid ${PIDFILE};
error_log ${PREFIX}/error.log warn;
events { worker_connections 256; }
http {
  access_log ${PREFIX}/access.log;
  client_body_temp_path ${PREFIX}/temp/client_body;
  proxy_temp_path ${PREFIX}/temp/proxy;
  fastcgi_temp_path ${PREFIX}/temp/fastcgi;
  uwsgi_temp_path ${PREFIX}/temp/uwsgi;
  scgi_temp_path ${PREFIX}/temp/scgi;
  map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }

  server {
    listen ${LISTEN_PORT};
    server_name $(server_names);

    # Backend Fastify: API, sessione, upload, health. Host preservato →
    # risoluzione tenant dal sottodominio. SSE/realtime: no buffering, timeout lungo.
    location ~ ^/(api|auth|uploads|healthz|readyz)(/|\$) {
      proxy_pass http://${BACKEND_ADDR};
      proxy_set_header Host \$host;
      proxy_set_header X-Forwarded-For \$remote_addr;
      proxy_set_header X-Forwarded-Proto \$scheme;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection \$connection_upgrade;
      proxy_buffering off;
      proxy_read_timeout 1h;
    }

    # Vite dev server: SPA + asset. L'HMR websocket si collega comunque a :5173
    # diretto (Vite inietta la sua porta); funziona finché 5173 è raggiungibile.
    location / {
      proxy_pass http://${FRONTEND_ADDR};
      proxy_set_header Host \$host;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection \$connection_upgrade;
    }
  }
}
EOF
}

ensure_hosts() {
  local missing=()
  for s in "${SUBDOMAINS[@]}"; do
    local fqdn="${s}.${BASE_DOMAIN}"
    grep -qE "^[^#]*\b${fqdn}\b" /etc/hosts || missing+=("$fqdn")
  done
  if (( ${#missing[@]} == 0 )); then ok "/etc/hosts già a posto"; return; fi
  inf "aggiungo a /etc/hosts (sudo): ${missing[*]}"
  for fqdn in "${missing[@]}"; do
    print "127.0.0.1 ${fqdn}" | sudo tee -a /etc/hosts >/dev/null
  done
  ok "/etc/hosts aggiornato"
}

NGINX="$(find_nginx || true)"
require_nginx() {
  [[ -n "${NGINX}" ]] || { err "nginx non trovato. Installa con: brew install nginx"; exit 1; }
}

cmd_start() {
  require_nginx
  ensure_hosts
  mkdir -p "${PREFIX}"
  gen_conf
  inf "test conf nginx"
  sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -t
  if [[ -f "${PIDFILE}" ]] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    inf "già attivo → reload"; sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -s reload
  else
    sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}"
  fi
  ok "proxy attivo su :${LISTEN_PORT} → apri http://${SUBDOMAINS[1]}.${BASE_DOMAIN}/"
  cmd_status
}

cmd_stop() {
  require_nginx
  if [[ -f "${PIDFILE}" ]] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -s stop && ok "proxy fermato"
  else
    inf "proxy non in esecuzione"
  fi
}

cmd_reload() { require_nginx; gen_conf; sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -t && sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -s reload && ok "ricaricato"; }

cmd_status() {
  if [[ -f "${PIDFILE}" ]] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    ok "nginx attivo (pid $(cat "${PIDFILE}"))"
  else
    inf "nginx non attivo"
  fi
  local url="http://${SUBDOMAINS[1]}.${BASE_DOMAIN}/healthz"
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || print 000)"
  [[ "$code" == "200" ]] && ok "backend raggiungibile via proxy ($url → $code)" \
                         || inf "backend non raggiungibile ($url → $code) — i dev server sono avviati?"
}

case "${1:-start}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  reload) cmd_reload ;;
  status) cmd_status ;;
  hosts)  ensure_hosts ;;
  *) err "uso: $0 {start|stop|reload|status|hosts}"; exit 1 ;;
esac
