---
phase: server-auth-security
reviewed: 2026-06-07T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - server/src/middleware/auth.ts
  - server/src/middleware/tenant.ts
  - server/src/routes/auth.ts
  - server/src/routes/audit.ts
  - server/src/routes/privacy.ts
  - server/src/services/session.ts
  - server/src/services/password.ts
  - server/src/services/totp.ts
  - server/src/services/keys.ts
  - server/src/services/crypto-smtp.ts
  - server/src/services/audit.ts
  - server/src/lib/token.ts
findings:
  critical: 2
  warning: 7
  info: 5
  total: 14
status: issues_found
---

# Server Auth & Security Cluster: Code Review Report

**Reviewed:** 2026-06-07
**Depth:** deep
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This is the auth/security core: cookie-session auth, tenant resolution + RLS, login + 2FA (TOTP), audit-log tamper-evidence, key derivation/rotation, SMTP credential encryption, and GDPR self-service. The architecture is generally sound — sessions store only SHA-256 hashes, HKDF domain separation is correct, Argon2id parameters are reasonable, GCM is used for SMTP, and most timing-safe paths exist.

Two real defects stand out: the MFA challenge is not bound to the tenant or to the password epoch (a stale/cross-context challenge can complete login), and TOTP codes are replayable within their validity window because no "last used counter/step" is enforced. Several warnings concern non-constant-time recovery-code comparison, missing absolute-deadline handling on refresh, and an audit-scrub ILIKE that can match unrelated rows.

## Critical Issues

### CR-01: MFA challenge not bound to tenant context — cross-context login completion

**File:** `server/src/routes/auth.ts:143-187`, `server/src/services/totp.ts:131-150`
**Issue:** `createMfaChallenge(account.id)` signs only `accountId.exp`. `verify-totp` then does `dbSuper.select()...where(eq(accounts.id, accountId))` with NO tenant scoping and NO check that `req.tenant.id === account.tenantId` (or that the request is even on the same subdomain as the originating `/login`). The challenge is a bearer token proving "password correct for account X" that is valid on ANY subdomain for 5 minutes. A challenge minted on tenant A's login can be replayed against `verify-totp` on a different subdomain to mint a session whose cookie carries `tenantId = A`. While `requireAuth` later rejects a tenant-mismatched cookie, the session is still *created* and `lastLoginAt`/audit are written in a context the user never authenticated against, and the binding invariant ("you authenticated on the subdomain you got the cookie for") is broken. The MFA path is also the one login branch that skips the `req.tenant`/`req.isSuperadmin` gate entirely.
**Fix:** Bind the challenge to the tenant and re-validate it in verify-totp:
```ts
// totp.ts — include tenantId in signed payload
export function createMfaChallenge(accountId: string, tenantId: string): string {
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${accountId}.${tenantId}.${exp}`;
  return `${payload}.${challengeSig(payload)}`;
}
// verify-totp: after decoding, require account.tenantId === decoded.tenantId
// AND that the current request context matches:
if (req.tenant ? account.tenantId !== req.tenant.id : account.role !== 'superadmin') {
  return reply.code(401).send({ error: 'credenziali non valide' });
}
```

### CR-02: TOTP code replay within validity window (no last-used step enforcement)

**File:** `server/src/services/totp.ts:81-93`, `server/src/routes/auth.ts:168-169,185`
**Issue:** `verifyTotp` accepts any code matching counter steps `[-1, +1]` around now, and the route stores `totpLastUsedAt` (a timestamp) but never enforces it. The same 6-digit code remains valid for ~60-90s and can be submitted multiple times. Combined with `LOGIN_RL_MAX = 10/15min`, an attacker who observes/phishes one live code (or a shoulder-surf) can replay it across concurrent sessions until it expires. RFC 6238 §5 requires rejecting a previously-accepted code. The recovery-code path is correctly one-time (consumed), but the OTP path is not.
**Fix:** Track and reject the last consumed step. Persist the accepted counter (e.g. `totpLastStep`) and refuse any step `<=` it:
```ts
// verifyTotp should return the matched counter (or -1)
const step = verifyTotpStep(account.totpSecret, code, 1, Date.now());
if (step < 0 || (account.totpLastStep != null && step <= account.totpLastStep)) {
  return reply.code(401).send({ error: 'codice 2FA non valido' });
}
await dbSuper.update(accounts).set({ totpLastStep: step, totpLastUsedAt: new Date() })
  .where(eq(accounts.id, account.id));
