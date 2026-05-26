#!/usr/bin/env zsh
# =============================================================================
# dev-proxy.sh — ambiente dev "production-like" su macOS: tutti i sottodomini
# *.gestimus.local risolti a 127.0.0.1 (dnsmasq wildcard) + reverse proxy nginx
# su porta 80 che preserva l'header Host.
#
# Perché: il backend risolve il tenant dal sottodominio. Aprendo l'app su
# `localhost` la risoluzione tenant fallisce (400). Con questo setup apri
# direttamente:  http://ente1.gestimus.local/   (porta 80, URL pulita)
#
#   browser → nginx :80  (server_name *.gestimus.local)
#        ├── /api /auth /uploads /healthz /readyz  → Fastify  127.0.0.1:4000
#        └── tutto il resto                        → Vite     127.0.0.1:5173
#
# QUALSIASI sottodominio (tenant nuovi, platform, ...) funziona senza toccare
# /etc/hosts: dnsmasq risolve l'intero wildcard `*.gestimus.local`.
#
# Comandi:
#   ./scripts/dev-proxy.sh up        setup completo: install → dnsmasq → nginx :80
#   ./scripts/dev-proxy.sh down      ferma nginx (dnsmasq resta come servizio)
#   ./scripts/dev-proxy.sh reload    rigenera la conf nginx e ricarica
#   ./scripts/dev-proxy.sh dns       (ri)configura solo dnsmasq + resolver
#   ./scripts/dev-proxy.sh status    diagnostica: install, DNS, proxy, backend
#
# Avvia PRIMA i dev server: (cd server && npm run dev) e (cd frontend && npm run dev).
# Usa sudo per: /etc/resolver, dnsmasq su :53, nginx su :80 (te lo chiede una volta).
# =============================================================================
set -euo pipefail

# --- Config (override via env) ----------------------------------------------
BASE_DOMAIN="${BASE_DOMAIN:-gestimus.local}"
BACKEND_ADDR="${BACKEND_ADDR:-127.0.0.1:4000}"
FRONTEND_ADDR="${FRONTEND_ADDR:-127.0.0.1:5173}"
LISTEN_PORT="${LISTEN_PORT:-80}"
AUTO_INSTALL="${AUTO_INSTALL:-1}"   # 1 = brew install automatico se mancano

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
PREFIX="${REPO_ROOT}/.devproxy"     # pid/log/temp/conf nginx (gitignored)
CONF="${PREFIX}/nginx.conf"
PIDFILE="${PREFIX}/nginx.pid"

# Worker nginx come utente reale (non 'nobody'): serve file sotto la home,
# es. il portfolio. Default = owner del repo (regge anche sotto sudo).
SITE_USER="${SITE_USER:-$(stat -f '%Su' "${REPO_ROOT}")}"
SITE_GROUP="${SITE_GROUP:-$(stat -f '%Sg' "${REPO_ROOT}")}"
# NB: config del portfolio (ICAL_URL, immagini, ecc.) ora in
# portfolio-sassofonista/frontend/inc/config.local.php — non più via fastcgi_param qui.

# --- Output ------------------------------------------------------------------
err() { print -P "%F{red}✗%f $*" >&2; }
ok()  { print -P "%F{green}✓%f $*"; }
inf() { print -P "%F{cyan}·%f $*"; }

# --- brew / pacchetti --------------------------------------------------------
BREW=""
require_brew() {
  if command -v brew >/dev/null 2>&1; then BREW="$(command -v brew)"; return; fi
  err "Homebrew non trovato. Installa da https://brew.sh poi rilancia."
  exit 1
}

# brew_prefix_bin <formula> <bin> → path eseguibile o vuoto
brew_bin() { local p="$("${BREW}" --prefix 2>/dev/null)/bin/$1"; [[ -x "$p" ]] && print "$p"; }

ensure_pkg() {
  local formula="$1"
  if "${BREW}" list --formula "${formula}" >/dev/null 2>&1; then ok "${formula} già installato"; return; fi
  if [[ "${AUTO_INSTALL}" == "1" ]]; then
    inf "installo ${formula} (brew install ${formula})…"
    "${BREW}" install "${formula}"
    ok "${formula} installato"
  else
    err "${formula} mancante. Installa con: brew install ${formula} (o AUTO_INSTALL=1)"
    exit 1
  fi
}

