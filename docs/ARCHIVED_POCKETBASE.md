# PocketBase setup *(ARCHIVED — stack legacy)*

> ⚠️ **Questo documento è archiviato e non aggiornato.** Si riferisce al vecchio backend PocketBase + SQLite. Dal maggio 2026 lo stack è stato migrato su **Fastify + PostgreSQL + Drizzle**. La documentazione attuale è in:
> - [`../server/README.md`](../server/README.md) — backend Fastify
> - [`MIGRATION_POSTGRES.md`](MIGRATION_POSTGRES.md) — schema DB, RLS, architettura completa
> - [`DEPLOY-IONOS.md`](DEPLOY-IONOS.md) — guida deploy aggiornata
>
> Tenuto in repo solo per riferimento storico del modello di runtime PocketBase usato fino alla migrazione.

---

Il gestionale usa [PocketBase](https://pocketbase.io) come **backend di runtime** — un single binary Go + SQLite con admin UI integrata, API REST, file uploads, realtime SSE e hook JS server-side (Goja).

> Schema versionato in `pb_migrations/` (38 migration al momento). Hook custom in `pb_hooks/`. Niente più localStorage runtime: tutto su PB.

## Avvio rapido con npm

Dalla root del progetto:

```bash
npm install      # solo la prima volta
npm start        # avvia PocketBase (8090) + server statico (8000) in parallelo
```

- App: http://127.0.0.1:8000/
- API PocketBase: http://127.0.0.1:8090/
- Admin UI: http://127.0.0.1:8090/_/

Script disponibili:

| Comando | Cosa fa |
|---|---|
| `npm start` | PB + server web in parallelo (Ctrl+C ferma entrambi) |
| `npm run start:pb` | Solo PocketBase con auto-migrations |
| `npm run start:web` | Solo server statico su porta 8000 |
| `npm run setup:pb -- <email> <password>` | Setup manuale collezioni via API |
| `npm run create:admin -- <email> <password> [nome] [cognome]` | Crea il primo admin |

In alternativa, ogni componente si può avviare a mano come descritto sotto.

## 1. Installa e avvia PocketBase

1. Scarica il binario da https://pocketbase.io/docs/ (sezione Download). Per macOS:
   ```bash
   curl -L https://github.com/pocketbase/pocketbase/releases/latest/download/pocketbase_darwin_amd64.zip -o pb.zip
   unzip pb.zip -d pocketbase
   chmod +x pocketbase/pocketbase
   ```
   Su Apple Silicon usa `pocketbase_darwin_arm64.zip`.

2. Avvia il server (dalla root del progetto):
   ```bash
   ./pocketbase/pocketbase serve
   ```
   Il server ascolta su `http://127.0.0.1:8090`.
   - L'admin UI è su `http://127.0.0.1:8090/_/`. Al primo avvio chiede di creare l'account amministratore.

## 2. Migrations e hook

```bash
./pocketbase/pocketbase serve --migrationsDir ./pb_migrations --hooksDir ./pb_hooks
```

Al primo avvio applica tutte le migration in `pb_migrations/` in ordine numerico.

### Collezioni principali

| Collezione | Note |
|---|---|
| `accounts` | Auth collection, `createRule=null` (mig 1700000036) — no privilege escalation pubblica |
| `concorsi` | Esposta pubblicamente solo se `stato=ATTIVO && iscrizioni_aperte` |
| `commissari`, `candidati`, `fasi`, `candidati_fase` | Struttura concorso |
| `valutazioni` | Unique `(candidato_fase, commissario, criterio)` (mig 1700000038), update solo proprio commissario |
| `sezioni`, `categorie`, `commissioni` | Tassonomia + assegnazione |
| `iscrizioni` | Form pubblico — `createRule` pubblica + hook server-side per validazione |
| `audit_log` | **Append-only** — `updateRule=null`, `deleteRule=null` (mig 1700000037) |
| `tenants` | Solo sul PB platform (super admin) — SMTP password cifrate at-rest |
| `enti`, `enti_public` | Dati ente + branding pubblico (logo/nome) |
| `fase_runtime` | Stato timer fase per SSE realtime |

## 3. Hook server-side (`pb_hooks/`)

| File | Cosa fa |
|---|---|
| `iscrizioni.pb.js` | Validazione iscrizione (stato concorso, consensi, minore→tutore), rate-limit IP (3/h, 10/giorno), honeypot, min-time-on-page. Email su create/update di stato. |
| `accounts.pb.js` | Blocca `role/attivo/email/verified/commissario` per non-admin (anti self-promote). |
| `valutazioni.pb.js` | Clamp voto in `[0, fase.scala]` + rifiuto se fase=CONCLUSA (freeze medie). |
| `tenants.pb.js` | Cifra `smtp_password` con `$security.encrypt(val, GESTIMUS_SECRET_KEY)`, formato `enc:v1:<cipher>`. Endpoint `POST /api/admin/tenants/:id/smtp-decrypt` (solo superadmin) per consumo da `apply-ente-smtp.sh`. |
| `privacy.pb.js` | Endpoint GDPR export/erase. |
| `setup.pb.js` | `GET /api/setup/has-admin` (probe primo avvio) + `POST /api/setup/create-admin` (idempotente). |

### Variabili d'ambiente

| Var | Default | Dove |
|---|---|---|
| `GESTIMUS_SECRET_KEY` | (non impostata) | `/etc/pb/platform.env` su prod. Senza, le SMTP password restano in chiaro con warning. |

## 4. Verifica

- Admin UI: `http://127.0.0.1:8090/_/` — in produzione raggiungibile **solo da localhost** (vedi DEPLOY-IONOS.md).
- File upload: `http://<pb-url>/api/files/<collection>/<record_id>/<filename>`.

## Note

- **Backup**: copia `pb_data/` per backup completo. In produzione usa `scripts/backup-all-tenants.sh` (restic).
- **Reset locale**: elimina `pb_data/` e riavvia.
- **Test unit** (no PB): `npm run test:unit` esegue `node --test` su `tests/unit/`.
