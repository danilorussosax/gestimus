# Gestimus — Audit di robustezza del codice

> **Data**: 2026-05-23
> **Commit**: `bc3ba0a` (branch `main`, CI verde)
> **Scope**: frontend vanilla JS (`js/`, ~20.600 LOC) + backend Fastify/Drizzle (`server/src/`, ~7.100 LOC) + 21 route REST + 11 migrazioni SQL.
> **Contesto**: l'audit segue 5 round di bugfix (C1-C13, H1-H12, M1-M22, L1-L16, N1-N50) che hanno chiuso ~80 problemi di sicurezza/correttezza.

---

## 1. Valutazione complessiva

> **Aggiornamento 2026-05-23 (post-hardening fasi 1-5)**: tutte le dimensioni
> portate ad Alto. Vedi §11 per il dettaglio degli interventi.

| Dimensione | Voto | Sintesi |
|---|:---:|---|
| Sicurezza | 🟢 Alto | RLS per-tenant, Argon2id, AES-GCM, hardening sistematico, input validati con Zod |
| Integrità dati | 🟢 Alto | RLS + trigger DB + CHECK constraint + transazioni con lock |
| Concorrenza | 🟢 Alto | Advisory lock + FOR UPDATE + ON CONFLICT, **provati da test di concorrenza** |
| Affidabilità runtime | 🟢 Alto | readyz con ping DB, pool error listener, handler globali, shutdown idempotente con timeout |
| Performance/scalabilità | 🟢 Alto | Paginazione (limit/offset + cap) sugli endpoint list, **export GDPR in streaming**, cache tenant, indici |
| Test coverage | 🟢 Alto | **Suite server gira in CI su Postgres 18** (rls/auth/crud/realtime/concorrenza/route) + 47 unit |
| Manutenibilità | 🟢 Alto | Type-check `checkJs` sul core logico (gate CI), chiavi i18n deduplicate, codice commentato |

**Giudizio**: base solida e ben difesa su tutti gli assi. Rischi residui solo evolutivi (lazy-load client, split file grandi, type-check esteso a tutto il frontend).

---

## 2. Architettura

- **Frontend**: SPA vanilla JS, hash-routing, service worker PWA, realtime via SSE. Data layer centralizzato in `js/db.js` (stato in memoria + write-through verso `/api`).
- **Backend**: singolo processo Node 22 + Fastify 5 + Drizzle ORM su PostgreSQL 16. TypeScript strict.
- **Multitenancy**: logica via `tenant_id` + **Row-Level Security**. Un solo DB condiviso, isolamento garantito dal database, non dall'applicazione.
- **Auth**: session cookie HttpOnly/SameSite, Argon2id, token sessione hashato SHA-256.

**Punto di forza**: l'isolamento tenant è a livello DB (RLS `FORCE`), quindi un bug applicativo che dimenticasse un `WHERE tenant_id` non causa data leak — Postgres rifiuta la query. Solo 4 file route usano `dbSuper` (bypass RLS, super-admin); 19 usano `req.dbTx` (RLS-scoped).

---

## 3. Sicurezza

**Stato: forte.** Coperto in 5 round di hardening.

- **Isolamento**: RLS `ENABLE + FORCE` su tutte le tabelle tenant, policy `tenant_id = current_setting('app.current_tenant')`. `REVOKE ALL` su tabelle platform (`tenants`, `platform_config`, `platform_audit_log`) dal ruolo applicativo.
- **Input**: validazione Zod su tutte le route; error handler globale che NON leakka i nomi dei campi interni (ZodError → 400 generico).
- **SQL injection**: nessuna interpolazione raw; `inArray`/parametri Drizzle. Canale SSE `LISTEN` validato con whitelist regex.
- **Auth**: Argon2id, no JWT in localStorage, sessione invalidata su mismatch cross-tenant, rate-limit su login/verify/logout/me.
- **Crittografia**: SMTP cifrato AES-GCM (no fallback plaintext), backup cifrati AES-256-GCM at-rest.
- **GDPR**: erase completo di tutti i PII su candidati/iscrizioni/commissari/accounts; export con redaction dei segreti.
- **Upload**: verifica magic bytes (non solo MIME dichiarato), path-traversal guard, cleanup file orfani.
- **SMTP header injection**: nome tenant sanificato (strip CRLF).
- **DoS**: cap logo 1MB (letto su login non-auth), cap import CSV 500 righe, cap sample metriche, single-flight su `/system`.
- **Privilege escalation**: trigger DB che vieta `role='superadmin'` fuori dal tenant platform; anti self-demote/self-disable; protezione ultimo admin.

