---
phase: server-lib-infra
reviewed: 2026-06-07T00:00:00Z
depth: deep
files_reviewed: 18
files_reviewed_list:
  - server/src/lib/date.ts
  - server/src/lib/domain-error.ts
  - server/src/lib/logger.ts
  - server/src/lib/optimistic.ts
  - server/src/lib/pagination.ts
  - server/src/lib/plan-limits.ts
  - server/src/lib/result.ts
  - server/src/lib/scoring-verify.ts
  - server/src/lib/validation.ts
  - server/src/lib/zod-helpers.ts
  - server/src/db/client.ts
  - server/src/db/schema.ts
  - server/src/env.ts
  - server/src/app.ts
  - server/src/index.ts
  - server/src/observability/sentry.ts
  - server/src/realtime/hub.ts
  - server/src/middleware/runtime-metrics.ts
findings:
  critical: 1
  warning: 8
  info: 6
  total: 15
status: issues_found
---

# Phase server-lib-infra: Code Review Report

**Reviewed:** 2026-06-07
**Depth:** deep
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the shared lib + DB schema + app/index bootstrap + observability/realtime/metrics cluster of the Gestimus Fastify backend. The code is mature and heavily commented with prior-audit rationale; many obvious classes of bug (tenant scoping on broadcasts, RLS-scoped limit counts, secret strength guards, graceful shutdown, idle-pool error listeners) are already handled correctly. Verified invariants that hold: realtime channel subscription is tenant-validated before LISTEN (routes/realtime.ts:27); plan-limit queries run under RLS in the caller transaction; middleware order is tenant→auth→metrics; helmet/CSP/HSTS configured; pool idle-error listeners present; scoring-verify mirrors the frontend reference faithfully (refDate fallback converges).

The one BLOCKER is a lost-update window in the optimistic-concurrency primitive: `versionFresh` compares the read `updatedAt` to the *current* DB value but the check-then-write is not atomic — under the documented opt-in use it does not actually close the race it claims to (TOCTOU between the SELECT and the UPDATE). The remaining findings are robustness/hardening WARNINGs (missing statement timeout, realtime reconnect double-scheduling, plan-limit count-vs-insert race) and INFO-level quality items.

## Critical Issues

### CR-01: Optimistic-concurrency check is TOCTOU — does not actually prevent the lost update it claims to

**File:** `server/src/lib/optimistic.ts:17-21` (and every caller: `routes/concorsi.ts`, `routes/accounts.ts`, `routes/ente.ts`)
**Issue:** `versionFresh(currentUpdatedAt, expected)` is a pure comparison run in application code. The intended flow is: route SELECTs the row's `updatedAt`, calls `versionFresh(...)`, then issues an UPDATE. Between the SELECT and the UPDATE there is no row lock and no atomic guard, so two concurrent PATCHes that both read the same `updatedAt` will both pass `versionFresh` and both UPDATE — the exact lost-update this module's docblock claims to prevent ("invece di sovrascrivere in silenzio la modifica altrui"). The check narrows but does not eliminate the window; under contention it provides a false sense of safety. The module also depends entirely on every caller threading the value through correctly and on `updatedAt` actually being bumped on every write — neither is enforced here.
**Fix:** Make the freshness check part of the write, not a separate read. Push the predicate into the UPDATE's WHERE clause and treat a 0-row result as the stale conflict:
```ts
// in the route, inside req.dbTx:
const res = await tx
  .update(concorsi)
  .set({ ...patch, updatedAt: sql`now()` })
  .where(and(eq(concorsi.id, id), eq(concorsi.updatedAt, new Date(expected))))
  .returning({ id: concorsi.id });
if (expected !== undefined && res.length === 0) {
  // either not found OR stale; disambiguate with a follow-up existence check if needed
  return reply.code(409).send(STALE_VERSION_BODY);
}
```
Alternatively `SELECT ... FOR UPDATE` the row at the top of the transaction so the read-check-write is serialized. Keep `versionFresh` only as a pre-flight UX hint, not the authoritative guard.

## Warnings

### WR-01: No `statement_timeout` / `idle_in_transaction_session_timeout` on either pool

**File:** `server/src/db/client.ts:9-24`
**Issue:** Project invariant explicitly calls for statement timeouts. Neither `appPool` nor `superPool` sets a `statement_timeout` or `idle_in_transaction_session_timeout`. A runaway query (or a transaction left open by a bug) holds a pooled connection indefinitely; under the configured `max` of 20 app connections this exhausts the pool and stalls the tenant hot path. `connectionTimeoutMillis`/`idleTimeoutMillis` do not cover an *active* slow query.
**Fix:** Set timeouts at the pool/session level, e.g. add to the `Pool` options:
```ts
const appPool = new Pool({
  connectionString: env.DATABASE_URL_APP,
  max: env.DB_APP_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 30_000,
});
```
(or enforce server-side per-role via `ALTER ROLE gestimus_app SET statement_timeout = '30s'`).

