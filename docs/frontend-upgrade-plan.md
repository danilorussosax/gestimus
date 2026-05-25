# Piano di Miglioramento Frontend — Gestimus
## Brief per AI Agent: Frontend Robustness Upgrade (7.0 → 8.5+)

---

> ## ⚠️ DOCUMENTO SUPERATO (2026-05-25)
>
> Questo piano è stato scritto per il vecchio frontend **vanilla JS** (`js/`,
> hash routing, `tsc --checkJs`). Quel frontend è stato **sostituito** dalla
> migrazione a **React 19 + Vite + TS + Tailwind + TanStack Query** (vedi
> `frontend/`). La maggior parte degli obiettivi è già realizzata dalla nuova
> architettura:
>
> | Obiettivo | Stato in React |
> |---|---|
> | O2 Bundler (minify/tree-shake/hash) | ✓ Vite |
> | O4 Code-splitting per rotta | ✓ `lazy()` + Suspense su tutte le rotte |
> | O1 Lazy-load dati (no `loadAll`) | ✓ TanStack Query per-vista (31 file) |
> | O3 State mgmt / race / cancel | ✓ Query (dedup, cache, abort) |
> | O5 Security headers + CSP | ✓ `@fastify/helmet` (CSP per-frontend) |
> | O6 SW asset pipeline | ✓ `vite-plugin-pwa` (Workbox) |
>
> **Unico gap reale residuo** (metrica O2/§6 "JS iniziale < 200KB"): il bundle
> iniziale caricava eager lo stack PDF (jspdf+html2canvas+canvg) e librerie
> usate solo on-demand. **Risolto**: dynamic import del PDF + manualChunks
> ridotto al solo core React → eager iniziale **602KB → 285KB gz**, con
> jspdf/recharts/html2canvas spostati in chunk lazy.
>
> Le fasi A–G sotto si riferiscono al vanilla e **non vanno eseguite** così
> come sono. Tenuto come storico.

---

### 1. Contesto Attuale (NON MODIFICARE)

- **Stack**: Frontend vanilla JavaScript (zero framework), ~23.000 LOC in `js/`, 46 file
- **Type Safety**: `tsc --checkJs strict` su tutto `js/` (gate CI) — `strictNullChecks` + `noImplicitAny`. Zero `@ts-ignore`. Tipi via JSDoc + cast DOM
- **Architettura**: SPA con hash routing (`js/app.js`). Data layer centralizzato in `js/db.js` con stato globale in memoria + pattern write-through + Set di subscriber per notifiche alle view
- **Build**: ZERO. File JS serviti direttamente da Fastify static. Niente bundler, niente minification, niente tree-shaking
- **API Client**: `js/api.js` — fetch con timeout (30s), retry backoff su 502/503/504 e network error, solo metodi idempotenti. `AbortController` per timeout
- **PWA**: Service Worker con strategia ibrida (network-first JS/navigate, stale-while-revalidate asset, API mai in cache). Precache completo. Manifest presente
- **i18n**: Loader `js/i18n.js` + dizionari splittati per lingua (`js/i18n/{it,en,fr,es}.js`). CI enforcement parità chiavi
- **Sicurezza client**: `escapeHtml` usata nei template manuali. Nessuna CSP. Nessun `X-Frame-Options` client-side

### 2. Problemi Specifici da Risolvere

| # | Problema | Impatto | File coinvolti |
|---|---|---|---|
| P1 | `db.loadAll` carica **tutti** i dati del tenant in memoria all'avvio (concorsi, candidati, valutazioni, commissari, sezioni, categorie, commissioni, accounts, sale, eventi, criteri) | O(N) memoria e tempo di caricamento crescono linearmente con il tenant. Bottleneck su tenant grandi | `js/db.js` |
| P2 | **Nessun bundler/build**: niente minification, tree-shaking, hash nei filename per cache-busting. Dipendenza dal versioning manuale del Service Worker | Cache invalidation fragile, payload di rete più grande del necessario, niente ottimizzazione dead-code | `sw.js`, tutti `js/**/*.js` |
| P3 | **State management primitivo**: oggetto globale `state` mutabile + `Set` di subscriber. Nessuna struttura immutabile, nessun undo/redo, race condition su caricamenti multipli possibili | Bug difficili da riprodurre, stato inconsistente, leak di subscriber, nessuna devtool di debug | `js/db.js`, `js/app.js` |
| P4 | **Nessun code-splitting**: tutte le view vengono importate staticamente in `js/app.js` | Caricamento iniziale lento anche se l'utente visita solo una pagina | `js/app.js` |
| P5 | **Mancanza di CSP client-side**: nessuna `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy` | Vulnerabilità XSS reflected / clickjacking / data leak via referrer | Response HTTP (server-side) |

