# Gestimus — Test & verifica

Riferimento di tutta la suite di test del progetto: cosa copre, come si lancia,
i prerequisiti, i risultati attesi e i gate CI.

## Piramide

| Livello | Dove | Cosa | Conteggio |
|---|---|---|---|
| **Unit** | `tests/unit/` | logica pura: scoring (medie), tiebreak (spareggi), rng (sorteggio) | 47 |
| **Server (integrazione)** | `server/tests/` | RLS, auth, 2FA, trigger DB, crypto, concorrenza, route, calendario, GDPR su **Postgres reale** | 154 |
| **E2E** | `tests/e2e/` | flussi browser end-to-end (Playwright) | 9 spec / 24 test |
| **Type-check** | `tsconfig.frontend.json` + `server` | `tsc --checkJs strict` su tutto `js/`; `tsc` strict sul backend | gate |
| **Load** | `tests/load/` | throughput/latenza letture e scritture (autocannon) | on-demand |

Tutti i livelli (tranne il load) girano in **CI** a ogni push (vedi §CI).

---

## Prerequisiti

- **Node 22 LTS**, **PostgreSQL 18** (le PK usano `uuidv7()` nativo).
- DB inizializzato: in `server/` → `npm run db:setup && npm run db:seed`.
- Per gli E2E/load: `/etc/hosts` mappa i sottodomini:
  ```
  127.0.0.1  platform.gestimus.local
  127.0.0.1  ente1.gestimus.local
  127.0.0.1  ente2.gestimus.local
  ```
- (Opzionale) PgBouncer in transaction mode: vedi `DEPLOY-IONOS.md` §6-bis. La
  suite gira sia diretta su :5432 sia via PgBouncer (l'isolamento RLS regge in
  entrambi i casi).

---

## 1. Unit (no DB)