### WR-02: SSL not configured on pools; relies entirely on DSN/deploy

**File:** `server/src/db/client.ts:9-24`
**Issue:** No `ssl` option on either `Pool`. In production with a remote Postgres, an unencrypted connection is possible unless the DSN carries `sslmode=require`. There is no fail-fast assertion that prod DSNs are TLS. If the deploy is bare-metal with a local UNIX socket this is fine, but it's silent — a misconfigured DSN downgrades transparently.
**Fix:** Either document/enforce `sslmode=require` in prod DSNs (validate in env.ts when `NODE_ENV==='production'`), or pass `ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined` explicitly.

### WR-03: Plan-limit check is count-then-insert with a race window

**File:** `server/src/lib/plan-limits.ts:46-77`
**Issue:** `checkConcorsiLimit` / `checkCommissariLimit` / `checkCandidatiLimit` do `SELECT count(*)` and compare to the cap, but the subsequent INSERT happens later in the caller. Two concurrent creates at `n == max-1` both read `n` and both pass, overshooting the plan limit by one (or more under higher concurrency). The functions run "under RLS in the caller transaction" but RLS does not serialize counts; without `SERIALIZABLE` isolation or a locking strategy the limit is advisory, not enforced.
**Fix:** Either run the create path in `SERIALIZABLE` and retry on serialization failure, take an advisory lock keyed on `(tenantId, 'concorsi')` before the count+insert, or enforce via a DB constraint/trigger. At minimum document that the cap is best-effort and can be exceeded by 1 under concurrency.

### WR-04: Realtime reconnect can be double-scheduled / `client.on('error')` and `on('end')` both fire

**File:** `server/src/realtime/hub.ts:36-47, 84-102`
**Issue:** A single connection failure typically emits BOTH `'error'` and `'end'`, each calling `scheduleReconnect()`. The `if (reconnectTimer) return` guard dedupes the *timer*, but the error handler is bound to a specific `pg.Client` instance `c`; after a successful reconnect a NEW client is created while the OLD client's `'error'`/`'end'` listeners remain attached and can still fire (e.g. delayed socket error on the stale client), calling `scheduleReconnect()` and potentially tearing down or racing the healthy connection. There is no `c.removeAllListeners()` on the superseded client.
**Fix:** Detach listeners from the old client before/at reconnect (`c.removeAllListeners()` in `scheduleReconnect` or when assigning a new `client`), and guard the handlers to no-op when `c !== client`:
```ts
c.on('error', (err) => { if (c !== client && client !== null) return; /* ... */ });
```

### WR-05: `connect()` re-LISTEN loop can throw mid-loop and leave channels half-subscribed

**File:** `server/src/realtime/hub.ts:75-82`
**Issue:** After assigning `client = c`, the loop `for (const channel of subscribers.keys()) await client.query('LISTEN "..."')` re-subscribes all channels. If one `LISTEN` rejects (transient), the loop aborts, the remaining channels are never re-listened, yet `client` is already published as healthy and `reconnectDelay`/`realtimeAlerted` are reset — so notifications for the un-listened channels are silently lost with no further reconnect triggered. The promise rejection from `connect()` here propagates out of the `'end'`/timer callback as an unhandled rejection (the callback is `async` and not awaited with a catch in the timer path beyond the outer try).
**Fix:** Wrap the re-LISTEN loop so a failure schedules a reconnect rather than leaving a partially-subscribed live client; or issue a single `LISTEN` per channel with individual try/catch that triggers `scheduleReconnect()` on failure.

### WR-06: `validateSessionToken` (DB round-trip) runs on every gated static photo request

**File:** `server/src/app.ts:172-184`
**Issue:** The `PHOTO_GATED` onRequest hook calls `await validateSessionToken(token)` for every `/uploads/<tenant>/(candidato|commissario)/...` request. A page rendering many candidate/commissioner thumbnails fires one DB session lookup per image, all before the static handler. This is a correctness-adjacent robustness concern (amplifies DB load / can interact with WR-01 pool exhaustion under load) and duplicates the auth middleware's own session validation for API requests.
**Fix:** Reuse the already-validated session from the auth middleware where possible, or add a short-lived in-process cache for session-token validity keyed by token hash (consistent with the existing tenant cache pattern). At minimum confirm session lookups are index-backed (they are, idx_sessions on id PK).

### WR-07: `ageYears` decrement logic ignores partial-NaN birth dates inconsistently