### 3. Obiettivi del Piano

- **O1**: Ridurre il caricamento iniziale dei dati da "tutto" a "solo ciò che serve alla vista corrente" (lazy-load per-vista)
- **O2**: Introdurre un bundler (Vite) per minification, tree-shaking, hash per cache-busting, senza rompere il type-check `checkJs strict`
- **O3**: Migliorare il state management: prevenire race condition, introdurre struttura a store con actions, preservare il pattern write-through
- **O4**: Implementare code-splitting dinamico delle view (import() on-demand)
- **O5**: Aggiungere security headers HTTP via server (`helmet` o manualmente) e una CSP restrittiva
- **O6**: Mantenere il Service Worker funzionante con il nuovo asset pipeline (i file JS avranno hash nei nomi)

### 4. Fasi Incrementali (ordine obbligatorio)

#### FASE A: Preparazione — Tooling e Struttura (bloccante per tutto il resto)
**Goal**: Setup Vite senza rompere `checkJs strict` né la runtime attuale.

**Task A1**: Inizializzare Vite nella root del progetto (non in `server/`)
- Entry point: `index.html` (già esistente)
- Source dir: `js/` + `css/`
- Output dir: `dist/` (gitignored)
- Configurare `vite.config.js`:
  - `build.rollupOptions.input`: `index.html`
  - `build.outDir`: `dist`
  - `build.assetsDir`: `assets`
  - `build.sourcemap`: `true` (per debug produzione)
  - `build.minify`: `terser` (produzione), `false` (sviluppo per velocità)
  - `build.rollupOptions.output.entryFileNames`: `js/[name]-[hash].js`
  - `build.rollupOptions.output.chunkFileNames`: `js/[name]-[hash].js`
  - `build.rollupOptions.output.assetFileNames`: (assetInfo) => { const info = assetInfo.name.split('.'); ... } per separare CSS/immagini

**Task A2**: Migrare le import nel `index.html`
- Rimuovere i `<script type="module" src="js/app.js">` e tutti gli altri tag script dal `index.html`
- In `index.html`, mantenere solo un `<script type="module" src="/js/app.js"></script>` (Vite lo risolverà)
- Nota: `index.html` fa riferimento a CDN (Tailwind, jspdf, marked, ecc.) — NON bundlare quelli. Lasciali come `<script src="cdn...">` esterni. Vite deve ignorarli (mettere in `optimizeDeps.exclude` se necessario).

**Task A3**: Aggiungere la risoluzione dei moduli
- Tutti i file in `js/` usano path relativi (`./db.js`, `./views/admin/fasi.js`). Vite li risolve nativamente con ESM. Verificare che non ci siano path assoluti che rompono.
- Gli ambient globali (es. `jspdf`, `marked`) sono referenziati in `js/globals.d.ts`. Aggiungere `/// <reference types="./js/globals.d.ts" />` o configurare `tsconfig.frontend.json` per includere il nuovo setup.

**Task A4**: Aggiornare `tsconfig.frontend.json`
- Assicurarsi che `tsc -p tsconfig.frontend.json` continui a passare (0 errori) con il nuovo setup Vite. Potrebbe essere necessario aggiungere `"moduleResolution": "bundler"`.

**Task A5**: Aggiornare il server per servire `dist/`
- In `server/src/app.ts`, cambiare il path dello static handler da `projectRoot` a `resolve(projectRoot, 'dist')` quando `NODE_ENV === 'production'`.
- In dev, `npm run dev` nel frontend lancia Vite dev server (proxy verso Fastify :4000) oppure Fastify serve `projectRoot` come ora (entrambi i modi sono accettabili, ma preferibile proxy Vite → Fastify per HMR).

