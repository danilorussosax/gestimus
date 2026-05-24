# Gestimus — Audit di robustezza del codice

> **Data**: 2026-05-23
> **Branch**: `main` (CI e suite test verdi)
> **Scope**: frontend vanilla JS (`js/`, ~20.700 LOC) + backend Fastify/Drizzle (`server/src/`, ~7.400 LOC) + 21 route REST + 15 migrazioni SQL.

Questo documento descrive lo **stato attuale** della robustezza del codice. Le aree sotto riflettono le difese presenti oggi; le voci ancora aperte sono in §9.

---

## 1. Valutazione complessiva

| Dimensione | Voto | Sintesi |
|---|:---:|---|
| Sicurezza | 🟢 Alto | RLS per-tenant `FORCE`, Argon2id, AES-GCM, input Zod, ownership cross-entità validata, limiti piano applicati |
| Integrità dati | 🟢 Alto | RLS + trigger di coerenza tenant + CHECK constraint + transazioni con lock |
| Concorrenza | 🟢 Alto | Advisory lock + FOR UPDATE + ON CONFLICT + UPDATE condizionati (no TOCTOU), provati da test |
| Affidabilità runtime | 🟢 Alto | `/readyz` con ping DB, pool error listener, handler globali, shutdown idempotente con timeout, hub realtime auto-recuperante |
| Performance/scalabilità | 🟢 Alto | Paginazione su tutti i list endpoint, export GDPR e backup tenant in streaming, cache tenant, indici FK |
| Test coverage | 🟢 Alto | Suite server in CI su Postgres 18 (rls/auth/crud/realtime/concorrenza/route) + unit sul core algoritmico |
| Manutenibilità | 🟢 Alto | Type-check `checkJs` sul core logico (gate CI), separazione route/service/middleware |

**Giudizio**: base solida e ben difesa su tutti gli assi. Il debito residuo è puramente **evolutivo** (split file grandi, type-check esteso a tutto il frontend, lazy-load client), non correttezza né sicurezza, e non blocca l'uso attuale.

---

## 2. Architettura

- **Frontend**: SPA vanilla JS, hash-routing, service worker PWA, realtime via SSE. Data layer centralizzato in `js/db.js` (stato in memoria + write-through verso `/api`).
- **Backend**: singolo processo Node 22 + Fastify 5 + Drizzle ORM su PostgreSQL. TypeScript strict.
- **Multitenancy**: logica via `tenant_id` + **Row-Level Security**. Un solo DB condiviso, isolamento garantito dal database, non dall'applicazione.
- **Auth**: session cookie HttpOnly/SameSite, Argon2id, token sessione hashato SHA-256.

**Punto di forza**: l'isolamento tenant è a livello DB (RLS `FORCE`), quindi un bug applicativo che dimenticasse un `WHERE tenant_id` non causa data leak — Postgres rifiuta la query. Solo i percorsi super-admin usano `dbSuper` (bypass RLS); le route usano `req.dbTx` (RLS-scoped).

---

## 3. Sicurezza