```

## Warnings

### WR-01: Recovery-code verification is not constant-time and not single-use atomic

**File:** `server/src/routes/auth.ts:172-177`
**Issue:** `(account.totpRecoveryCodes ?? []).filter((h) => h !== codeHash)` uses JS string `!==`, which short-circuits — a timing oracle on stored hashes (mitigated by SHA-256 pre-image, so low) — but more importantly the read-filter-write is NOT atomic: two concurrent verify-totp requests with the same valid recovery code both read the old array, both see it as valid, and both succeed (last write wins), so a one-time code can authenticate twice under a race. Rate limit (10/15min) reduces but does not eliminate this.
**Fix:** Consume the recovery code in a single conditional UPDATE inside a transaction (e.g. `UPDATE ... SET totpRecoveryCodes = array_remove(totpRecoveryCodes, $hash) WHERE id = $id AND $hash = ANY(totpRecoveryCodes) RETURNING`), treating `rowCount === 0` as "already used / invalid". Use `timingSafeEqual` on the hashes if a constant-time comparison is desired.

### WR-02: verify-totp does not enforce the request context (tenant vs superadmin)

**File:** `server/src/routes/auth.ts:160-164`
**Issue:** Unlike `/login` (which branches on `req.tenant` / `req.isSuperadmin` and rejects when neither is set), verify-totp loads the account purely by id from the signed challenge and never checks the current context. A superadmin account's challenge could be completed from a tenant subdomain (and vice-versa) creating a session in the wrong context. This is the same root invariant as CR-01 and should be fixed together.
**Fix:** After loading `account`, require `req.tenant?.id === account.tenantId` for tenant accounts, or `req.isSuperadmin && account.role === 'superadmin'` for platform; otherwise 401.

### WR-03: Session refresh in middleware does not honor the absolute deadline cookie expiry

**File:** `server/src/middleware/auth.ts:58-60`, `server/src/services/session.ts:116-126`
**Issue:** `validateSessionToken` clamps the rolling refresh to the absolute deadline (good), but when `refreshed` is true the middleware re-emits the cookie with `result.session.expiresAt`. Near the absolute cap the DB `expiresAt` equals the cap, so the cookie is set to expire at the cap — fine. However, when the rolling target is clamped and `newExpiresAt.getTime() === session.expiresAt.getTime()` no update occurs and `refreshed` stays false, so the user can be silently logged out at the original cookie expiry even though the DB session is still technically alive until the cap. Minor UX inconsistency between cookie lifetime and server-side session lifetime near the cap.
**Fix:** When within the refresh window but clamped, still re-emit the cookie with the (capped) `expiresAt` so the browser cookie lifetime always matches the server session, or document that the last day before cap is non-rolling.

### WR-04: Audit PII-scrub ILIKE can match and re-sign unrelated rows

**File:** `server/src/routes/privacy.ts:370-380, 391-421`
**Issue:** The erasure scrub selects audit rows with `payload::text ILIKE '%<email>%'`. A short or common erased email substring (e.g. `a@x.it`) can match payloads of *other* subjects that merely contain the substring, after which `scrubEmailDeep` only removes exact matches but the row is still re-signed and rewritten via `dbSuper` (bypassing RLS, across the whole tenant). This both over-touches rows and silently rewrites audit history for non-targeted records. Because re-signing changes `sig`, an integrity check later cannot distinguish a legitimate scrub from tampering.
**Fix:** Restrict the email match to structured payload keys rather than full-text ILIKE, or gate the rewrite on `scrubEmailDeep` actually having changed the payload (`if (JSON.stringify(before) === JSON.stringify(after) && !ip/uaChange) skip`). Never rewrite a row whose content did not change.

### WR-05: privacy/audit writes bypass append-only RLS via dbSuper without re-asserting tenant

**File:** `server/src/routes/privacy.ts:377-421`
**Issue:** The audit scrub reads and writes `auditLog` through `dbSuper` (RLS-bypassing super role), scoped only by an application-level `eq(auditLog.tenantId, req.tenant.id)`. If `req.tenant` were ever null here it would scrub cross-tenant; it is guarded at line 185 for `/erase`, but the dependency on a single app-level WHERE for tenant isolation on a super-privileged connection is fragile. A missing/incorrect condition is a cross-tenant data-modification path.
**Fix:** Add a defensive assertion (`if (!req.tenant) throw`) immediately before the dbSuper block, and prefer routing tenant-scoped audit mutations through an RLS-aware path or a stored function that enforces `tenant_id` server-side.

### WR-06: Login user-enumeration via timing/branch divergence on inactive accounts

**File:** `server/src/routes/auth.ts:115-126`
**Issue:** The dummy-hash verify only runs when `!account || !account.attivo`. A real-but-active account with a wrong password runs the real Argon2 verify (line 122). The two paths have comparable cost, but an account that exists and is *active* vs one that does not exist still differ in which audit action fires (`login_failed` with `account.id` vs `null`) and potentially in DB query shape (tenant-scoped select returns a row vs not). The audit divergence is internal, but the existence of `account.id` in the failure audit, combined with the fact that the dummy verify uses a fixed canned hash whose Argon2 params match, is generally fine — the residual concern is the inactive-account branch returning 401 with the dummy verify having a different memory-access pattern than a real stored hash with different params.
**Fix:** Always run a real Argon2 verify against either the account hash or a per-process canned hash generated with the SAME `ARGON2_OPTIONS`, regardless of account existence/active state, and keep audit actorAccountId out of the response. (Largely already done; tighten so the active/inactive/missing branches are timing-indistinguishable.)

### WR-07: TOTP setup overwrites an existing pending/active secret without confirmation

**File:** `server/src/routes/auth.ts:232-243`
**Issue:** `POST /totp/setup` unconditionally sets `totpSecret` and `totpEnabled: false` for the account. If 2FA is already ENABLED, calling setup silently disables verification readiness (it sets `totpEnabled: false`), effectively a 2FA downgrade reachable with only a valid session (no password re-confirmation), undermining the password-reconfirm guard that `disable` was given at line 289.
**Fix:** Reject setup when `totpEnabled` is already true (require disable-with-password first), or require password re-confirmation in setup as well:
```ts
if (acc.totpEnabled) return reply.code(409).send({ error: '2FA già attivo, disattivalo prima' });
```

## Info

### IN-01: Session token entropy is 160 bits but min-length check is weak

**File:** `server/src/services/session.ts:28-31, 67`
**Issue:** `randomBytes(20)` base32-encodes to 32 chars; the guard `token.length < 16` is far below the real length and only filters obviously truncated tokens.
**Fix:** Tighten to the expected encoded length (`!== 32`) for clarity; no security impact since lookup is by hash.

### IN-02: `extractSubdomain` IPv6 detection is heuristic

**File:** `server/src/middleware/tenant.ts:39`
**Issue:** `host.includes(':')` treats any colon as IPv6, but the port was already stripped at line 34, so this is fine; however a bracketed IPv6 `[::1]` keeps brackets in `host` and would be split on `.` producing an odd label. Edge case only (literal IPv6 access is non-production).
**Fix:** Strip brackets and validate explicitly, or document that IP-literal access is unsupported.

### IN-03: `decryptWith` JSON.parse on decrypted SMTP blob is untyped

**File:** `server/src/services/crypto-smtp.ts:58`
**Issue:** `JSON.parse(...)` is cast to `SmtpConfigPlain` without schema validation. GCM guarantees integrity so a forged blob can't decrypt, but a malformed-but-authentic legacy blob would pass through unchecked.
**Fix:** Validate the parsed object with a zod schema before returning.

### IN-04: Recovery codes generated with base32 of 7 bytes sliced to 10 chars

**File:** `server/src/services/totp.ts:99`
**Issue:** `base32Encode(randomBytes(7))` yields ~12 chars; slicing to 10 keeps ~50 bits entropy — adequate, but the slice discards entropy non-obviously.
**Fix:** Document the entropy budget or generate exactly the needed bytes.

### IN-05: `auditLogin` swallows all errors as warn — silent audit gaps

**File:** `server/src/routes/auth.ts:43-45`
**Issue:** Best-effort audit is intentional, but a persistent audit-write failure (e.g. RLS misconfig) would silently drop all login forensics with only a warn log. For a security-critical audit trail consider alerting on repeated failures.
**Fix:** Increment a metric/counter on audit failure so monitoring can detect a broken audit pipeline.

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