# --- dnsmasq + resolver ------------------------------------------------------
setup_dns() {
  require_brew
  ensure_pkg dnsmasq
  local conf="$("${BREW}" --prefix)/etc/dnsmasq.conf"
  local line="address=/${BASE_DOMAIN}/127.0.0.1"
  mkdir -p "$(dirname "$conf")"
  touch "$conf"
  if grep -qF -- "$line" "$conf"; then
    ok "dnsmasq: regola wildcard già presente"
  else
    print -- "$line" >> "$conf"
    ok "dnsmasq: aggiunta regola ${line}"
  fi

  # Resolver di sistema: le query *.BASE_DOMAIN vanno a dnsmasq su 127.0.0.1.
  local resolver="/etc/resolver/${BASE_DOMAIN}"
  local want="nameserver 127.0.0.1"
  if [[ -f "$resolver" ]] && grep -qF -- "$want" "$resolver"; then
    ok "/etc/resolver/${BASE_DOMAIN} già configurato"
  else
    inf "scrivo ${resolver} (sudo)"
    sudo mkdir -p /etc/resolver
    print -- "$want" | sudo tee "$resolver" >/dev/null
    ok "resolver creato"
  fi

  # dnsmasq gira su :53 → servizio root.
  inf "avvio/riavvio dnsmasq (sudo brew services)"
  sudo "${BREW}" services restart dnsmasq >/dev/null 2>&1 || sudo "${BREW}" services start dnsmasq >/dev/null 2>&1 || true
  # Flush cache risolutore macOS.
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true

  verify_dns
}

verify_dns() {
  local probe="probe-$$.${BASE_DOMAIN}"
  # Interroga dnsmasq direttamente (non dipende dalla cache di sistema).
  local r=""
  if command -v dig >/dev/null 2>&1; then
    r="$(dig +short "@127.0.0.1" "$probe" 2>/dev/null | head -1)"
  fi
  if [[ "$r" == "127.0.0.1" ]]; then
    ok "dnsmasq risolve *.${BASE_DOMAIN} → 127.0.0.1 (testato: ${probe})"
  else
    err "dnsmasq non risolve ${probe} (dig @127.0.0.1 → '${r:-vuoto}'). Controlla: sudo brew services list"
    return 1
  fi
}

# --- nginx -------------------------------------------------------------------
NGINX=""
require_nginx() {
  require_brew
  ensure_pkg nginx
  NGINX="$(brew_bin nginx || true)"
  [[ -n "${NGINX}" ]] || { err "nginx non trovato dopo l'install"; exit 1; }
}