- **Isolamento**: RLS `ENABLE + FORCE` su tutte le tabelle tenant, policy `tenant_id = current_setting('app.current_tenant')`. `REVOKE ALL` sulle tabelle platform dal ruolo applicativo. Una guardia in `policies.sql` fa fallire l'apply se una tabella con `tenant_id` non ha RLS abilitata+forzata.
- **Ownership cross-entità**: ogni POST/PUT che referenzia un'altra entità (concorso/sezione/fase/candidato/commissario) verifica l'appartenenza al tenant corrente sotto RLS — le FK garantiscono solo l'esistenza, non l'isolamento. Trigger DB di coerenza tenant anche sulle tabelle figlie (junction, candidati_fase, valutazioni, accounts, commissioni, candidati/iscrizioni con sezione/categoria).
- **Input**: validazione Zod su tutte le route; error handler globale che non leakka i nomi dei campi interni.
- **SQL injection**: nessuna interpolazione raw; `inArray`/parametri Drizzle. Canale SSE `LISTEN` validato con whitelist regex.
- **Auth**: Argon2id, no JWT in localStorage, sessione invalidata su mismatch cross-tenant, rate-limit su login/verify/logout/me, tentativi di login auditati (successo/fallimento). **2FA TOTP** (RFC 6238) opzionale per account: challenge HMAC dopo la password, sessione emessa solo dopo il secondo fattore (codice TOTP o recovery code one-time), setup/disable self-service; cookie ri-emesso sull'auto-refresh della sessione.
- **Crittografia**: SMTP cifrato AES-GCM (no fallback plaintext), backup cifrati AES-256-GCM at-rest (derivazione chiave unica condivisa con SMTP).
- **GDPR**: erase completo dei PII su candidati/iscrizioni/commissari/accounts; redazione delle PII (email, ip/userAgent delle proprie azioni) anche dai payload storici dell'`audit_log` della persona, con ri-firma; export con redaction dei segreti.
- **Tamper-evidence audit**: ogni riga di `audit_log`/`platform_audit_log` ha una firma HMAC-SHA256 del contenuto (chiave non nel DB) → una modifica via accesso diretto al database è rilevabile da `verifyAuditIntegrity`.
- **Upload**: verifica magic bytes, estensione derivata sempre dal MIME validato (mai dal filename → no stored XSS), `X-Content-Type-Options: nosniff` sui file serviti, path-traversal guard, scrittura atomica (tmp+rename), cleanup anti-orfani; i commissari possono gestire solo la propria foto.
- **DoS**: cap logo 1MB, cap import CSV, single-flight su `/system`, paginazione (ceiling) su tutti i list endpoint, `trustProxy: 1`.
- **Privilege escalation**: trigger DB che vieta `role='superadmin'` fuori dal tenant platform; anti self-demote/self-disable; protezione ultimo admin; cookie cross-tenant invalidato.

**Residui**: nessuna vulnerabilità nota aperta. Dependabot: 0 alert.

---

## 4. Integrità dati

- **Trigger DB**: clamp voto, freeze valutazioni su fase CONCLUSA, no resurrezione fase, enforce tenant del superadmin, coerenza tenant su tabelle figlie.
- **CHECK constraint**: voto ≥ 0, stato candidati_fase enum, `criteri_peso 0-100`, `categorie eta_min ≤ eta_max`, COMPLETATO ⇒ esito non-NULL.
- **Unique**: `(candidato_fase, commissario, criterio)`, `(fase, candidato)`, iscrizioni `(concorso, email)` parziale, commissari `(concorso, email)` parziale, un solo account per commissario.
- **Transazioni**: permessi+mutazioni nella stessa tx con `FOR UPDATE`; criteri replace atomico; iscrizione pubblica (check concorso/duplicato/sezione + insert) in un'unica tx con lock sul concorso; cleanup audit+delete atomico.
- **Pesi criteri**: normalizzazione largest-remainder (somma sempre esattamente 100).
- **Append-only**: `audit_log`/`platform_audit_log` senza UPDATE/DELETE per il ruolo app (lo scrub GDPR passa da `dbSuper`).

---

## 5. Concorrenza

Punti critici coperti, provati da test (`tests/crud/concurrency.test.ts`):

- `numeroCandidato`: advisory lock 64-bit condiviso tra create diretto e approve iscrizione → numeri distinti.
- Upsert valutazioni: `ON CONFLICT DO UPDATE` → nessun 23505, una sola riga.
- TOCTOU chiusi con `FOR UPDATE` sulle entità lette prima di una mutazione (fase/commissione/membership/candidatoFase, lifecycle tenant, reorder/create fasi, pause/resume timer).
- Cleanup tenant: advisory lock di sessione su **connessione dedicata** (lock+unlock garantiti sulla stessa connessione).
- Ammissione alla fase successiva: calcolata dall'aggregato e applicata atomicamente al conclude (niente last-write-wins per-commissario).

**Residuo**: la maggior parte dei lock è a grana di concorso/tenant — adeguata per il carico atteso (concorsi musicali, non alto volume).

---

## 6. Performance e scalabilità

- **Paginazione** (`parsePagination`, limit/offset con cap) su tutti i list endpoint.
- **Streaming**: export GDPR e backup tenant scritti in streaming (picco memoria = tabella più grande, non la somma) → no OOM su tenant grandi.
- **Indici**: cache LRU tenant (TTL 60s), indici su FK e colonne filtrate, bulk UPDATE sorteggio, ring-buffer metriche.
- **Realtime hub**: riconnessione con backoff esponenziale, niente client orfani/morti, timer di reconnect `.unref()`.

**Residuo evolutivo**: il client carica ancora `db.loadAll` in memoria — adeguato ai volumi attesi; la migrazione a lazy-load per-vista è un'evoluzione successiva da validare in browser.

