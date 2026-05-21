#!/usr/bin/env bash
# aggregate-logs.sh — Aggrega i log di tutti i tenant PocketBase in un unico stream.
#
# Usage:
#   ./scripts/aggregate-logs.sh              # tail di tutti i log
#   ./scripts/aggregate-logs.sh --since 1h   # solo ultima ora
#   ./scripts/aggregate-logs.sh --grep ERROR # filtra per ERROR
#
# Prerequisiti: PocketBase scrive log su pb_data/logs.db (SQLite).
# Per log testuali, PocketBase v0.22+ salva i log via --log flag.
#
# Configurazione consigliata: aggiungere a ogni pb@.service:
#   --log=/srv/pb/logs/%i.log
#
# Poi questo script aggrega tutti i .log in tempo reale.

LOG_DIR="/srv/pb/logs"
SINCE=""
GREP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --grep)  GREP="$2"; shift 2 ;;
    *) shift ;;
  esac
done

echo "=== Gestionale Concorso — Log Aggregator ==="
echo "  Dir: ${LOG_DIR}"
[ -n "$SINCE" ] && echo "  Since: ${SINCE}"
[ -n "$GREP" ]  && echo "  Grep: ${GREP}"
echo ""

if [ ! -d "$LOG_DIR" ]; then
  echo "✗ Directory log non trovata: ${LOG_DIR}"
  echo "  Aggiungi --log=/srv/pb/logs/NOME.log a ogni pb@.service"
  echo "  mkdir -p ${LOG_DIR}"
  exit 1
fi

FILES=$(ls "${LOG_DIR}"/*.log 2>/dev/null)
if [ -z "$FILES" ]; then
  echo "✗ Nessun file .log trovato in ${LOG_DIR}"
  exit 1
fi

TAIL_ARGS="-f"
[ -n "$SINCE" ] && TAIL_ARGS=""  # non tail se abbiamo since

if [ -n "$SINCE" ]; then
  # Filtra per timestamp recenti
  for f in ${LOG_DIR}/*.log; do
    tenant=$(basename "$f" .log)
    echo "─── ${tenant} ───"
    awk -v since="$SINCE" '{
      # Cerca linee con timestamp ISO
      if ($0 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/) {
        ts = substr($0, 1, 19)
        gsub(/[-T:]/, " ", ts)
        cmd = "date -j -f \"%Y %m %d %H %M %S\" \"" ts "\" +%s 2>/dev/null || date -d \"" substr($0,1,19) "\" +%s"
        cmd | getline epoch
        close(cmd)
        now = systime()
        since_sec = 3600  # default 1h
        if (now - epoch <= since_sec) print $0
      }
    }' "$f" 2>/dev/null
  done
else
  tail -f -n 50 ${LOG_DIR}/*.log | while IFS= read -r line; do
    if [ -n "$GREP" ]; then
      echo "$line" | grep -i "$GREP" || true
    else
      echo "$line"
    fi
  done
fi