```bash
npm run test:unit          # root → node --test tests/unit/**/*.test.mjs
```
Copre la matematica del dominio: 5 metodi di media (aritmetica/olimpica/winsorizzata/
mediana/dev-std), tiebreak deterministico, RNG sorteggio (mulberry32 seedato).
**47 test, ~30 ms.** È il layer giusto per lo scoring (non l'E2E).

## 2. Server / integrazione (Postgres reale)

```bash
cd server
npm test                   # tutto: rls + auth + crud + realtime
npm run test:rls           # isolamento tenant (RLS FORCE + WITH CHECK + trigger coerenza)
npm run test:auth          # login/logout/sessione + 2FA TOTP + cross-tenant guard
npm run test:crud          # CRUD entità + trigger + privacy/GDPR + calendario + cleanup + platform
npm run test:realtime      # LISTEN/NOTIFY → SSE
```
**154 test / 16 suite, 0 fail.** Girano `createApp()` reale + `app.inject` su un
Postgres locale. Coprono fra l'altro:
- **RLS**: ogni tabella tenant isolata; scrittura cross-tenant rifiutata a 2 strati
  (trigger di coerenza tenant **prima** della RLS `WITH CHECK` — difesa in profondità).
- **Trigger DB**: clamp voto, freeze fase CONCLUSA, no-resurrection fase, coerenza tenant.
- **GDPR**: export (Art. 20) + erase (redaction PII + cancellazione allegati file+righe).
- **Concorrenza**: advisory lock `numeroCandidato`, upsert valutazioni, TOCTOU.

## 3. E2E (Playwright)

Richiede il server avviato (la config lo avvia se assente, o riusa quello su :4000)
+ hosts + seed.
```bash
npm run test:e2e                       # tutti gli spec
npx playwright test display.spec.js    # un singolo spec
```
**9 spec / 24 test:**

| Spec | Copre |
|---|---|
| `smoke` | render login, skip-link, manifest/SW, healthz, no-errori Cmd+K |
| `multitenant` | login 3 ruoli, isolamento tenant, credenziali errate |
| `auth` | persistenza sessione, logout, pagine pubbliche, no-errori-JS |
| `admin-crud` | crea sezione via UI, apre import CSV |
| `calendario` | tab calendario, crea sala, pagina pubblica read-only |
| `display` | tabellone: header/footer nascosti, board renderizzata |
| `iscrizione` | form pubblico anti-bot (honeypot off-screen + min-time), validazione |
| `fase-flow` | setup fase via API → avvio → classifica in Risultati → conclusione |
| `gdpr` | export Art. 20 (admin 200 + struttura; no-auth 401/403) |

> Nota: la matematica scoring sta sugli unit test; gli E2E coprono l'**integrazione**
> (UI ↔ API ↔ DB). Il voto live commissario→media via UI è un'aggiunta E2E ancora aperta.

## 4. Type-check (gate)

```bash
# Frontend: checkJs STRICT su tutto js/ (strictNullChecks + noImplicitAny + …)
npx tsc -p tsconfig.frontend.json
# Backend: strict
cd server && npm run lint            # tsc -p tsconfig.lint.json
```
Entrambi devono dare **0 errori**. Tipi via JSDoc + cast; globals CDN in `js/globals.d.ts`.

## 5. Load test (on-demand)

Strumenti in `tests/load/` (autocannon). Prerequisito: server **compilato** su una
porta dedicata (numeri realistici, non `tsx watch`):
```bash
cd server && npm run build
PORT=4001 node dist/index.js &        # server prod-like su :4001 (DB via .env, anche PgBouncer)
```
Poi dalla root:
```bash
node tests/load/load.mjs        [conn] [sec]   # letture: healthz, public, auth hot-path + sweep
node tests/load/load-write.mjs  [conn] [sec]   # scritture voti: SPREAD vs CONTENTION
```

### Risultati di riferimento (host condiviso, dataset dev, via PgBouncer)

**Letture** — `GET /api/concorsi` (RLS + sessione):

| conn | req/s | p99 | errori |
|--:|--:|--:|--:|
| 50 | ~5.200 | 11 ms | 0 |
| 200 | ~5.050 | 50 ms | 0 |
| 400 | ~4.850 | 96 ms | 0 |

baseline `/healthz` ~29.000 req/s; `public read` 429 by design (rate-limit 60/min/IP).

**Scritture** — `POST /api/valutazioni` (upsert, `FOR UPDATE` + `ON CONFLICT`):

| Pattern | 50 conn | 200 conn | errori |
|---|--:|--:|--:|
| SPREAD (righe diverse) | ~4.400 voti/s · p99 16ms | ~3.950 · p99 81ms | 0 |
| CONTENTION (stessa riga) | ~2.860 voti/s · p99 44ms | ~2.745 · p99 103ms | 0 |

**Lettura dei numeri**: throughput plateau, degrado **lineare** della latenza, **zero
errori/deadlock/timeout** fino a 400 (letture) / 200 (scritture) connessioni. Il tier
applicativo regge ordini di grandezza sopra il carico atteso → il vincolo di scala è
il **disco** (storage foto/CV/allegati), non CPU/throughput né i lock.

**Caveat onesti**: load generator + server + Postgres + PgBouncer sullo **stesso host**
(prod dedicata = più veloce); dataset dev **piccolo** (query economiche); il load test
scrive righe reali su una fase di test → ripulibili con `npm run db:reset`. **Non ancora
misurato**: scaling delle connessioni **SSE** del giudizio live (stream long-lived).

---

## CI (GitHub Actions)

A ogni push su `main` girano 8 job (tutti verdi richiesti per il merge):

1. **Lint JavaScript** (sintassi `node --check` su tutto `js/`)
2. **Typecheck frontend (checkJs STRICT, tutto js/)**
3. **Lint Bash** (shellcheck su `scripts/` + `deploy/`)
4. **Validate SQL migrations**
5. **i18n coverage** (chiavi usate definite in IT + parità EN/FR/ES)
6. **Lint server** (`tsc --noEmit` strict)
7. **Server tests (Postgres 18)** (bootstrap + setup + seed + suite completa)
8. **Audit dimensioni file** (no file > 5 MB nel repo)

> Gli **E2E** e i **load test** non girano in CI (richiedono hosts + server avviato);
> si lanciano in locale.

---

## Verifica rapida "tutto verde" in locale

```bash
npm run test:unit                                  # 47/47
( cd server && npm run lint && npm test )          # tsc ok · 154/154
npx tsc -p tsconfig.frontend.json                  # 0 errori (frontend strict)
# (server avviato + hosts + seed) →
npm run test:e2e                                   # 24/24
```
