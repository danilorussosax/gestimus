# Deploy multi-tenant — analisi e raccomandazioni

Documento di riferimento per il deploy del gestionale concorso in modalità multi-tenant, dove ogni ente organizzatore (scuola, conservatorio, associazione) ha un proprio sottodominio e un'istanza dati isolata.

## 1. Architettura attuale (cosa va replicato)

- **Backend**: PocketBase = singolo binario Go (~40 MB) + SQLite. Nessun DB server esterno. Realtime via SSE: la collezione `fase_runtime` viene sottoscritta dai commissari per la valutazione sincrona.
- **Frontend**: 100% statico (~620 KB JS + 12 KB HTML + asset). Nessun build step. Si serve con qualsiasi static server (Caddy / nginx / Cloudflare Pages / S3).
- **Isolamento attuale**: il "tenant" logico oggi è il singolo `concorso`. Non esiste separazione fra enti — tutti i record convivono nella stessa SQLite.
- **File pesanti**: foto candidati, CV (PDF), logo concorso vivono in `pocketbase/pb_data/storage/`. Stima ~1 MB/candidato.

## 2. Strategia consigliata: una istanza PB per ente

```
ente1.tuodominio.it ─┐
ente2.tuodominio.it ─┼─► Caddy ─┬─► PB :8091 (pb_data_ente1/)
ente3.tuodominio.it ─┘          ├─► PB :8092 (pb_data_ente2/)
                                └─► PB :8093 (pb_data_ente3/)
```

**Vantaggi rispetto al modello "tenant_id condiviso"**:

- Isolamento dati totale (GDPR-friendly: un export ente = `cp -r pb_data_enteX`)
- Zero refactor schema — il codice attuale gira tale e quale
- Backup, upgrade e migrazioni indipendenti per ente
- Blast radius limitato: bug o corruzione coinvolgono un solo ente
- Tariffazione/quote per ente facili da imporre (cgroup, quota disco)

**Svantaggi**:

- N processi PB invece di uno (overhead RAM lineare)
- Aggiornamento binario PB richiede rolling restart su tutti i tenant
- Non c'è SSO cross-ente nativo

L'alternativa "schema condiviso con campo `tenant_id`" sarebbe più leggera in RAM ma richiederebbe refactor pesante delle access rules PB e introdurrebbe rischi di leak fra enti — sconsigliato per dati che includono valutazioni e dati personali.

## 3. Modifiche minime al codice

### Frontend
File `js/pb.js`: derivare `PB_URL` dall'host invece che hard-coded.

```js
// Da:  const PB_URL = 'http://127.0.0.1:8090';
// A:   const PB_URL = `${location.protocol}//${location.host}`;
```

Caddy fa da reverse proxy per `/api/*`, `/_/*` (admin UI) e per gli SSE realtime → tutto sullo stesso origin del frontend → niente CORS, niente config aggiuntiva.

### Backend / infrastruttura
- Nessuna modifica al codice PB lato schema
- Una directory `pb_data_<ente>/` per ente
- Un binario PB condiviso, una porta diversa per istanza

## 4. Sizing per singola istanza PB

| Risorsa | Idle | Sotto carico (~30 commissari attivi) |
|---|---|---|
| RAM   | ~30 MB | 80–150 MB |
| CPU   | <1% di un vCPU | <5% (picchi durante import CSV / export PDF) |
| Disco | ~10 MB (DB vuoto) | ~100 MB per concorso da 100 candidati |

A regime, **il collo di bottiglia è RAM per istanze attive e disco per i file**, non CPU. SSD/NVMe è importante perché SQLite fa molti `fsync` durante le scritture.

## 5. Raccomandazione macchina

| Scala | vCPU | RAM | SSD | Provider tipico | Costo |
|---|---|---|---|---|---|
| **MVP / fino a 10 enti** | 2 | **4 GB** | 80 GB NVMe | Hetzner CX22, OVH VPS Value, Contabo VPS S | **5–10 €/mese** |
| 20–50 enti attivi | 4 | 8 GB | 160 GB NVMe | Hetzner CPX31, OVH SSD-2 | 15–25 €/mese |
| 100+ enti | 8 | 16 GB | 320 GB NVMe | Hetzner CPX41 | 30–50 €/mese |

Lo **scale-up verticale** è sufficiente fino a qualche centinaio di enti prima di doversi porre il problema del multi-server.

## 6. Stack di deploy minimo

- **Linux** Debian/Ubuntu LTS sul VPS
- **Caddy** come reverse proxy: TLS automatico (Let's Encrypt) + on-demand TLS per nuovi sottodomini senza redeploy
- **systemd** unit templated `pb@.service` con drop-in che setta porta + directory dati per istanza
- **restic** o **rclone** giornaliero verso S3-compatible (Backblaze B2 / Wasabi / Cloudflare R2) per i `pb_data_*/`
- **DNS wildcard** `*.tuodominio.it` → IP del VPS (oppure provisioning automatico via API DNS, es. Cloudflare)

### Esempio Caddyfile

```caddy
{
    on_demand_tls {
        ask https://provisioning.tuodominio.it/check
    }
}

