# Gestimus — Alta disponibilità PostgreSQL (replica + failover)

> **Scopo**: eliminare il single point of failure del database. Lo stack applicativo
> è **un solo processo Node + un solo Postgres**: questo documento descrive come
> rendere il *database* ridondato con failover automatico, il routing delle
> connessioni e il comportamento atteso dell'app. Il failover applicativo (più
> repliche del processo Node dietro nginx) è trattato in fondo.
>
> **Nota onesta**: il failover automatico è **infrastruttura**, non codice
> dell'app. Va provisionato e validato su nodi reali (≥3 per il quorum del DCS).
> Questo è il runbook per farlo; l'app è già compatibile (pool con reconnect,
> hub realtime con backoff, retry idempotente lato client).

---

## 1. Obiettivi (SLO)

| Metrica | Target |
|---|---|
| RPO (perdita dati max) | 0 con replica **sincrona**; secondi con asincrona |
| RTO (downtime su failover) | < 30 s (promozione automatica + ri-routing) |
| Durabilità | WAL archiviati off-site (PITR) oltre alla replica |

---

## 2. Topologia consigliata

```
                         ┌─────────────────────────────┐
                         │  nginx  *.gestimus.it :443   │
                         └──────────────┬──────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │   Gestimus (Node/Fastify) — N repliche │  (stateless: sessioni in DB)
                    └───────────────────┬───────────────────┘
                                        │ DATABASE_URL_* → VIP:5000 (write) / :5001 (read)
                                        ▼
                         ┌─────────────────────────────┐
                         │  HAProxy (o PgBouncer+HAProxy)│  health-check via Patroni REST
                         │   :5000 → primary             │
                         │   :5001 → replica/e (read)    │
                         └───────┬───────────────┬───────┘
                                 │               │
                   ┌─────────────▼───┐   ┌───────▼─────────┐   ┌──────────────────┐
                   │ PG primary      │──▶│ PG standby #1   │──▶│ PG standby #2     │
                   │ (Patroni+etcd)  │   │ (sync o async)  │   │ (async, read)     │
                   └─────────────────┘   └─────────────────┘   └──────────────────┘
                        streaming replication + WAL archiving (pgBackRest/wal-g → S3)
```

