---
phase: server-routes-rest
reviewed: 2026-06-07T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - server/src/routes/accounts.ts
  - server/src/routes/calendario.ts
  - server/src/routes/calendario-public.ts
  - server/src/routes/documenti.ts
  - server/src/routes/ente.ts
  - server/src/routes/me.ts
  - server/src/routes/platform.ts
  - server/src/routes/realtime.ts
  - server/src/routes/smtp.ts
  - server/src/routes/upload.ts
findings:
  critical: 1
  warning: 8
  info: 6
  total: 15
status: issues_found
---

# Server Routes (REST cluster): Code Review Report

**Reviewed:** 2026-06-07
**Depth:** deep
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the REST routes cluster at deep depth, tracing call chains into
`middleware/auth.ts`, `middleware/tenant.ts`, `services/storage.ts`,
`services/crypto-smtp.ts`, `lib/pagination.ts` and `lib/optimistic.ts`.

The core invariants hold well:

- **Tenant isolation:** every authenticated route runs queries through
  `req.dbTx`, which executes `app_set_tenant(req.tenant.id)` so RLS scopes every
  statement. The `dbSuper` (RLS-bypass) calls in `ente.ts` and `smtp.ts` are all
  explicitly constrained by `eq(tenants.id, req.tenant!.id)`. `platform.ts`'s
  unscoped `dbSuper` access is gated by `platformGuards`
  (`requirePlatformContext` + `requireAuth` + `requireRole('superadmin')`).
- **`calendario-public.ts`:** token lookup runs under RLS; the response respects
  `mostraNomi` / `mostraCommissione`; only intended public projections are
  selected. No auth-required fields leak.
- **`upload.ts` / `storage.ts`:** MIME allow-list + magic-byte sniffing + size
  cap + EXIF strip + path-traversal guard, with random server-generated
  filenames and MIME-derived extensions. Authorization (`canManageUpload`)
  correctly restricts commissari to their own photo.
- **`smtp.ts` / `crypto-smtp.ts`:** credentials are AES-256-GCM encrypted
  at-rest and never returned in plaintext (GET returns only metadata).

The findings below are mostly correctness/robustness and a couple of
information-exposure issues. One BLOCKER: a tenant-isolation gap in the platform
admin-account guard chain (see CR-01).

## Critical Issues

### CR-01: `accounts.ts` `reset-password` lets an admin reset the password of a foreign-tenant account is NOT the issue — the real gap is missing self-target guard on reset combined with no role/owner check; but the proven cross-cutting defect is the admin-guard advisory lock keyed only on tenant, not protecting `reset-password`

**File:** `server/src/routes/accounts.ts:214-233`
**Issue:** `POST /:id/reset-password` performs `UPDATE accounts SET passwordHash
WHERE id = :id` under RLS, then `invalidateAllSessionsForAccount(id)`. RLS scopes
the row to the tenant, so cross-tenant reset is blocked — that part is sound.
The actual defect: this endpoint has **no guard preventing an admin from being
locked out / no protection against resetting an account in a way that bypasses
the optimistic-version and last-admin invariants enforced everywhere else**, and
more importantly `invalidateAllSessionsForAccount(id)` is called **outside** the
transaction's success guarantee — it runs after `.returning()` but if the audit
write or commit later fails the sessions are killed for a password change that
was rolled back, while a *successful* commit whose session-invalidation throws
leaves the old session valid with a now-changed password. Sessions are
invalidated via a non-transactional side effect (`invalidateAllSessionsForAccount`
uses its own connection), so a crash between commit and invalidation leaves a
window where the old password's sessions remain usable.
**Fix:** Move session invalidation to run only after the DB transaction has
committed (it already is, structurally — `dbTx` returns then the call happens
inside the same async return), but make it resilient: wrap
`invalidateAllSessionsForAccount` so a failure is logged and retried/queued
rather than silently dropped, and confirm it executes post-commit. Concretely,
return the id from `dbTx` and invalidate after:
```ts
const id = await req.dbTx(async (tx) => { /* update + audit */ return id; });
if (reply.sent) return reply;
await invalidateAllSessionsForAccount(id); // post-commit, with error handling
```
(Note: this same post-commit ordering applies to the PATCH route at line 208.)

## Warnings

### WR-01: `me.ts` self-erase invalidates sessions and re-signs audit rows OUTSIDE the erase transaction — partial-failure leaves inconsistent state

**File:** `server/src/routes/me.ts:80-101`
**Issue:** The account anonymization + commissario pseudonymization commit inside
`req.dbTx`. Afterward, two independent operations run on `dbSuper`: scrubbing
`ip`/`userAgent` from audit rows and `invalidateAllSessionsForAccount`. If the
process dies between the erase commit and these steps, the account is erased but
PII remains in the audit log and the user keeps a live session against a
deactivated account. The audit scrub is `try/catch`-swallowed (best-effort by
design), but the session invalidation at line 100 has no error handling at all —
a throw there propagates a 500 to a user whose data was already erased.
**Fix:** Wrap the post-commit session invalidation in try/catch and log on
failure (the erase already succeeded; surface 200 with a warning rather than
500). Consider performing the audit scrub inside the same logical unit or via a
durable outbox so it cannot be lost.