**Residui minori**: nessuna vulnerabilità nota aperta. Dependabot: 0 alert.

---

## 4. Integrità dati

**Stato: forte.** Difesa a più livelli (DB + applicazione):

- **Trigger DB**: `clamp_voto`, `freeze_valutazioni_on_fase_conclusa`, `freeze_fase_state_transition` (no resurrezione fase), `enforce_superadmin_tenant`.
- **CHECK constraint**: voto ≥ 0, stato candidati_fase enum, `criteri_peso 0-100`, COMPLETATO ⇒ esito non-NULL.
- **Unique**: `(candidato_fase, commissario, criterio)`, `(fase, candidato)`, iscrizioni `(concorso, email)` parziale, commissari `(concorso, email)` parziale.
- **Transazioni**: permessi+mutazioni nella stessa tx con `FOR UPDATE`; criteri replace atomico; cleanup audit+delete atomico.
- **Append-only**: `audit_log`/`platform_audit_log` senza UPDATE/DELETE per il ruolo app.

---

## 5. Concorrenza

Punti critici coperti:
- `numeroCandidato`: advisory lock unico condiviso tra create diretto e approve iscrizione.
- Upsert valutazioni: `ON CONFLICT DO UPDATE`.
- Start fase / candidati_fase: `ON CONFLICT DO NOTHING`.
- Reorder fasi: `FOR UPDATE` + validazione completezza.
- Cleanup tenant: `pg_advisory_xact_lock` globale.
- Ente PATCH: merge JSONB atomico server-side.

**Residuo**: la maggior parte dei lock è a grana di concorso/tenant — adeguata per il carico atteso (concorsi musicali, non alto volume).

---

## 6. Performance e scalabilità

**Punto debole principale.**

- 🔴 **A1 — Nessuna paginazione** sugli endpoint list (`GET /candidati`, `/commissari`, `/fasi`, `/iscrizioni`, ...). Ogni GET ritorna tutte le righe del tenant. Inoltre il frontend carica l'intero stato in memoria (`db.loadAll`). Per tenant con migliaia di record: query lente, payload grandi, RAM client alta. **Richiede refactor coordinato client+server.**
- 🟡 **A2 — Privacy export in memoria**: `Promise.all` su 5 tabelle complete. Rischio OOM su tenant grandi. Serve streaming.
- 🟢 Mitigato: cache LRU tenant (TTL 60s), indici su FK e colonne filtrate, bulk UPDATE sorteggio, loadAll parallelizzato, ring-buffer metriche.

---

## 7. Test e CI

- **Unit** (root, `node --test`): 47 test su `scoring.js`/`rng.js` — algoritmi di media, tiebreak, suggerimenti. Tutti verdi.
- **Server** (`node --test` + tsx): 11 suite — `rls/isolation`, `auth/login`, `realtime/notify`, `crud/{smoke,triggers,privacy,storage,smtp,crypto-smtp,platform,cleanup}`. Coprono i meccanismi core (RLS, trigger, crypto).
- **E2E** (Playwright): 2 spec (smoke, multitenant).
- **CI**: lint TS (tsconfig dedicato), lint JS, lint bash+shellcheck, validate SQL migrations, i18n coverage, audit dimensioni file. Verde su `main`.

**Gap**: molte route REST (candidati, fasi, commissioni, iscrizioni admin, accounts) non hanno test d'integrazione dedicati. La logica di business più complessa (transizioni fase, scoring end-to-end, GDPR erase completo) è testata solo parzialmente.

---

## 8. Manutenibilità