**Criterio di accettazione A**:
- `npm run build` (frontend) genera `dist/` con file JS hashed
- `npm run dev` (frontend) avvia Vite dev server con HMR
- `tsc -p tsconfig.frontend.json` → 0 errori
- `node --check` su tutti i file JS → 0 errori
- Gli E2E Playwright continuano a passare (24/24)

---

#### FASE B: Code-Splitting View (lazy-load per rotta)
**Goal**: Caricare le view solo quando l'utente naviga su quella rotta.

**Task B1**: Identificare le view importate staticamente in `js/app.js`
- Lista completa delle import: `renderHome`, `renderAdmin`, `renderCommissario`, `renderLogin`, `renderIscrizione`, `renderPrivacy`, `renderCalendarioPubblico`, `openAccountSecurity`, `renderDashboard`, `renderImpostazioni`, `renderUsers`, `renderStats`, `renderManuale`, `renderSuperadmin`, ecc.

**Task B2**: Convertire ogni view in import dinamico
- Sostituire `import { renderX } from './views/x.js'` con `const renderX = async () => { const m = await import('./views/x.js'); return m.renderX; }`
- Creare una `viewRegistry` che mappa rotte → loader function:
```js
const views = {
  home: () => import('./views/home.js'),
  admin: () => import('./views/admin.js'),
  commissario: () => import('./views/commissario.js'),
  // ...
};
```

**Task B3**: Implementare prefetch intelligente
- Dopo il login, pre-fetch delle view probabili (es. se role=admin, prefetch `admin-dashboard`, `admin-fasi`)
- Non bloccare il render iniziale con il prefetch

**Task B4**: Gestire il loading state durante l'import dinamico
- Mostrare uno spinner in `root` mentre il chunk JS si scarica

**Criterio di accettazione B**:
- Il Network tab mostra un solo chunk JS all'avvio (app + db + api + utils core)
- Navigando su `#/admin` si scarica un chunk aggiuntivo `admin-[hash].js`
- Navigando su `#/commissario` si scarica un chunk aggiuntivo
- Le view superadmin e admin non vengono caricate se l'utente è un semplice commissario
- Lighthouse "Performance" score migliora (riduzione JS iniziale)

---

#### FASE C: Lazy-Load Dati (spezzare db.loadAll)
**Goal**: Non caricare tutti i dati del tenant all'avvio.

**Task C1**: Identificare i dati necessari per ogni view
- `home` (pubblica): solo `ente_public`, eventualmente concorso con iscrizioni aperte
- `login`: nessun dato (solo form)
- `admin-dashboard`: concorsi, conteggi rapidi
- `admin-candidati`: candidati del concorso attivo + sezioni + categorie
- `commissario`: fasi attive + valutazioni del commissario loggato
- `superadmin`: lista tenant (richiede API separata `/api/platform/tenants`)

**Task C2**: Aggiungere endpoint API se necessari
- Verificare che esistano endpoint paginati o filtrati per ogni necessità. Se mancano (es. GET `/api/candidati?concorsoId=xxx&limit=50`), aggiungerli nel backend. Usare la paginazione esistente (`parsePagination`).
- Aggiungere endpoint `GET /api/me/entita` che ritorna solo i dati minimi necessari per la vista corrente (opzionale — può essere fatto lato client con query string).

**Task C3**: Rifattorizzare `js/db.js`
- Rimuovere `loadAll()` o renderlo opzionale (per retro-compatibilità)
- Aggiungere metodi granulari:
  - `db.loadDashboard()` → carica solo concorsi + conteggi
  - `db.loadCandidati(concorsoId)` → carica candidati filtrati
  - `db.loadFasiCommissario(commissarioId)` → carica fasi + candidati_fase + criteri
  - `db.loadValutazioni(...)` → on-demand
- Ogni metodo scrive nel `state` globale (preservando le viste esistenti) e chiama `notify()`

**Task C4**: Aggiornare le view per chiamare i loader specifici
- In ogni `renderX(root)`, all'inizio chiamare il loader appropriato
- Se i dati sono già in `state` (cache), non ricaricare (semplice check esistenza)

**Task C5**: Aggiungere cache TTL e invalidazione
- Aggiungere un campo `_loadedAt` per ogni entità in `state`
- Se i dati sono più vecchi di X minuti, ricaricare in background
- Invalidazione esplicita dopo mutazioni (create/update/delete) — già parzialmente presente con write-through