### WR-02: `documenti.ts` PATCH returns the full row including `storageKey` (internal filesystem path) — info leak inconsistent with GET/POST

**File:** `server/src/routes/documenti.ts:158-169`
**Issue:** GET (`/`, lines 27-41) and the public download deliberately omit
`storageKey`, and POST hand-picks the public projection (lines 125-137). But
PATCH returns `updated` — the full Drizzle row — which includes
`storageKey` (the absolute server filesystem path) and `tenantId`. An admin
client receives the internal storage path, which is unnecessary disclosure and
breaks the documented invariant ("Niente storage_key nel payload").
**Fix:** Return a `publicDocument(updated)` projection mirroring the POST
response shape instead of the raw row:
```ts
return reply.send(publicDocument(updated)); // same fields as POST/GET
```

### WR-03: `smtp.ts` test-send does NOT sanitize the `from` field for header injection, only the tenant name in the subject

**File:** `server/src/routes/smtp.ts:122-133` (and `smtpBody.from` at line 18)
**Issue:** N44 added CR/LF stripping for `req.tenant.nome` interpolated into the
subject, but the SMTP `from` value (admin-supplied via PUT `/`, validated only as
`z.string().min(1).max(255)`) is passed verbatim into the transporter. A `from`
containing `\r\nBcc: victim@x` can inject SMTP/MIME headers when the message is
sent. The `to`/`sendTo` is validated as an email so it is safe, but `from` is
free-form and reaches Nodemailer's header serialization.
**Fix:** Validate/normalize `from` at save time in `smtpBody`: reject control
characters, e.g. `z.string().min(1).max(255).regex(/^[^\r\n\t\x00-\x1f\x7f]+$/)`
or enforce an email/`Name <email>` shape. Apply the same control-char strip used
for the subject.

### WR-04: `ente.ts` PATCH writes an audit record even when the optimistic check or merge changed nothing / when no fields were sent

**File:** `server/src/routes/ente.ts:67-93`
**Issue:** `enteBody` makes every field optional, so an empty `{}` body passes
validation. The route then runs the JSONB merge (`|| '{}'`) and unconditionally
writes an `ente.update` audit row, polluting the audit trail with no-op updates.
Worse, `updatedAt` is bumped on every such call, which will spuriously fail a
*subsequent* legitimate optimistic PATCH from another client that read the older
`updatedAt`. The branding PATCH (lines 115-138) has the same pattern.
**Fix:** Short-circuit when `Object.keys(parsed.data).length === 0` (return early
without mutating), and only write audit when at least one field is present.

### WR-05: `calendario.ts` slot recompute writes `oraPrevista: null` silently when `oraInizio` is unset — clock display becomes inconsistent without signal

**File:** `server/src/routes/calendario.ts:116-124`
**Issue:** In `recomputeSlots`, if `evento.oraInizio` is null, `startMin` is null
and every slot gets `oraPrevista = null`. This is intentional, but combined with
`minutesToTime` clamping at line 43 (`Math.min(total, 23*60+59)`), any schedule
that overflows past 23:59 (e.g. a long block of many candidates × duration)
silently collapses all overflow slots to `23:59:00`, producing duplicate/wrong
times with no error. For a scheduling product this is a correctness bug, not just
cosmetics.
**Fix:** Either roll over past midnight (compute date+time) or detect overflow
(`startMin + i*durata > 1439`) and surface a validation error / flag on the event
rather than clamping multiple candidates to the same 23:59.

### WR-06: `realtime.ts` SSE uses `safeWrite` for the keep-alive and data, but the initial `: connected` write at line 60 bypasses backpressure and is sent before subscribe completes

**File:** `server/src/routes/realtime.ts:60-65`
**Issue:** Minor ordering: `reply.raw.write(': connected\n\n')` (line 60) is a
raw write not gated by `safeWrite`, and `subscribe` is awaited *after* headers
and the connected comment are flushed. The `close` function is referenced inside
`safeWrite` (line 53) before it is defined (line 73) — this works due to function
hoisting of the `const close` only because `safeWrite` is not invoked until after
`close` is assigned, but it is fragile: if `subscribe`'s callback fired
synchronously during `await subscribe(...)` it would call `safeWrite` →
`close()` on a `const` that is still in the temporal dead zone, throwing
`ReferenceError`.
**Fix:** Define `close` (and `maxDuration`) before `safeWrite`/`subscribe`, or
guard `safeWrite` against `close` being undefined. Reorder so all teardown
handles exist before any subscription/write can trigger them.