- ✅ Codice commentato (il *perché*, spesso con riferimento al bug ID), naming coerente, separazione route/service/middleware netta.
- ✅ TypeScript strict + Drizzle tipizzato lato server.
- ⚠️ File molto grandi lato frontend: `i18n.js` (4188), `db.js` (1836), `views/superadmin.js` (1803), `views/admin/fasi.js` (1609). Candidati a split.
- ⚠️ 1 solo `TODO` residuo (`js/views/admin/iscrizioni.js:165` — caricamento allegati iscrizione).
- ⚠️ Frontend senza type-checking (vanilla JS); la sola rete di sicurezza è `node --check` (sintassi) + i18n coverage in CI.

---

## 9. Rischi residui (prioritizzati)

| Priorità | Item | Impatto | Sforzo |
|:---:|---|---|---|
| Alta | A1 paginazione endpoint list | Performance/scala su tenant grandi | Alto (refactor client+server) |
| Media | A2 streaming privacy export | OOM su export tenant grandi | Medio |
| Media | Copertura test route REST | Regressioni non rilevate | Medio |
| Bassa | Split file frontend grandi | Manutenibilità | Medio |
| Bassa | Type-checking frontend (JSDoc/TS) | Bug a runtime | Alto |
| Bassa | TODO allegati iscrizione | Funzionalità incompleta | Basso |

---

## 10. Raccomandazioni

1. **Breve termine**: aggiungere test d'integrazione sulle route critiche (fasi transitions, valutazioni upsert/permessi, GDPR erase, iscrizioni pubbliche). È il modo più economico per bloccare regressioni dopo i 5 round di fix.
2. **Medio termine**: introdurre paginazione `limit/offset` (default safe) sugli endpoint list + adattare `db.loadAll` a caricamento lazy/per-vista. Sblocca la scalabilità.
3. **Medio termine**: streaming della risposta privacy export (o paginazione interna).
4. **Lungo termine**: migrare il frontend a JSDoc-typed o TS per type-safety; split dei file > 1500 LOC.

---

## 11. Interventi post-audit (fasi 1-5) — tutte le dimensioni → Alto

1. **Affidabilità**: `/readyz` pinga il DB (503 se giù); pool pg con listener `error`; handler globali `unhandledRejection`/`uncaughtException`; shutdown idempotente con hard-timeout 10s.
2. **Concorrenza**: aggiunti test che provano l'assenza di race (numeroCandidato concorrente → numeri distinti; upsert valutazioni concorrenti → una sola riga).
3. **Test coverage**: nuovo job CI `Server tests (Postgres 18)` che esegue bootstrap+setup+seed+suite completa ad ogni push (rls/auth/crud/realtime/concorrenza/route, ~130 test). Allineati i test pre-esistenti all'hardening; scovato e fixato un bug reale (`valutazioni.voto` numeric(5,2)→(6,2), overflow prima del clamp).
4. **Performance**: export GDPR in streaming (picco memoria = tabella più grande, non somma); paginazione `limit/offset` con cap di sicurezza su candidati/commissari/iscrizioni/accounts.
5. **Manutenibilità**: `// @ts-check` + job CI `tsc --checkJs` sui moduli di logica pura (scoring/rng/tiebreak); chiavi i18n duplicate rimosse (15, scoperte dal type-check).

**Residui evolutivi** (non bloccanti): client lazy-load per-vista al posto di `loadAll`; estensione del type-check a tutto il frontend (api/utils/views, oggi DOM-heavy); split dei file > 1500 LOC.

---

## Conclusione

Il codice è **robusto su tutti gli assi** dopo i round di hardening + le 5 fasi di consolidamento. Difesa a strati matura su sicurezza/integrità (RLS forzata, trigger, CHECK, transazioni con lock), affidabilità runtime (health-check, handler globali, shutdown ordinato), concorrenza provata da test, scala (paginazione + streaming) e una suite di ~130 test che gira in CI su Postgres reale. 0 alert Dependabot, CI verde.

Il debito rimanente è puramente **evolutivo** (lazy-load client, type-check esteso, split file), non correttezza né sicurezza, e non è bloccante per l'uso attuale.