**File:** `server/src/lib/date.ts:32-39`
**Issue:** If `dobISO` is malformed such that only the month/day parse to NaN but the year parses (e.g. `"2008-AB-CD"`), `by` is a number while `bm`/`bd` are NaN. Then `age = ty - by` is a finite number, and the decrement guard `tm < bm || (tm === bm && td < bd)` is `false` (NaN comparisons are false), so the function returns a *finite, possibly wrong* age instead of the NaN the docblock promises ("Su input non valido ritorna NaN"). A minor with a corrupt month could be classified as adult.
**Fix:** Validate all three components up front and return NaN if any is NaN:
```ts
if ([by, bm, bd, ty, tm, td].some(Number.isNaN)) return NaN;
```

### WR-08: `events.payload` jsonb default `{}` may emit an empty-object literal instead of JSON `{}`

**File:** `server/src/db/schema.ts:945`
**Issue:** `jsonb('payload').notNull().default({})` — drizzle serializes a JS object default; depending on version this can generate `DEFAULT '{}'::jsonb` (correct) or a malformed default. Worth verifying the generated migration produces a valid jsonb default and not a mismatched type. If the actual write always supplies `payload`, the default is dead but still a footgun for direct inserts.
**Fix:** Confirm the emitted DDL: `DEFAULT '{}'::jsonb`. If ambiguous, set explicitly via `.default(sql\`'{}'::jsonb\`)`.

## Info

### IN-01: `GESTIMUS_SECRET_KEY_PREVIOUS` not covered by the prod weak-secret guard

**File:** `server/src/env.ts:44, 87-91`
**Issue:** `SECRET_ENV_KEYS` does not include `GESTIMUS_SECRET_KEY_PREVIOUS`. During a key rotation a weak/placeholder previous key in production passes validation, even though it is still used to decrypt/verify legacy data.
**Fix:** Add `GESTIMUS_SECRET_KEY_PREVIOUS` to `SECRET_ENV_KEYS` (the guard already skips empty/undefined values).

### IN-02: `SESSION_COOKIE_SECRET` weak-pattern check excludes signing secret used by @fastify/cookie

**File:** `server/src/env.ts:87-91`
**Issue:** Good that `SESSION_COOKIE_SECRET` is in the list — disregard; this confirms coverage. Note instead that `PUBLIC_BASE_URL` is `z.string().optional()` (not `.url()`), so a malformed base URL silently flows into email links.
**Fix:** Use `z.string().url().optional()` for `PUBLIC_BASE_URL` (placeholder `{tenant}` substitution can be validated separately or the URL validation relaxed only if the placeholder is present).

### IN-03: `replyDomainError` 404 path ignores `code`

**File:** `server/src/lib/domain-error.ts:23`
**Issue:** For `status === 404` it returns `reply.notFound()` and silently drops any `code` the caller attached, so a stable client-facing error code is lost specifically for 404s while preserved for 400/403/409.
**Fix:** If a 404 carries a `code`, send `reply.code(404).send({ error: e.message, code: e.code })` to keep the contract uniform; otherwise document that 404 never carries a code.

### IN-04: `parsePagination` silently swallows invalid query params

**File:** `server/src/lib/pagination.ts:25-32`
**Issue:** On `safeParse` failure (e.g. `limit=abc` or `limit=999999` over MAX_LIMIT) the function falls back to `{}` and returns defaults instead of surfacing a 400. A client requesting `limit=50000` gets 100 rows with no error, masking the misuse. The docblock claims over-limit requests "vengono rifiutate dallo schema" but the catch-all `: {}` defeats that for the parse-failure branch.
**Fix:** Distinguish "absent" (use default) from "present but invalid" (reply 400). Parse `limit`/`offset` independently, or have callers use `.parse()` and let the global ZodError handler return 400.

### IN-05: `extractSubdomain`/static bypass allows `/uploads/` through without active-tenant gate

**File:** `server/src/middleware/tenant.ts:174` + `server/src/app.ts:245`
**Issue:** The tenant onRequest hook bypasses tenant resolution for `/uploads/` and, in the static-bypass branch, only sets `req.tenant` if `found.stato === 'attivo'`. Public logo/document files under a suspended tenant remain statically downloadable (the static handler serves by path, not by tenant state). Likely acceptable (logos/docs are public material) but the suspension semantics ("tenant non disponibile") are not enforced for static assets — worth a conscious decision.
**Fix:** If suspended-tenant assets must be hidden, add a path-prefix check in the BLOCKED_STATIC/onRequest hook that resolves the tenant slug from the `/uploads/<slug>/` segment and 404s when not active.

### IN-06: Magic numbers / duplicated CSP and timeout literals

**File:** `server/src/app.ts:64-66, 117, 221` ; `server/src/db/client.ts:12-13,22-23`
**Issue:** Several tuned literals (requestTimeout 30_000, rate-limit `120`, HSTS maxAge 15552000, idle/connection timeouts) are inline magic numbers duplicated across files. Low risk but hampers consistent tuning.
**Fix:** Hoist to named constants or env-driven config where they may differ per deploy.

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
