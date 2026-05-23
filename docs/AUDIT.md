# Gestimus — Audit di robustezza del codice

> **Data**: 2026-05-23
> **Commit**: branch `main` (post Rianalisi 9 — CI e suite test verdi)
> **Scope**: frontend vanilla JS (`js/`, ~20.700 LOC) + backend Fastify/Drizzle (`server/src/`, ~7.400 LOC) + 21 route REST + 14 migrazioni SQL.
> **Contesto**: l'audit segue 5 round di bugfix (C1-C13, H1-H12, M1-M22, L1-L16, N1-N50), 5 fasi di consolidamento e tre round di rianalisi (N51-N84 + A1/A2; N85-N94; N95-N104). In totale ~130 problemi di sicurezza/correttezza/performance chiusi.

---

## 1. Valutazione complessiva

| Dimensione | Voto | Sintesi |
|---|:---:|---|
| Sicurezza | 🟢 Alto | RLS per-tenant `FORCE`, Argon2id, AES-GCM, input Zod, ownership cross-entità validata, limiti piano applicati |
| Integrità dati | 🟢 Alto | RLS + trigger DB + CHECK constraint + transazioni con lock + normalizzazione pesi esatta |
| Concorrenza | 🟢 Alto | Advisory lock + FOR UPDATE + ON CONFLICT + UPDATE condizionati (no TOCTOU), **provati da test** |
| Affidabilità runtime | 🟢 Alto | `/readyz` con ping DB, pool error listener, handler globali, shutdown idempotente con timeout, no transporter/canali orfani |
| Performance/scalabilità | 🟢 Alto | **Paginazione su tutti i list endpoint**, **export GDPR in streaming**, cache tenant, indici FK |
| Test coverage | 🟢 Alto | Suite server in CI su Postgres 18 (rls/auth/crud/realtime/concorrenza/**route**) + 47 unit |
| Manutenibilità | 🟢 Alto | Type-check `checkJs` sul core logico (gate CI), i18n deduplicato, separazione route/service/middleware |

**Giudizio**: base solida e ben difesa su tutti gli assi. Il debito residuo è puramente **evolutivo** (split file grandi, type-check esteso a tutto il frontend, lazy-load client), non correttezza né sicurezza, e non blocca l'uso attuale.

---

## 2. Architettura

- **Frontend**: SPA vanilla JS, hash-routing, service worker PWA, realtime via SSE. Data layer centralizzato in `js/db.js` (stato in memoria + write-through verso `/api`).
- **Backend**: singolo processo Node 22 + Fastify 5 + Drizzle ORM su PostgreSQL. TypeScript strict.
- **Multitenancy**: logica via `tenant_id` + **Row-Level Security**. Un solo DB condiviso, isolamento garantito dal database, non dall'applicazione.
- **Auth**: session cookie HttpOnly/SameSite, Argon2id, token sessione hashato SHA-256.

**Punto di forza**: l'isolamento tenant è a livello DB (RLS `FORCE`), quindi un bug applicativo che dimenticasse un `WHERE tenant_id` non causa data leak — Postgres rifiuta la query. Solo 4 file route usano `dbSuper` (bypass RLS, super-admin); gli altri usano `req.dbTx` (RLS-scoped).

---

## 3. Sicurezza

**Stato: forte.** Coperto in 5 round di hardening + rianalisi finale.

- **Isolamento**: RLS `ENABLE + FORCE` su tutte le tabelle tenant, policy `tenant_id = current_setting('app.current_tenant')`. `REVOKE ALL` su tabelle platform (`tenants`, `platform_config`, `platform_audit_log`) dal ruolo applicativo.
- **Input**: validazione Zod su tutte le route; error handler globale che NON leakka i nomi dei campi interni (ZodError → 400 generico).
- **Ownership cross-entità** (rianalisi N51-N54, N62): le FK garantivano solo l'*esistenza* della riga referenziata, non l'appartenenza al tenant/concorso corrente. Ora validati server-side: criteri→fase del tenant (404 invece di FK violation 500), fasi→sezioni dello stesso concorso, account→commissario del tenant, commissione→presidente dello stesso concorso.
- **Limiti piano** (N57): `tenant_config.max_concorsi/max_commissari/max_candidati_per_concorso` ora applicati nei rispettivi POST (`lib/plan-limits.ts`) → 403 al raggiungimento; limiti NULL = illimitato.
- **SQL injection**: nessuna interpolazione raw; `inArray`/parametri Drizzle. Canale SSE `LISTEN` validato con whitelist regex.
- **Auth**: Argon2id, no JWT in localStorage, sessione invalidata su mismatch cross-tenant, rate-limit su login/verify/logout/me.
- **Crittografia**: SMTP cifrato AES-GCM (no fallback plaintext), backup cifrati AES-256-GCM at-rest.
- **GDPR**: erase completo di tutti i PII su candidati/iscrizioni/commissari/accounts; export con redaction dei segreti (passwordHash/totp/emailVerificationToken).
- **Upload**: verifica magic bytes (non solo MIME dichiarato), path-traversal guard, e `DELETE /:resource/:id` (N61) che azzera la colonna logo/foto e cancella il file dal filesystem (anti-orfani), idempotente, con audit.
- **SMTP header injection**: nome tenant sanificato (strip CRLF).
- **DoS**: cap logo 1MB (letto su login non-auth), cap import CSV 500 righe, cap sample metriche, single-flight su `/system`, **ceiling su tutti i list endpoint** (paginazione, vedi §6).
- **Privilege escalation**: trigger DB che vieta `role='superadmin'` fuori dal tenant platform; anti self-demote/self-disable; protezione ultimo admin.

**Residui**: nessuna vulnerabilità nota aperta. Dependabot: 0 alert.

---

## 4. Integrità dati

**Stato: forte.** Difesa a più livelli (DB + applicazione):

- **Trigger DB**: `clamp_voto`, `freeze_valutazioni_on_fase_conclusa`, `freeze_fase_state_transition` (no resurrezione fase), `enforce_superadmin_tenant`.
- **CHECK constraint**: voto ≥ 0, stato candidati_fase enum, `criteri_peso 0-100`, COMPLETATO ⇒ esito non-NULL.
- **Unique**: `(candidato_fase, commissario, criterio)`, `(fase, candidato)`, iscrizioni `(concorso, email)` parziale, commissari `(concorso, email)` parziale.
- **Transazioni**: permessi+mutazioni nella stessa tx con `FOR UPDATE`; criteri replace atomico; cleanup audit+delete atomico.
- **Normalizzazione pesi** (N58): i pesi criteri usano largest-remainder (Hamilton) invece di `Math.round()` → la somma è **sempre esattamente 100** (prima 3 pesi uguali potevano dare 99).
- **Tipi numerici** (scoperto in CI): `valutazioni.voto` allargato da `numeric(5,2)` a `numeric(6,2)` — la scala fase può arrivare a 1000 e causava overflow al binding *prima* del clamp.
- **Append-only**: `audit_log`/`platform_audit_log` senza UPDATE/DELETE per il ruolo app.

---

## 5. Concorrenza

**Stato: forte, provato da test.** Punti critici coperti:

- `numeroCandidato`: advisory lock unico condiviso tra create diretto e approve iscrizione.
- Upsert valutazioni: `ON CONFLICT DO UPDATE`.
- Start fase / candidati_fase: `ON CONFLICT DO NOTHING`.
- Reorder fasi: `FOR UPDATE` + validazione completezza.
- Cleanup tenant: `pg_advisory_xact_lock` globale.
- Ente PATCH: merge JSONB atomico server-side.
- **TOCTOU lifecycle tenant** (N55): suspend/reactivate/archive/restore mettono la condizione di stato nella `WHERE` dell'`UPDATE` → 409 se lo stato cambia tra SELECT e UPDATE, invece di crashare su `updated!` null.

Test dedicati (`tests/crud/concurrency.test.ts`): 20 create candidati concorrenti → numeri tutti distinti (N24); 10 upsert valutazioni concorrenti → nessun 23505, una sola riga finale (C2).

**Residuo**: la maggior parte dei lock è a grana di concorso/tenant — adeguata per il carico atteso (concorsi musicali, non alto volume).

---

## 6. Performance e scalabilità

**Stato: buono.** I due punti deboli storici (A1, A2) sono stati risolti.

- 🟢 **A1 — Paginazione completa**: `parsePagination` (limit/offset opzionali, cap `MAX_LIMIT=10000`) applicato a **tutti** i 13 list endpoint (candidati, commissari, iscrizioni, accounts, concorsi, sezioni, categorie, fasi, commissioni, criteri, valutazioni, candidati-fase, membri-gruppo). Nessuna query illimitata; default invariato per tenant realistici.
- 🟢 **A2 — Export GDPR in streaming**: la risposta JSON è scritta in streaming (`reply.hijack`) interrogando una tabella per volta → picco memoria = tabella più grande, non la somma delle 5. Niente più rischio OOM su tenant grandi.
- 🟢 **Indici**: cache LRU tenant (TTL 60s), indici su FK e colonne filtrate (N60 ha aggiunto `candidati`/`iscrizioni` su `sezione_id`/`categoria_id`, prima seq scan nei pre-check DELETE), bulk UPDATE sorteggio, loadAll parallelizzato, ring-buffer metriche.

**Residuo evolutivo**: il client carica ancora `db.loadAll` in memoria — adeguato ai volumi attesi; la migrazione a lazy-load per-vista è un'evoluzione successiva da validare in browser.

---

## 7. Test e CI

- **Unit** (root, `node --test`): 47 test su `scoring.js`/`rng.js`/`tiebreak.js` — media, tiebreak, suggerimenti, RNG sorteggio. Tutti verdi.
- **Server** (`node --test` + tsx): 129 test su 13 suite — `rls/isolation`, `auth/login`, `realtime/notify`, `crud/{smoke,triggers,privacy,storage,smtp,crypto-smtp,platform,cleanup,concurrency,routes}`. Coprono i meccanismi core (RLS, trigger, crypto), la concorrenza (§5) e le **route critiche**.
- **Route integration** (`tests/crud/routes.test.ts`): 8 test su transizioni di stato e permessi prima scoperti — conclude/start fuori sequenza → 409 (N21), sorteggio su CONCLUSA → 409 (N23), timer su fase mai avviata → 409 (N22), PUT criteri normalizza pesi a 100 (N34/N35), iscrizione senza privacy → 400 (N40), disattivazione ultimo admin → 403/409 (L16), commissario non setta stato ELIMINATO → 403 (N13).
- **E2E** (Playwright): 2 spec (smoke, multitenant).
- **CI**: job `Server tests (Postgres 18)` (bootstrap+setup+seed+suite completa ad ogni push), lint TS/JS, lint bash+shellcheck, validate SQL migrations, i18n coverage, type-check frontend core, audit dimensioni file. Verde su `main`.

**Gap chiuso rispetto all'audit precedente**: le route critiche (transizioni fase, permessi, GDPR) ora hanno test d'integrazione dedicati.

---

## 8. Manutenibilità

- ✅ Codice commentato (il *perché*, spesso con riferimento al bug ID), naming coerente, separazione route/service/middleware netta.
- ✅ TypeScript strict + Drizzle tipizzato lato server.
- ✅ `// @ts-check` + job CI `tsc --checkJs` sui moduli di logica pura (scoring/rng/tiebreak); il type-check ha scovato 15 chiavi i18n duplicate (deduplicate).
- ⚠️ File molto grandi lato frontend: `i18n.js` (4173), `db.js` (1856), `views/superadmin.js` (1803), `views/admin/fasi.js` (1609). Candidati a split.
- ⚠️ Frontend non interamente type-checked (solo il core algoritmico); il resto è vanilla JS coperto da `node --check` + i18n coverage in CI.
- ⚠️ 1 `TODO` residuo (`js/views/admin/iscrizioni.js:165` — caricamento allegati iscrizione).

---

## 9. Rischi residui (prioritizzati)

| Priorità | Item | Impatto | Sforzo |
|:---:|---|---|---|
| Bassa | Lazy-load client per-vista (al posto di `loadAll`) | Performance/scala su tenant molto grandi | Alto (refactor client, test browser) |
| Bassa | Split file frontend > 1500 LOC | Manutenibilità | Medio |
| Bassa | Type-checking esteso a tutto il frontend (JSDoc/TS) | Bug a runtime | Alto |
| Bassa | TODO allegati iscrizione | Funzionalità incompleta | Basso |

Nessun rischio residuo Alto o Medio: i precedenti (A1 paginazione, A2 streaming, copertura test route) sono stati chiusi.

---

## 10. Raccomandazioni

1. **Quando si scala**: migrare `db.loadAll` a caricamento lazy/per-vista e adottare la paginazione lato client già supportata dal server (limit/offset). Da validare in browser.
2. **Manutenibilità**: split incrementale dei file > 1500 LOC, partendo da `i18n.js` (estraibile per namespace) e `db.js`.
3. **Robustezza a lungo termine**: estendere il type-check (JSDoc o TS) oltre il core algoritmico, man mano che i file vengono toccati.
4. **Completamento**: chiudere il TODO allegati iscrizione (`iscrizioni.js:165`).

---

## 11. Cronologia interventi

### Fasi 1-5 (consolidamento)
1. **Affidabilità**: `/readyz` pinga il DB (503 se giù); pool pg con listener `error`; handler globali `unhandledRejection`/`uncaughtException`; shutdown idempotente con hard-timeout 10s.
2. **Concorrenza**: test che provano l'assenza di race (numeroCandidato concorrente; upsert valutazioni concorrenti).
3. **Test coverage**: job CI `Server tests (Postgres 18)`; allineati i test pre-esistenti all'hardening; aggiunti test d'integrazione route critiche; scovato e fixato `valutazioni.voto` numeric(5,2)→(6,2).
4. **Performance**: export GDPR in streaming (A2); paginazione `limit/offset` con cap.
5. **Manutenibilità**: `// @ts-check` + job CI sui moduli di logica pura; chiavi i18n duplicate rimosse.

### Round finale di rianalisi (N51-N84 + A1)
- **Validazione/sicurezza**: ownership cross-entità (N51 fasi→sezioni, N52/N62 criteri→fase, N53 account→commissario, N54 commissione→presidente); limiti piano applicati (N57); DELETE upload con cleanup file (N61).
- **Integrità/perf**: paginazione estesa a *tutti* i list endpoint (A1); pesi criteri largest-remainder, somma esatta 100 (N58); indici FK su sezione/categoria (N60).
- **Affidabilità infra**: TOCTOU lifecycle tenant → 409 (N55); transporter SMTP chiuso prima della rimozione dalla cache (N56); realtime hub — `LISTEN` prima della registrazione del canale, no canali orfani (N81); draft commissario persistito in `sessionStorage` e ripristinato dopo reload del service worker (N82).
- **Correttezza frontend**: countdown auto-save che crashava ad ogni tick — `[data-cd-text]` mancante (N79, critico); nomi gruppo vuoti nel PDF programma — membri flat (N80); guard anti doppio-submit iscrizione (N75); `_syncCriteri` ora notifica (N74); `notify()` con guard anti-ricorsione (N71); `getScala` clamp a min 2 (N83).
- **Falsi positivi risolti alla radice** (per non essere ri-segnalati): anti-spam con gli stessi nomi end-to-end form→API→server (N39); fallback "criterio non votato → 0" centralizzato in `votoCriterio()` con intento esplicito (N84).

### Round 8 (rianalisi N85-N94)
- **Sicurezza**: honeypot iscrizioni — rimosso `z.string().max(0)` che faceva fallire la validazione con un 400 rumoroso *prima* del check silenzioso, svelando la trappola ai bot (N85); tutore minori tipizzato e validato per contenuto (nome+email) — un `{}` vuoto è truthy e bypassava il requisito GDPR (N86); timer fase — `candidatoFaseId` verificato come appartenente alla fase, non più UUID arbitrario nei metadati del timer (N87).
- **Concorrenza**: `assertCanEvaluateCandidatoFase` lockka la membership commissione con `FOR UPDATE` → un admin non può rimuovere il commissario tra il check e l'upsert valutazione (N88).
- **Correttezza**: in modalità sincrona il gruppo avanza solo quando ogni commissario ha votato *tutti* i criteri (prima bastava una valutazione qualsiasi) (N89); `loadAll` usa `Promise.allSettled` con stato parziale + toast, invece di abbattere l'app al primo endpoint in errore (N90); anti-bot `startedAt` non penalizza più i client con orologio avanti — clock skew (N92); cache tenant resa LRU reale (era FIFO: `Map.set` non aggiorna l'ordine di inserzione) (N94).
- **Pulizia**: rimosso il check `consensiGdpr` irraggiungibile (già garantito dallo schema Zod) (N91). N93 (presunto typo `x-forwarded-proxy`) verificato **falso positivo**: il codice usa già `x-forwarded-proto`.

### Round 9 (rianalisi N95-N104)
- **Sicurezza/validazione**: POST commissione valida il presidente come commissario dello stesso concorso, come già il PATCH (N96); intervallo età categorie `etaMin <= etaMax` via refine Zod su create/update + CHECK `chk_categorie_eta_range` a livello DB (N97).
- **Concorrenza/integrità**: il POST pubblico iscrizioni esegue ora tutti i check e l'INSERT in **una sola transazione** con `FOR UPDATE` sul concorso → chiude la TOCTOU "concorso chiuso tra check e insert" (N102) e serializza i duplicati stessa email/concorso, rendendo il 409 deterministico oltre all'indice unique parziale già esistente (N95).
- **Robustezza**: il tiebreak per età scarta le date di nascita future — un'età negativa non fa più "vincere" il candidato sbagliato (N101); l'upload mappa il superamento di `limits.fileSize` a 413 invece di 500 (la RAM era già protetta dal limite di `@fastify/multipart`) (N99); il privacy export distrugge il socket se la write fallisce dopo l'`hijack`, evitando eccezioni non catchate (N104).
- **Pulizia**: rimosso il guard `ALLOWED_RESOURCES` irraggiungibile in upload (lo z.enum è già esaustivo) (N98).
- **Falsi positivi / non-azioni motivate**: N95 (premessa errata — l'indice unique parziale esiste già, nessun duplicato viene creato); N100 (il confronto lessicografico su colonna `date` ISO è corretto; il fix proposto `.toISOString()` romperebbe sulle stringhe); N103 (il reorder su concorso vuoto ritorna già 400 per `ids.min(1)` + check membership; il fix richiederebbe lock coordinato anche sulla create, con rischio deadlock per beneficio nullo).

---

## Conclusione

Il codice è **robusto su tutti gli assi** dopo i round di hardening, le 5 fasi di consolidamento e la rianalisi finale. Difesa a strati matura su sicurezza/integrità (RLS forzata, trigger, CHECK, transazioni con lock, ownership cross-entità, limiti piano), affidabilità runtime (health-check, handler globali, shutdown ordinato, no risorse orfane), concorrenza provata da test (incl. TOCTOU lifecycle), scala (paginazione completa + streaming) e una suite di 176 test (47 unit + 129 server) che gira in CI su Postgres reale. 0 alert Dependabot, CI verde.

Il debito rimanente è puramente **evolutivo** (lazy-load client, split file, type-check esteso), non correttezza né sicurezza, e non è bloccante per l'uso attuale.