**Componenti:**
- **3 nodi Postgres 18** gestiti da **Patroni** (consigliato) con un **DCS** (etcd/Consul, 3 nodi per il quorum). Patroni elegge il primary, promuove uno standby al fallimento, gestisce la replication.
- **HAProxy** davanti: porta `5000` instrada sempre al *primary corrente* (health-check sull'endpoint REST di Patroni `/primary`), porta `5001` instrada alle *repliche* (`/replica`). Niente VIP da spostare a mano.
- **App** punta i DSN al VIP/hostname di HAProxy (vedi §5). Nessuna modifica al codice: cambia solo l'host nei `DATABASE_URL_*`.

> Alternative a Patroni: **repmgr + repmgrd** (più semplice, failover ok) o
> **pg_auto_failover** (Microsoft, monitor+keeper). Patroni è il più diffuso e
> robusto. Se non vuoi gestire il cluster: **Postgres managed** con standby
> (es. provider cloud) e punta i DSN all'endpoint del provider.

---

## 3. Replica (streaming replication)

### Sincrona vs asincrona
- **Sincrona** (`synchronous_commit=on` + `synchronous_standby_names`): RPO=0 (nessuna perdita), ma ogni commit attende l'ack di ≥1 standby → latenza di scrittura maggiore. Consigliata: **1 standby sincrono + 1 asincrono** (`ANY 1 (s1,s2)`), così si tollera la perdita di uno standby senza bloccare le scritture.
- **Asincrona**: latenza minima, RPO di pochi secondi (lag). Accettabile per concorsi musicali (non transazioni finanziarie), ma la sincrona è preferibile per i voti.

### Parametri primary (`postgresql.conf`)
```ini
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
synchronous_commit = on
synchronous_standby_names = 'ANY 1 (gestimus_s1, gestimus_s2)'
hot_standby = on
wal_keep_size = 1024          # o usa replication slots (Patroni li gestisce)
archive_mode = on
archive_command = 'pgbackrest --stanza=gestimus archive-push %p'   # WAL → off-site
```

### Parametri standby
`hot_standby = on` (read-only durante la replica). Con Patroni la configurazione standby (`primary_conninfo`, slot) è gestita automaticamente: si dichiara nel suo YAML, non si scrive `standby.signal` a mano.

### pg_hba.conf (sul primary)
```
host  replication  replicator  10.0.0.0/24  scram-sha-256
```

---

## 4. Failover automatico (Patroni)

`patroni.yml` per ciascun nodo (sketch):
```yaml
scope: gestimus
name: gestimus_s1            # nome unico per nodo
restapi: { listen: 0.0.0.0:8008, connect_address: <ip>:8008 }
etcd3: { hosts: [etcd1:2379, etcd2:2379, etcd3:2379] }
bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576     # 1MB: standby troppo indietro non viene promosso
    synchronous_mode: true               # garantisce RPO basso
    postgresql:
      use_pg_rewind: true                # failback rapido senza re-basebackup
      parameters: { synchronous_commit: "on", wal_level: replica, hot_standby: "on" }
postgresql:
  listen: 0.0.0.0:5432
  connect_address: <ip>:5432
  authentication:
    superuser: { username: postgres, password: <...> }
    replication: { username: replicator, password: <...> }
```

**Cosa fa al fallimento del primary**: il lock in etcd scade → Patroni promuove lo standby più aggiornato (con `pg_rewind` per il vecchio primary quando torna), aggiorna il proprio stato REST → HAProxy vede il nuovo `/primary` e re-instrada. RTO tipico < 30 s.

### HAProxy (`haproxy.cfg`, estratto)
```
listen postgres_write
    bind *:5000
    option httpchk GET /primary
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server s1 <ip_s1>:5432 check port 8008
    server s2 <ip_s2>:5432 check port 8008
    server s3 <ip_s3>:5432 check port 8008

listen postgres_read
    bind *:5001
    balance roundrobin
    option httpchk GET /replica
    http-check expect status 200
    server s1 <ip_s1>:5432 check port 8008
    server s2 <ip_s2>:5432 check port 8008
    server s3 <ip_s3>:5432 check port 8008
```
`on-marked-down shutdown-sessions`: chiude subito le connessioni verso un nodo non più primary → l'app riapre verso il nuovo (il pool node-postgres ha già i listener d'errore e ricrea i client compromessi).

---

## 5. Configurazione dell'app (nessun cambio di codice)

Tutti i DSN puntano ad **HAProxy** (porta write), così seguono automaticamente il primary corrente:

```bash
# /etc/gestimus/server.env
DATABASE_URL_APP=postgres://gestimus_app:<pwd>@haproxy.internal:5000/gestimus
DATABASE_URL_SUPER=postgres://gestimus_super:<pwd>@haproxy.internal:5000/gestimus
# DIRECT (LISTEN/NOTIFY + advisory lock di sessione del cleanup) → primary write,
# NON una replica (NOTIFY non si propaga dalle repliche, le repliche sono read-only)
DATABASE_URL_DIRECT=postgres://gestimus_super:<pwd>@haproxy.internal:5000/gestimus
```

Se vuoi scaricare le **letture pesanti** sulle repliche (porta 5001), si introduce un
DSN read-only dedicato e si instradano gli endpoint solo-lettura. **Oggi non c'è**
nel codice: richiederebbe un pool aggiuntivo e attenzione al *replication lag* (una
lettura subito dopo una scrittura potrebbe non vedere il dato). Per il carico atteso
(concorsi) il primary regge le letture: rimandare finché le metriche non lo richiedono.

> Importante: con PgBouncer in mezzo (vedi `DEPLOY-IONOS.md` § Step 6-bis), la catena
> è App → PgBouncer (transaction) → HAProxy (:5000) → primary. PgBouncer va su ogni
> nodo app o centralizzato; `DATABASE_URL_DIRECT` bypassa PgBouncer ma **non** HAProxy.