*.tuodominio.it {
    tls {
        on_demand
    }

    @ente1 host ente1.tuodominio.it
    handle @ente1 {
        root * /var/www/gestionale
        @api path /api/* /_/*
        reverse_proxy @api localhost:8091
        file_server
    }

    @ente2 host ente2.tuodominio.it
    handle @ente2 {
        root * /var/www/gestionale
        @api path /api/* /_/*
        reverse_proxy @api localhost:8092
        file_server
    }
}
```

### Esempio systemd unit

`/etc/systemd/system/pb@.service`:
```ini
[Unit]
Description=PocketBase tenant %i
After=network.target

[Service]
Type=simple
User=pb
WorkingDirectory=/srv/pb
EnvironmentFile=/etc/pb/%i.env
ExecStart=/srv/pb/pocketbase serve \
    --http=127.0.0.1:${PORT} \
    --dir=/srv/pb/data/%i \
    --migrationsDir=/srv/pb/pb_migrations
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/pb/ente1.env`:
```
PORT=8091
```

Avvio: `systemctl enable --now pb@ente1`.

### Script di onboarding nuovo ente

Pseudocodice (~30 righe bash):
1. Allocare la prossima porta libera (`8090 + N`)
2. Creare `/srv/pb/data/<ente>/`
3. Scrivere `/etc/pb/<ente>.env`
4. Aggiungere blocco al Caddyfile (oppure usare on-demand TLS + lookup dinamico)
5. `systemctl enable --now pb@<ente>`
6. `systemctl reload caddy`
7. Aprire admin UI iniziale → invio mail con credenziali al referente ente

## 7. Stima crescita disco (per 10 enti, 3 anni)

- 10 enti × 5 concorsi/anno × 100 candidati × 1 MB = 5 GB/anno
- Database SQLite: trascurabile (~50–200 MB anche dopo anni)
- Audit log + log realtime: ~50 MB/anno per ente attivo
- **Totale**: 15–20 GB su 3 anni → 80 GB di SSD bastano abbondantemente

## 8. Decisioni da prendere prima del go-live

1. **Auth condivisa o per-tenant?** Oggi PB auth è per-istanza: un account commissario non si "porta dietro" fra enti. Se serve SSO trasversale, va aggiunto un IdP esterno (Keycloak / Authelia).
2. **DNS**: wildcard `*.dominio` o provisioning automatico via API Cloudflare?
3. **Logo dell'ente**: oggi il logo è a livello di **concorso** (campo `logo` su `concorsi`). Per branding di livello "ente" serve un livello superiore, oppure convivere con "il logo del primo concorso = default header". Decisione di prodotto.
4. **Aggiornamento binario PB**: serve script di rolling restart con health check (curl `/api/health`) prima di passare al tenant successivo.
5. **Quota / fair use per ente**: limitare upload (es. 2 GB di file) tramite quota di filesystem (`xfs_quota`/`ext4` project quota) e non solo a livello applicativo.
6. **Backup retention**: 7 giorni daily + 4 weekly + 12 monthly è uno standard ragionevole; pesa pochi euro/mese su B2/Wasabi.

## 9. Punti di partenza concreti

- VPS Hetzner CX22 (Helsinki o Norimberga) — ~5 €/mese
- Caddy + systemd come sopra
- Frontend in `/var/www/gestionale/` (rsync da CI o git pull)
- Backup `restic` con repo su Backblaze B2
- Monitoring leggero: Uptime Kuma sullo stesso VPS oppure UptimeRobot esterno (free tier)

Con questa base si gestiscono comodamente i primi 5–10 enti. Il salto a 50+ enti richiede solo upgrade verticale del piano VPS, senza cambi architetturali.
