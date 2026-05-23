# Gestimus — Audit di robustezza del codice

> **Data**: 2026-05-23
> **Commit**: `bc3ba0a` (branch `main`, CI verde)
> **Scope**: frontend vanilla JS (`js/`, ~20.600 LOC) + backend Fastify/Drizzle (`server/src/`, ~7.100 LOC) + 21 route REST + 11 migrazioni SQL.
> **Contesto**: l'audit segue 5 round di bugfix (C1-C13, H1-H12, M1-M22, L1-L16, N1-N50) che hanno chiuso ~80 problemi di sicurezza/correttezza.

---

## 1. Valutazione complessiva

| Dimensione | Voto | Sintesi |
|---|:---:|---|
| Sicurezza | 🟢 Alto | RLS per-tenant, Argon2id, AES-GCM, hardening sistematico, input validati con Zod |
| Integrità dati | 🟢 Alto | RLS + trigger DB + CHECK constraint + transazioni con lock |
| Concorrenza | 🟢 Buono | Advisory lock + FOR UPDATE + ON CONFLICT sui punti critici |
| Affidabilità runtime | 🟡 Medio-alto | Error handler globale, retry client, SSE con backpressure; mancano health-check approfonditi |
| Performance/scalabilità | 🟡 Medio | Indici mirati, cache tenant, ma **niente paginazione** sugli endpoint list (A1) |
| Test coverage | 🟡 Medio | 47 unit (scoring/rng) + 11 suite server (rls/auth/crud/realtime) + 2 e2e; mancano test su molte route |
| Manutenibilità | 🟡 Medio | Codice ordinato e commentato; alcuni file molto grandi (i18n 4188, db.js 1836, superadmin 1803) |

**Giudizio**: base solida e ben difesa lato sicurezza/integrità. I rischi residui sono **operativi/di scala** (paginazione, OOM su export, copertura test), non vulnerabilità note.

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

## Conclusione

Il codice è **robusto sul piano di sicurezza e integrità dati**: l'isolamento tenant via RLS forzata, i trigger DB, i CHECK constraint e le transazioni con lock costituiscono una difesa a strati matura. I 5 round di hardening hanno eliminato le vulnerabilità note (0 alert Dependabot, CI verde).

Il **debito rimanente è di scala e di copertura test**, non di sicurezza: l'assenza di paginazione e lo stato client monolitico sono i limiti principali per tenant di grandi dimensioni, mentre la copertura test parziale sulle route è il rischio maggiore per le regressioni future. Nessuno dei due è bloccante per l'uso attuale (concorsi musicali, volumi medio-bassi).