### Comportamento già presente nell'app durante un failover
- **Pool node-postgres**: listener `error` su client idle (`db/client.ts`) → il client compromesso viene sostituito; le nuove connessioni vanno al nuovo primary via HAProxy.
- **Hub realtime LISTEN** (`realtime/hub.ts`): riconnessione con backoff esponenziale → si riaggancia al nuovo primary e ri-esegue i `LISTEN`.
- **Retry idempotente** lato client (`frontend/src/lib/api.ts` + TanStack Query): GET/PUT/DELETE ritentati su errore transitorio (rete/timeout) → assorbe la finestra di failover per le richieste in volo.
- **Cleanup** (cron): advisory lock di sessione su connessione diretta; se cade durante il failover, il run salta e ritenta al prossimo cron (transazionale, niente stato inconsistente).

**Limite noto**: le scritture *in volo* esattamente durante la promozione possono
fallire (l'utente vede un errore una tantum) — accettabile per un RTO < 30 s. Le
POST non idempotenti (es. salva voto) non sono ritentate automaticamente lato client
by design (no doppi invii): l'utente ripete l'azione.

---

## 6. Backup / PITR (ortogonale all'HA)

La replica **non sostituisce** i backup: una `DELETE` errata si propaga a tutte le repliche.
- **pgBackRest** (o wal-g): full+incrementali + WAL archiving su S3/B2 → **Point-In-Time Recovery**.
- Conservare la retention pre-hard-delete dei tenant (super-admin → archiviazione → cleanup configurabile).
- Testare il restore periodicamente (un backup non testato non è un backup).

---

## 7. Runbook operativo

### Verifica stato cluster
```bash
patronictl -c /etc/patroni/patroni.yml list        # ruoli, lag, stato
# Lag di replica dal primary:
psql "$PRIMARY" -c "SELECT client_addr, state, replay_lag FROM pg_stat_replication;"
```

### Failover manuale pianificato (es. manutenzione del primary)
```bash
patronictl -c /etc/patroni/patroni.yml switchover --master gestimus_s1 --candidate gestimus_s2
# HAProxy ri-instrada da solo entro pochi secondi.
```

### Failover automatico (primary morto)
Nessuna azione: Patroni promuove, HAProxy re-instrada. **Verificare** dopo:
1. `patronictl list` → nuovo primary, vecchio nodo `running`/`stopped`.
2. Quando il vecchio primary torna: Patroni lo re-aggancia come standby (`pg_rewind`).
3. Controllare il lag e che `synchronous_standby_names` sia di nuovo soddisfatto.

### Test del failover (da fare PRIMA della produzione)
```bash
# Sul nodo primary: simula crash
sudo systemctl stop patroni        # o: pkill -9 postgres
# Osserva: patronictl list (su un altro nodo) → promozione < 30s
# Verifica app: curl https://ente1.gestimus.it/healthz → 200 dopo la finestra
```

### Monitoraggio (allarmi)
- Patroni REST `/health` per nodo; `pg_stat_replication.replay_lag` > soglia → alert.
- HAProxy stats page: nessun backend `UP` su `:5000` → primary assente → alert critico.
- Disco WAL sul primary (se le repliche sono indietro, i WAL si accumulano).

---

## 8. Alta disponibilità dell'app (oltre al DB)

L'app è **stateless** (sessioni in DB, niente stato in memoria salvo cache TTL e
metriche ring-buffer ricostruibili) → si possono avviare **N processi/nodi** dietro
nginx (`upstream` con più backend). Unica accortezza: l'**hub realtime LISTEN** apre
una connessione per processo → con N processi ci sono N listener (ok, idempotenti);
le metriche `/api/platform/runtime` sono per-processo (aggregare lato monitoraggio o
accettare la vista per-istanza). Cron del cleanup: l'advisory lock globale garantisce
che **un solo** processo esegua il job anche con N repliche.

---

## 9. Checklist di go-live HA

- [ ] 3 nodi PG18 + Patroni + DCS (etcd 3 nodi) su host/zone distinti
- [ ] `synchronous_mode: true`, ≥1 standby sincrono
- [ ] HAProxy (:5000 write, :5001 read) con health-check Patroni REST
- [ ] DSN app → HAProxy :5000 (incluso `DATABASE_URL_DIRECT`)
- [ ] WAL archiving + pgBackRest su storage off-site; **restore testato**
- [ ] Failover testato (kill primary → RTO < 30 s, app torna 200)
- [ ] Allarmi: lag replica, backend HAProxy down, disco WAL
- [ ] ≥2 nodi app dietro nginx (stateless), cleanup cron protetto da advisory lock
