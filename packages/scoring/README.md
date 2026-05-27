# @gestimus/scoring

Logica di **scoring** (media pesata, metodi di aggregazione) e **tiebreak**
(cascata scomposizione → presidente → età → ex aequo) condivisa tra `frontend/`
e `server/`. **Single source of truth**: prima esisteva un port duplicato lato
server (`server/src/lib/scoring.ts` + `tiebreak.ts`) che rischiava di divergere.

Pure functions, nessun I/O / DOM → usabile sia nel bundle React sia nel server
Node (NodeNext). I consumer importano:

```ts
import { mediaCandidato } from '@gestimus/scoring/scoring';
import { rankWithTieBreak, computeAdmittedIds } from '@gestimus/scoring/tiebreak';
```

- `frontend/src/lib/{scoring,tiebreak}.ts` re-esportano da qui (consumer invariati).
- `server/src/lib/scoring-verify.ts` lo usa per ricalcolare/verificare la classifica.

## Build

Il package compila in `dist/` (gitignored). I consumer lo linkano via
`file:../packages/scoring` e ne importano il `dist/` compilato → **va buildato
prima** di server/frontend.

```bash
cd packages/scoring && npm install && npm run build
```

NB: niente script `prepare` di proposito — farebbe fallire `npm ci` di
server/frontend (che esegue il `prepare` del file: dep prima che typescript sia
installato nel package → `tsc: command not found`). La build è quindi esplicita.
CI e `deploy/install.sh` eseguono questo step prima della build di server/frontend.
Modificando `src/`, ricompilare (e rilanciare i test di entrambi i lati).