**Criterio di accettazione C**:
- All'avvio come admin, il Network tab mostra **al massimo 3-4 chiamate API** (ente, concorsi, account/me), non 15+ chiamate per caricare tutto
- Navigando su "Candidati" si fa una chiamata dedicata `GET /api/candidati?concorsoId=...`
- Navigando su "Valutazioni" si caricano i dati specifici della fase
- Il frontend non crasha se i dati di una view non ancora visitata sono assenti (graceful degradation)
- Per tenant demo (centinaia di candidati), il tempo di "Time to Interactive" si riduce di almeno il 30%

---

#### FASE D: State Management Rinforzato
**Goal**: Eliminare race condition e rendere il reattivo più robusto.

**Task D1**: Identificare le race condition
- Cercare pattern dove una view fa una chiamata API e, nel frattempo, l'utente naviga via → il callback scrive su `root` che ora appartiene a un'altra view
- Cercare caricamenti multipli simultanei che sovrascrivono lo stesso `state` (es. due tab diverse)

**Task D2**: Implementare un micro-store pattern
- Creare `js/store.js` con una classe `Store`:
```js
class Store {
  constructor() { this._state = empty(); this._subs = new Set(); this._loading = new Map(); }
  getState() { return this._state; }
  setState(partial) { this._state = { ...this._state, ...partial }; this._notify(); }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  // AbortController associato a ogni chiave di caricamento
  async load(key, promiseFactory) { /* cancella precedente, registra nuovo */ }
}
```
- NON migrare tutto a Redux/ Pinia — mantenere il codice vanilla. Il goal è robustezza, non cambiare paradigma.

**Task D3**: Aggiungere guard di navigazione
- In `js/app.js`, prima di cambiare rotta, annullare tutti i `AbortController` attivi della vecchia view
- Ogni view che fa chiamate async deve passare un `signal` (AbortController.signal) alle API

**Task D4**: Aggiornare `api.js` per supportare AbortController
- Il `request()` in `js/api.js` già usa `AbortController` per timeout. Estendere per accettare un `signal` esterno opzionale:
```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
// Se opts.signal passato, collegarlo
if (opts?.signal) opts.signal.addEventListener('abort', () => controller.abort());
```

**Criterio di accettazione D**:
- Se navigo rapidamente tra 3 tab, il Network tab mostra le chiamate delle tab precedenti cancellate (status "canceled")
- Nessun errore `"Cannot set properties of null"` (tentativo di scrivere su un DOM smontato)
- Il subscriber pattern non perde notifiche anche con unsubscribe durante l'iterazione (già parzialmente gestito con `notifying` guard, ma verificare che funzioni con il nuovo store)

---

#### FASE E: Service Worker + Asset Pipeline
**Goal**: Lo SW deve funzionare con i file JS hashed prodotti da Vite.

**Task E1**: Sostituire il precache statico con un precache generato da Vite
- Usare il plugin `vite-plugin-pwa` (Workbox) oppure generare un manifest di precache dal build output
- Se si usa `vite-plugin-pwa`: configura `workbox.precacheAndRoute(self.__WB_MANIFEST)` — Workbox gestisce automaticamente il precache dei file hashed
- Se si mantiene lo SW custom: generare una lista di asset dal build e iniettarla nello SW (usando `@surma/rollup-plugin-off-main-thread` o un semplice script post-build che legge `dist/` e scrive `self.__PRECACHE_MANIFEST = [...]`)

**Task E2**: Aggiornare la strategia del SW
- Per asset hashed (JS/CSS con hash nel nome): **cache-first** (i nomi cambiano a ogni build → il vecchio file non viene mai richiesto)
- Per `index.html`: **network-first** (deve sempre essere fresco per i riferimenti agli asset)
- Per API: **network-only** (già così, mantenere)
- Per CDN esterni: **stale-while-revalidate** (mantenere)

**Task E3**: Gestione degli update del SW
- Mantenere la logica attuale: `skipWaiting`, `clients.claim`, messaggio `SW_UPDATED` alle tab aperte
- Assicurarsi che il nuovo `index.html` punti sempre agli asset corretti (Vite lo fa automaticamente inserendo gli hash)