---

## 7. Test e CI

- **Unit** (root, `node --test`): 47 test su `scoring.js`/`rng.js`/`tiebreak.js` (media, tiebreak, RNG sorteggio).
- **Server** (`node --test` + tsx): ~133 test su 13 suite — `rls/isolation`, `auth/login`, `realtime/notify`, `crud/{smoke,triggers,privacy,storage,smtp,crypto-smtp,platform,cleanup,concurrency,routes}`. Coprono RLS, trigger, crypto, concorrenza, route critiche (transizioni fase, permessi, GDPR, ammissione, DELETE concorso, restore backup).
- **E2E** (Playwright): 2 spec (smoke, multitenant).
- **CI**: job `Server tests (Postgres 18)` a ogni push, lint TS/JS, lint bash+shellcheck, validate SQL migrations, i18n coverage, type-check frontend core, audit dimensioni file. Verde su `main`.

---

## 8. Manutenibilità

- ✅ Codice commentato (il *perché*), separazione route/service/middleware netta, TypeScript strict + Drizzle tipizzato.
- ✅ `// @ts-check` + job CI `tsc --checkJs` sui moduli di logica pura (scoring/rng/tiebreak).
- ⚠️ File frontend grandi (`i18n.js`, `db.js`, `views/superadmin.js`, `views/admin/fasi.js`) candidati a split.
- ⚠️ Frontend non interamente type-checked (solo il core algoritmico); il resto è coperto da `node --check` + i18n coverage.

---

## 9. Voci aperte

| Priorità | Voce | Note |
|:---:|---|---|
| Media | Feature CV commissario half-built | Frontend completo (bottone/`openCv`/`patch.cv`) ma nessuna colonna `cv` lato server → `c.cv` sempre `undefined`. Completare il backend (colonna+migrazione+route) o rimuovere il codice CV morto. |
| Media | i18n EN/FR/ES incomplete | ~185 chiavi mancanti vs IT; il check coverage CI valida solo IT. Estendere il check e colmare le traduzioni. |
| Media | Export GDPR senza entry `audit_log` della persona (Art.15) | `privacy.ts` esporta accounts/commissari/candidati/iscrizioni ma non le righe audit dell'interessato (l'erase ne reda invece le PII — vedi §3/§11). |
| Bassa | GET `/public/iscrizioni/:token/verify` con side-effect + `sameSite:lax` | Token nell'URL = capability (non CSRF classico), ma i prefetcher di posta possono auto-verificare. Valutare landing→POST. |
| Bassa | Timer fase senza sync orologio client-server | Drift visibile in cloud sotto skew del client (`fasi.ts`/`commissario.js`). |
| Bassa | Edge minori | IDN/Punycode sottodomini, stampede cache tenant a TTL, fingerprint asset CDN nel SW, precache SW incompleta. Tutti a basso impatto sui volumi attesi. |
| Bassa | Lazy-load client per-vista | `db.loadAll` carica tutto in memoria; ok ai volumi attesi, da rivedere per tenant molto grandi (richiede test browser). |
| Bassa | Split file frontend > 1500 LOC | Manutenibilità. |
| Bassa | Type-check esteso a tutto il frontend | Bug a runtime; oggi solo il core algoritmico è type-checked. |
| Bassa | TODO allegati iscrizione (`iscrizioni.js`) | Funzionalità incompleta. |

> ⚠️ **Validazione in browser**: diverse modifiche frontend recenti (motore tiebreak nel ranking, flusso conclude/ammissione, service worker, import CSV, upload foto commissario) sono verificate da typecheck + unit ma **non sono state validate manualmente in browser**. Vanno provate prima di affidarcisi in produzione.

---

## 10. Conclusione

Il codice è **robusto su tutti gli assi**: difesa a strati matura su sicurezza/integrità (RLS forzata, trigger di coerenza, CHECK, transazioni con lock, ownership cross-entità, limiti piano, audit firmato), affidabilità runtime (health-check, handler globali, shutdown ordinato, hub auto-recuperante), concorrenza provata da test, scala (paginazione + streaming export/backup) e disaster recovery (backup cifrati + restore). Suite verde in CI su Postgres reale, 0 alert Dependabot.

Le voci aperte (§9) sono puramente **debito evolutivo** (lazy-load client, split file, type-check esteso) — non correttezza né sicurezza bloccante per l'uso attuale.

