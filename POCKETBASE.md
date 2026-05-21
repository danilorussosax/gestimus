# PocketBase setup

Il gestionale può migrare i dati su [PocketBase](https://pocketbase.io) — un backend leggero (single binary Go + SQLite) con admin UI integrata, API REST, file uploads e realtime.

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

## 2. Crea le collezioni

Hai due opzioni.

### A) Auto-migration (consigliata)
Il file `pb_migrations/1700000001_init.js` viene eseguito automaticamente all'avvio di PocketBase, se la cartella si trova accanto al binario o nella working directory. Per essere certi:

```bash
./pocketbase/pocketbase serve --migrationsDir ./pb_migrations
```

Le 6 collezioni (`concorsi`, `commissari`, `candidati`, `fasi`, `candidati_fase`, `valutazioni`) vengono create al primo run.

### B) Setup manuale via API admin
Se preferisci uno script Node:

```bash
node scripts/setup-pb.js admin@example.com TUA_PASSWORD
```

Lo script si autentica come admin e crea le collezioni se non esistono già. Richiede Node.js ≥ 18 (usa `fetch` nativo).

## 3. Migra i dati esistenti

Una volta che PocketBase è raggiungibile e le collezioni sono create:

1. Apri l'app (`npm start` oppure `python3 -m http.server 8000` nella root del progetto, poi http://localhost:8000).
2. Sulla home apparirà un riquadro **"Migra a PocketBase"** quando: PB è raggiungibile, contiene 0 record, e in `localStorage` ci sono dati locali.
3. Clicca **"Migra ora"** — l'app spinge concorsi, fasi, commissari, candidati, candidati_fase e valutazioni nelle relative collezioni PB. Foto/CV (base64) vengono caricati come file binari.
4. Al termine vedi il conteggio per ogni tabella e un link all'admin UI per verificare.

## 4. Verifica

- Apri http://127.0.0.1:8090/_/, scheda **Collections** → vedi le 6 tabelle popolate.
- Le foto/CV sono accessibili via URL `http://127.0.0.1:8090/api/files/COLLECTION_ID/RECORD_ID/FILENAME`.

## Note

- **Runtime attuale**: l'app continua a leggere/scrivere su `localStorage`. PocketBase contiene una **copia migrata**. Se vuoi che PocketBase diventi il backend a runtime (CRUD diretti sull'API PB), chiedi la Fase B.
- **Reset dati**: per ripulire PB, elimina la cartella `pb_data/` (creata accanto al binario) e riavvia.
- **Backup**: copia la cartella `pb_data/` per backup completo.