**Criterio di accettazione E**:
- Dopo `npm run build`, il Service Worker precache correttamente tutti i file in `dist/`
- Il Lighthouse PWA audit passa (almeno 90/100)
- Offline: navigare su diverse view funziona (i chunk JS delle view visitate sono in cache)
- Un deploy nuovo (nuovi hash) forza l'update non bloccante

---

#### FASE F: Security Headers (Client & Server)
**Goal**: Aggiungere CSP e altri header di sicurezza.

**Task F1**: Aggiungere `@fastify/helmet` o configurare manualmente gli header in `server/src/app.ts`
```js
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // inline scripts nel legacy vanilla — da migrare a nonce/hash in futuro
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com"],
      imgSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"], // anti-clickjacking
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
```
- **Nota importante**: `'unsafe-inline'` per `scriptSrc` è necessario perché il frontend vanilla usa `<script>` inline nel `index.html` e possibili event handler inline. Valutare se Vite ha già rimosso gli inline.
- Se Vite genera solo script esterni (module), provare a togliere `'unsafe-inline'` e usare `nonce` generato dal server.

**Task F2**: Aggiornare il CSP per CDN e asset
- Whitelistare i CDN usati: `cdn.tailwindcss.com`, `cdn.jsdelivr.net` (se usato), eventuali font
- Aggiungere `upgrade-insecure-requests` se il sito è sempre HTTPS

**Task F3**: Aggiungere `X-Frame-Options: DENY` o `SAMEORIGIN`
- `helmet` lo fa automaticamente. Verificare che non rompa embedding legittimi (non ce ne sono).

**Criterio di accettazione F**:
- SecurityHeaders.io o Mozilla Observatory ritorna almeno **B+** (preferibilmente A)
- Nessun errore CSP nei browser moderni (controllare DevTools console)
- Il caricamento dei CDN (Tailwind, jspdf, marked) non è bloccato dalla CSP

---

#### FASE G: Monitoraggio Frontend + DevEx (Opzionale ma raccomandato)
**Goal**: Migliorare la developer experience e la diagnostica.

**Task G1**: Aggiungere Sentry o LogRocket (opzionale per ora)
- Per il MVP: almeno un `window.onerror` e `window.onunhandledrejection` che loggano sul server (`POST /api/client-log`) con rate-limit

**Task G2**: Aggiungere un performance budget
- Lighthouse CI o almeno un check manuale: JS iniziale < 200KB gzipped, TTI < 3s su connessione 4G

**Task G3**: Sourcemap in produzione
- Vite genera sourcemap. Servirle solo con autenticazione o tramite Sentry (non pubbliche).

---

### 5. Conflitti e Vincoli da Rispettare

1. **NON rompere il type-check strict**: `tsc -p tsconfig.frontend.json` deve rimanere a 0 errori dopo ogni fase
2. **NON rompere gli E2E**: i 24 test Playwright devono continuare a passare. Se cambi ID/selector DOM, aggiorna i test
3. **NON cambiare il backend** (se non per Task C2 dove servono nuovi endpoint API — ma quelli sono aggiunte, non breaking changes)
4. **Mantenere il Service Worker funzionante**: la PWA è un requisito, non può rompersi
5. **Mantenere la compatibilità con il data layer esistente**: le view usano `db.state.xxx`. Non cambiare la shape dello state se possibile. Aggiungere metodi, non rimuovere.
6. **Mantenere le CDN**: non spostare jspdf, marked, Tailwind nel bundle (sono grandi e non necessarie per il core). Vite deve ignorarle.

### 6. Metriche di Successo Finali

| Metrica | Attuale (stimato) | Target |
|---|---|---|
| JS iniziale scaricato | ~600-800KB (tutti i file vanilla, non minified) | < 200KB gzipped (solo core + view home/login) |
| Chiamate API all'avvio | ~15 (db.loadAll) | < 4 |
| Time to Interactive | ~4-6s | < 3s su 4G |
| Lighthouse Performance | ~60-70 | > 85 |
| Lighthouse PWA | ~90 | > 90 (mantenere) |
| Security Headers | F (nessuno) | B+ o superiore |
| `tsc` errors | 0 | 0 (mantenere) |
| E2E pass | 24/24 | 24/24 (mantenere) |
| Server test pass | 154/154 | 154/154 (mantenere) |

### 7. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Vite rompe `checkJs strict` (es. moduleResolution cambia) | Media | Alta | Testare subito in Fase A1, fallback a `", 