gen_conf() {
  mkdir -p "${PREFIX}/temp"
  cat > "${CONF}" <<EOF
# GENERATO da scripts/dev-proxy.sh — non modificare a mano.
# master root (bind :80) → worker come ${SITE_USER}: legge i file del portfolio
# sotto la home (non attraversabile da 'nobody').
user ${SITE_USER} ${SITE_GROUP};
worker_processes 1;
pid ${PIDFILE};
error_log ${PREFIX}/error.log warn;
events { worker_connections 256; }
http {
  include /opt/homebrew/etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log ${PREFIX}/access.log;
  client_body_temp_path ${PREFIX}/temp/client_body;
  proxy_temp_path ${PREFIX}/temp/proxy;
  fastcgi_temp_path ${PREFIX}/temp/fastcgi;
  uwsgi_temp_path ${PREFIX}/temp/uwsgi;
  scgi_temp_path ${PREFIX}/temp/scgi;
  map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }

  server {
    listen ${LISTEN_PORT};
    # Wildcard: qualsiasi sottodominio del tenant (dnsmasq li risolve tutti).
    server_name ${BASE_DOMAIN} *.${BASE_DOMAIN};

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

    # Vite dev server: SPA + asset. L'HMR websocket si collega a :5173 diretto
    # (Vite inietta la sua porta); funziona finché 5173 è raggiungibile.
    location / {
      proxy_pass http://${FRONTEND_ADDR};
      proxy_set_header Host \$host;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection \$connection_upgrade;
    }
  }

  # ---------------------------------------------------------------------------
  # Portfolio Danilo Russo (PHP server-rendered) → http://danilorusso.local/
  # Stesso nginx, vhost separato. danilorusso.local NON è sotto il wildcard
  # *.${BASE_DOMAIN}, quindi va risolto via /etc/hosts (dnsmasq non lo copre).
  # Richiede PHP-FPM in ascolto su 127.0.0.1:9000.
  # ---------------------------------------------------------------------------
  server {
    listen ${LISTEN_PORT};
    server_name danilorusso.local;
    root /Users/danilorusso/Desktop/WEBAPP/portfolio-sassofonista/frontend;
    index index.php index.html;
    charset utf-8;

    # immagini servite da content/images (fuori dal docroot)
    location /images/ {
      alias /Users/danilorusso/Desktop/WEBAPP/portfolio-sassofonista/content/images/;
      access_log off;
      expires 30d;
    }

    # blocca accesso diretto agli include PHP
    location ^~ /inc/ { deny all; return 404; }

    location / {
      try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ~ \.php\$ {
      try_files \$uri =404;
      fastcgi_pass 127.0.0.1:9000;
      fastcgi_index index.php;
      fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
      fastcgi_param HTTP_AUTHORIZATION \$http_authorization;
      include /opt/homebrew/etc/nginx/fastcgi_params;
    }
  }
}
EOF
}

nginx_running() { [[ -f "${PIDFILE}" ]] && kill -0 "$(cat "${PIDFILE}" 2>/dev/null)" 2>/dev/null; }

start_nginx() {
  require_nginx
  mkdir -p "${PREFIX}"
  gen_conf
  inf "verifica conf nginx"
  sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -t
  if nginx_running; then
    inf "nginx già attivo → reload"
    sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -s reload
  else
    sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}"
  fi
  ok "nginx in ascolto su :${LISTEN_PORT}"
}

# --- comandi -----------------------------------------------------------------
cmd_up() {
  setup_dns
  start_nginx
  print
  ok "Pronto. Apri: %F{green}http://ente1.${BASE_DOMAIN}/%f  (qualsiasi <tenant>.${BASE_DOMAIN} funziona)"
  inf "Ricorda i dev server: (cd server && npm run dev) · (cd frontend && npm run dev)"
  cmd_status
}

cmd_down() {
  require_nginx
  if nginx_running; then
    sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -s stop && ok "nginx fermato"
  else
    inf "nginx non in esecuzione"
  fi
  inf "dnsmasq resta attivo come servizio (./dev-proxy.sh status per verificare; 'sudo brew services stop dnsmasq' per fermarlo)"
}

cmd_reload() {
  require_nginx; gen_conf
  sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -t
  sudo "${NGINX}" -p "${PREFIX}/" -c "${CONF}" -s reload && ok "nginx ricaricato"
}

cmd_status() {
  print -P "%F{cyan}── stato dev-proxy ──%f"
  command -v brew >/dev/null 2>&1 && ok "brew presente" || err "brew assente"
  [[ -n "$(brew_bin nginx 2>/dev/null || true)" ]] 2>/dev/null && ok "nginx installato" || inf "nginx non installato"
  nginx_running && ok "nginx attivo (pid $(cat "${PIDFILE}"))" || inf "nginx non attivo"
  [[ -f "/etc/resolver/${BASE_DOMAIN}" ]] && ok "resolver /etc/resolver/${BASE_DOMAIN} presente" || inf "resolver assente"
  verify_dns || true
  local url="http://ente1.${BASE_DOMAIN}/healthz"
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || print 000)"
  [[ "$code" == "200" ]] && ok "backend via proxy OK (${url} → ${code})" \
                         || inf "backend non raggiungibile (${url} → ${code}) — dev server avviati?"
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  reload) cmd_reload ;;
  dns)    setup_dns ;;
  status) cmd_status ;;
  *) err "uso: $0 {up|down|reload|dns|status}"; exit 1 ;;
esac