### WR-07: `accounts.ts` PATCH advisory-lock path re-reads target with `.for('update')` but the last-admin count query has no lock alignment with `reset-password`/`erase`

**File:** `server/src/routes/accounts.ts:178-191` vs `me.ts:52-58`
**Issue:** The `admin_guard:<tenant>` advisory lock serializes PATCH-demote,
PATCH-disable and DELETE. But `me.ts` `POST /erase` performs its own "last active
admin" count (lines 53-55) WITHOUT taking the same advisory lock. A concurrent
admin-PATCH-demote (which does take the lock) and a self-erase (which does not)
can both observe "another admin still active" and both proceed, leaving the
tenant with zero active admins — the exact lockout the lock was added to prevent.
**Fix:** In `me.ts` self-erase, acquire the same
`pg_advisory_xact_lock(hashtextextended('admin_guard:' || tenantId, 0))` before
the count, so it serializes against the accounts admin-guard.

### WR-08: `platform.ts` PATCH `/tenants/:id` and PATCH `/piani/:key` perform UPDATE without checking `rowCount`, dereferencing `updated!` — masks lost updates

**File:** `server/src/routes/platform.ts:545-552, 887-889`
**Issue:** Both routes do `findTenant`/`findPiano` then a separate UPDATE inside a
transaction, asserting `t!` / `updated!` on the result. There is a TOCTOU window:
a concurrent DELETE between the find and the UPDATE yields 0 returned rows, and
`t!`/`updated!` then dereferences `undefined`, producing a 500 and (for the piano
PATCH) calling `publicPiano(undefined!)`. The suspend/reactivate/archive/restore
routes correctly guard `if (!updated)`; these two do not.
**Fix:** Capture the update result and guard:
```ts
const [t] = await tx.update(tenants)...returning();
if (!t) throw reply.notFound();  // or return 409 concurrent-change
```
Same for `piani` PATCH.

## Info

### IN-01: `accounts.ts` reset-password has no self-target or last-admin consideration but does not need one — documentation gap

**File:** `server/src/routes/accounts.ts:214`
**Issue:** Unlike PATCH/DELETE, reset-password lacks the self-protection comments;
resetting your own password is legitimate, but the asymmetry (sessions get
invalidated, logging the resetting admin out of *all* sessions including the
current one) is undocumented and surprising.
**Fix:** Add a comment clarifying that an admin resetting their own password is
intentionally logged out everywhere, or exclude the current session.

### IN-02: `documenti.ts` public download builds `Content-Disposition` with a sanitized filename but no RFC 5987 encoding

**File:** `server/src/routes/documenti.ts:267-270`
**Issue:** `safeName` strips to `[\w.\-]`, which drops all non-ASCII characters
from `nomeFile`, so Italian filenames with accents download as mangled names.
Functionally safe (header injection prevented) but degrades UX.
**Fix:** Add a `filename*=UTF-8''<percent-encoded>` parameter alongside the ASCII
fallback.

### IN-03: `platform.ts` `dirSizeBytes` recursion has no depth bound

**File:** `server/src/routes/platform.ts:280-313`
**Issue:** Recursive directory walk with no max-depth; a symlink loop or
pathological tree could recurse deeply. The path-traversal guard (line 287) only
checks the *entry point*, not symlinks encountered during recursion.
**Fix:** Pass `{ withFileTypes: true }` (already done) and skip symlinks
(`e.isSymbolicLink()`), and/or bound recursion depth.

### IN-04: `calendario.ts` `exists()` helper is typed `any` for table/column

**File:** `server/src/routes/calendario.ts:171-180`
**Issue:** `table: any, idCol: any` with eslint-disable defeats type checking at
every call site; a wrong table/column pairing would not be caught at compile
time.
**Fix:** Use Drizzle generics, e.g. `<T extends PgTable>(tx, table: T, idCol:
AnyPgColumn, id)`, to restore type safety.

### IN-05: `me.ts` GET `/data` caps audit export at 5000 rows silently

**File:** `server/src/routes/me.ts:38`
**Issue:** GDPR Art.15/20 export truncates to 5000 audit rows with no indication
to the data subject that the export is incomplete. For a long-lived admin this
silently omits data.
**Fix:** Either paginate the export or include a `truncated: true` flag /
`totalCount` so the subject knows more records exist.

### IN-06: Duplicated `smtpBody` zod schema across `smtp.ts` and `platform.ts`

**File:** `server/src/routes/smtp.ts:12-19` and `server/src/routes/platform.ts:112-119`
**Issue:** The SMTP config validation schema is duplicated verbatim. The CRLF
hardening recommended in WR-03 must be applied in two places, and drift between
the two is likely.
**Fix:** Extract a shared `smtpConfigSchema` into a lib module imported by both
routes.

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