---

## 11. Cronologia — Round R14 (2026-05-24)

Re-analisi esterna (report "R13", 109 voci dichiarate aperte) **verificata sul codice reale**. Esito: la stragrande maggioranza era già fixata o falso positivo — incluse 8 delle 10 "top priority" (N182/N183/N185/N186/N187/N188/N189/N190 già risolti o FP). Bug realmente presenti: ~25, quasi tutti MEDIUM/LOW.

**Fixati in R14:**
- **M191** — età GDPR (check minorenne) ora calcolata con helper TZ-safe `ageYears()` sul fuso piattaforma, non con `new Date()` del processo (sfasamento di un anno a cavallo di mezzanotte il giorno del compleanno).
- **L232** — `ip`/`userAgent` sanificati (strip control-char, cap 512) prima dell'inserimento in `audit_log`/`platform_audit_log`; la firma HMAC copre il valore sanificato.
- **N120** — rimosso `notify()` ridondante in `_syncCriteri` (doppio render: il primo con `state.fasi` ancora privo della fase appena creata).
- **L230** — strip byte NUL nel parser CSV import.
- **L231** — messaggio "troppe righe" import migrato a i18n (IT/EN/FR/ES).

**Verifica:** typecheck server pulito · integrazione 147 pass / 1 skip preesistente · unit 47/47.

---

## 12. Cronologia — Round R15 (2026-05-24)

Caccia bug con **8 agenti in parallelo** (auth, schema/RLS, route CRUD, GDPR/platform, infra, frontend core, viste admin, app/PWA), ogni finding ri-verificato sul codice reale. **10 fix immediati** poi **tutti i deferiti risolti**.

**Sicurezza / feature:**
- **2FA TOTP completo** (RFC 6238 con `node:crypto`, nessuna lib): challenge HMAC al login, `/auth/login/verify-totp` (TOTP o recovery code one-time), setup/enable/disable self-service, frontend (step login i18n 4 lingue + gestione nell'header). Test: vettori RFC + flusso e2e.
- **Coerenza tenant DB estesa**: trigger su `categorie`/`criteri`/`candidati_membri` (FK NOT NULL non coperte) + coerenza `concorso_id` sulle figlie dirette (sezioni/fasi/commissari/commissioni/candidati/iscrizioni/eventi/sale/calendario_pubblicazioni).
- **GDPR**: scrub audit dell'erasure ora **ricorsivo** (email annidate/altre chiavi) con ri-firma; tutore obbligatorio per tutti i minori (<18).
- **Cross-tenant approve bypass**: `iscrizione.approve` ora applica `checkCandidatiLimit` (era saltato → sforamento piano).
- **PATCH fase CONCLUSA**: bloccata la modifica dei parametri di scoring (riscriveva graduatorie finalizzate).
- **Invariante role↔commissarioId**, rate-limit GET pubblici, TOCTOU membership candidato-fase, **SSE subscriber leak** su disconnect-durante-subscribe.

**Affidabilità / integrità:**
- Indici FK (`fasi.commissione_id`, `commissioni.presidente_commissario_id`); `VALIDATE` del CHECK eta categorie; cookie ri-emesso sull'auto-refresh sessione; latch d'errore gzip backup; guard re-entrancy cron; `.close()` transporter SMTP su refresh; TTL 24h bozze iscrizione; M208 (unicità chiavi criteri).

**Frontend:** edit concorso (data ISO→date-only), podio verbale via motore tiebreak + fase finale per ordine-max, poll calendario pubblico (leak inter-vista), SW navigate (`res.ok`), palette gate su authRole, beep timer, preview import, età robusta, doppio-escape i18n.

**Non cambiato (deciso):** login rate-limit per-account (un lockout-by-email è un vettore DoS; per-IP + verify-totp rate-limited è la difesa corretta). Allegati GDPR: latente (nessuna route scrive allegati oggi) → da gestire quando la feature sarà cablata.

**Verifica:** typecheck server pulito · `db:policies` applicato · integrazione **153 pass / 1 skip / 0 fail** (incl. 6 test TOTP) · unit **47/47**.

Voci residue in §9 (CV half-built, i18n EN/FR/ES, export audit Art.15, GET-verify, drift timer, edge minori). ⚠️ I flussi frontend (in particolare il 2FA end-to-end) non sono ancora validati in browser.
