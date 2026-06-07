---
status: issues_found
scope: server/src (61 source files, ~12,600 LOC)
depth: deep
date: 2026-06-07
method: 5 parallel gsd-code-reviewer agents, partitioned by subsystem
findings:
  critical: 6
  warning: 37
  info: 27
  total: 70
sub_reports:
  - docs/review/server-auth-security.md
  - docs/review/server-routes-domain.md
  - docs/review/server-routes-rest.md
  - docs/review/server-services.md
  - docs/review/server-lib-infra.md
---

# Server deep review — consolidated

Whole `server/src` subsystem reviewed at deep depth. Findings partitioned across 5
clusters; per-cluster detail in the linked sub-reports. Each reviewer traced call
chains and cross-file invariants, and documented verified-clean invariants (no
tenant-isolation break was provable — RLS + FORCE RLS + CI guard hold; scoring is
server-authoritative; middleware order is correct).

> Review only — no fixes applied. Several criticals carry reviewer caveats
> ("not currently exploitable", "verify DDL"). Verify each at the root before fixing.

## Severity rollup

| Cluster              | Critical | Warning | Info | Total |
|----------------------|---------:|--------:|-----:|------:|
| auth & security      | 2        | 7       | 5    | 14    |
| routes — domain CRUD | 0        | 9       | 7    | 16    |
| routes — rest        | 1        | 8       | 6    | 15    |
| services             | 2        | 5       | 3    | 10    |
| lib + db + infra     | 1        | 8       | 6    | 15    |
| **Total**            | **6**    | **37**  | **27** | **70** |

## CRITICAL (6)

1. **MFA challenge not tenant-bound → cross-tenant replay** — `routes/auth.ts:143-187`, `services/totp.ts:131-150`. Challenge signs only `accountId+exp`; verify-totp loads account via `dbSuper` with no tenant/context check. A challenge minted on tenant A is replayable on any subdomain for 5 min and still mints a session. → include `tenantId` in the signed challenge; require `req.tenant.id === account.tenantId` (or superadmin) in verify-totp.

2. **TOTP code replay** — `services/totp.ts:81-93`, `routes/auth.ts:168-169,185`. `verifyTotp` accepts steps `[-1,+1]`; `totpLastUsedAt` is stored but never enforced → a 6-digit code stays valid ~60-90s and can be replayed (RFC 6238 §5). → return the matched counter, reject any step `<=` persisted `totpLastStep`, persist accepted step.

3. **reset-password session invalidation non-transactional** — `routes/accounts.ts:214-233` (same risk on PATCH:208). Session invalidation is a fire-and-forget side effect after `.returning()`; a crash between commit and `invalidateAllSessionsForAccount` leaves old-password sessions usable. → run invalidation strictly post-commit with error handling/retry.

4. **backup omits cascade-deleted tables → permanent data loss on restore** — `services/backup.ts:69-92`. `TENANT_TABLES` omits tenant-scoped cascade tables (`sale`, `eventi_calendario`, `calendario_pubblicazioni`, `documenti_ente`, `events`); `cleanup.ts` backs up then hard-DELETEs the tenant → restore loses that data. → add missing tables to `TENANT_TABLES`/`RESTORE_ORDER` (FK-safe) + test asserting full cascade coverage.

5. **backup restore Date-coercion corrupts text columns** — `services/backup.ts:234,272-274`. Restore JSON reviver coerces ANY string matching an ISO-datetime prefix into a `Date`, including user text (`note/nome/descrizione`); regex end-unanchored. → drive timestamp conversion from schema column metadata, not global string sniffing.

6. **optimistic lock TOCTOU → lost update** — `lib/optimistic.ts:17-21`. `versionFresh` is a pre-read check, not atomic with the UPDATE; two concurrent PATCHes reading the same `updatedAt` both pass and both write. → move freshness predicate into the UPDATE WHERE (`eq(updatedAt, expected)`), treat 0 rows as 409, or `SELECT ... FOR UPDATE`.

## WARNING (37)

### auth & security
- `routes/auth.ts:172-177` — recovery-code check uses non-constant-time `!==` and non-atomic read-filter-write → concurrent requests consume the same one-time code twice. Fix: single conditional UPDATE, rowCount 0 = invalid.
- `routes/auth.ts:160-164` — verify-totp never validates request context (tenant vs superadmin) unlike /login. Fix: require tenant match or superadmin, else 401.
- `middleware/auth.ts:58-60`, `services/session.ts:116-126` — rolling refresh clamped to cap equals current expiresAt → `refreshed` stays false, cookie not re-emitted, lifetime drifts. Fix: re-emit cookie with capped expiresAt.
- `routes/privacy.ts:370-380,391-421` — audit PII scrub matches `payload::text ILIKE '%email%'` (substring), re-signs/rewrites rows even when nothing changed → over-touches + rewrites audit history. Fix: match structured keys, skip rewrite when unchanged.
- `routes/privacy.ts:377-421` — audit scrub reads/writes `auditLog` via RLS-bypassing `dbSuper`, isolated only by one app-level `eq(tenantId)`. Fix: defensive `if(!req.tenant) throw`, prefer RLS-aware path.
- `routes/auth.ts:115-126` — login branches differ (dummy verify only on missing/inactive; real verify on active) → account enumeration via timing/branch divergence. Fix: always run real Argon2 verify with identical options.
- `routes/auth.ts:232-243` — POST /totp/setup unconditionally sets `totpEnabled:false` even when 2FA active → 2FA downgrade with only a session, no password reconfirm. Fix: 409 when already enabled.

### routes — domain CRUD
- `routes/fasi.ts:314-379` — PATCH has no optimistic-lock (unlike concorsi) → concurrent admin edits to scoring config last-write-wins. Fix: add `expectedVersionField`+`versionFresh` under existing FOR UPDATE.
- `routes/candidati-fase.ts:143-178` — empty PATCH by commissario runs no-op UPDATE, bumps `updatedAt`, writes empty audit. Fix: reject when no keys before role gate.
- `routes/candidati-fase.ts:75-79,125-128` — assign accepts arbitrary `posizione`, no uniqueness/range → corrupts ordering vs sorteggio. Fix: `MAX(posizione)+1` under fase lock or unique constraint.
- `routes/iscrizioni.ts:720-733` — admin list `stato` filter is unvalidated free-string → out-of-enum silently returns empty instead of 400. Fix: `z.enum`.
- `routes/iscrizioni.ts:700-718` — allegato download `readFile(a.path)` has no path-confinement assertion. Fix: resolve + assert containment under tenant uploads root.
- `routes/concorsi.ts:130-347` — duplica concorso does unbounded per-row INSERTs in one tx; plan-limit only counts top-level. Fix: batch inserts, document child exclusion.
- `routes/membri-gruppo.ts:37-58` — parent `isGruppo` read without FOR UPDATE → concurrent PATCH flipping `isGruppo=false` leaves membri on non-gruppo. Fix: lock parent or DB constraint.
- `routes/candidati.ts:100-103,187-233` — PATCH can set `isGruppo=false` while membri rows exist, breaking "iscritto = persona fisica" count. Fix: reject or cascade-delete membri.
- `routes/fasi.ts:686-705` — `/conclude` correctness depends on implicit "never pass `[]` to `inArray`" → one edit from `IN ()` 500. Fix: centralize empty-array guard with comment.

### routes — rest
- `routes/me.ts:80-101` — self-erase audit-scrub + session invalidation outside the erase tx; line 100 no try/catch → throw returns 500 to a user whose data was already erased. Fix: wrap post-commit, log, return 200.
- `routes/documenti.ts:158-169` — PATCH returns full row incl. internal `storageKey` (absolute FS path) + `tenantId`. Fix: `publicDocument()` projection.
- `routes/smtp.ts:122-133` (schema:18) — SMTP `from` free-form, reaches Nodemailer header serialization unsanitized; only subject CRLF-stripped. Fix: reject control chars / enforce email shape.
- `routes/ente.ts:67-93,115-138` — empty `{}` body passes validation, writes audit row + bumps `updatedAt`. Fix: short-circuit when no fields.
- `routes/calendario.ts:116-124` (clamp:43) — schedules overflowing 23:59 silently clamp all overflow slots to `23:59:00` → duplicate/wrong times, no error. Fix: roll over past midnight or surface.
- `routes/realtime.ts:60-65,53,73` — `safeWrite` references `close` (const defined later) → TDZ ReferenceError if subscribe fires synchronously; initial write bypasses backpressure. Fix: define teardown before any write/subscribe.
- `routes/accounts.ts:178-191` vs `me.ts:52-58` — self-erase last-admin count does NOT take the `admin_guard:<tenant>` advisory lock that PATCH/DELETE use → concurrent demote + self-erase leave zero admins. Fix: acquire same advisory lock.
- `routes/platform.ts:545-552,887-889` — PATCH `/tenants/:id` + `/piani/:key` deref `t!`/`updated!` without rowCount guard → concurrent DELETE causes 500 / `publicPiano(undefined!)`. Fix: guard `if(!updated)`.

### services
- `services/storage.ts:193-200,167` — `normalized.startsWith(root)` allows sibling-prefix bypass (`/app/uploads-secret` passes for `/app/uploads`). Not currently exploitable (DB-sourced inputs). Fix: compare against `root + path.sep`.
- `services/backup.ts:350-366` (cleanup.ts:141) — `pruneOldBackups` deletes across all tenants by mtime, no per-tenant retention floor → sole DR dump of a hard-deleted tenant can be pruned. Fix: never delete latest backup per slug.
- `services/backup.ts:242,247` — `restoreTenant` reads arbitrary filepath, no containment to ARCHIVE_DIR (arbitrary-file-read if wired to a route). Fix: assert path inside `archiveDir()` or accept filename-only.
- `services/backup.ts:155,198` — `gzChunks`+`Buffer.concat` materialize full compressed artifact in RAM → "streaming, no OOM" guarantee overstated. Fix: stream gzip→cipher→file or correct the comment.
- `services/email.ts:94` — `cache.get(cacheKey)?.transporter.close()` not wrapped in try/catch (unlike 25/115) → throwing close fails an otherwise-successful getTransporter. Fix: wrap best-effort.

### lib + db + infra
- `db/client.ts:9-24` — no `statement_timeout`/`idle_in_transaction_session_timeout` on either pool → runaway query/leaked txn exhausts 20-conn pool. Fix: set on Pool or via ALTER ROLE.
- `db/client.ts:9-24` — no `ssl` option; prod TLS depends silently on DSN `sslmode=require`. Fix: enforce/validate TLS for prod DSNs.
- `lib/plan-limits.ts:46-77` — count-then-insert race; concurrent creates at `n==max-1` overshoot cap. Fix: SERIALIZABLE+retry, advisory lock on `(tenantId,resource)`, or DB-side enforcement.
- `realtime/hub.ts:36-47,84-102` — single failure emits both `error`+`end`; stale `pg.Client` listeners survive reconnect, race healthy client. Fix: `removeAllListeners()` on superseded client, no-op when `c !== client`.
- `realtime/hub.ts:75-82` — re-LISTEN loop aborts on first failing LISTEN → channels silently un-subscribed on healthy client, no further reconnect. Fix: per-channel try/catch → `scheduleReconnect()`.
- `app.ts:172-184` — `PHOTO_GATED` hook runs DB `validateSessionToken` per gated photo → thumbnail-heavy pages fan out into many session lookups. Fix: reuse auth-middleware session or short-lived cache.
- `lib/date.ts:32-39` — partial-NaN DOB (valid year, NaN month/day) returns finite/wrong age instead of NaN → a minor with corrupt month reads as adult. Fix: return NaN if any component NaN.
- `db/schema.ts:945` — `jsonb('payload').notNull().default({})` may emit malformed default depending on drizzle version. Fix: verify DDL emits `DEFAULT '{}'::jsonb`, else `sql\`'{}'::jsonb\``.

## INFO (27)

See sub-reports for the full Info list. Notable recurring themes:
- **DRY drift**: three near-identical commission-membership authz helpers (`fasi.ts:20-61`, `candidati-fase.ts:21-73`, `valutazioni-service.ts:34-91`); duplicated `smtpBody` schema (`smtp.ts:12-19`, `platform.ts:112-119`); `slugifyKey` re-implemented in `criteri.ts` vs `@gestimus/scoring`.
- **Audit PII**: `candidati.ts:226-230` logs full submitted PII on every edit → whitelist non-PII.
- **env hardening**: `GESTIMUS_SECRET_KEY_PREVIOUS` missing from `SECRET_ENV_KEYS` (env.ts:44); `PUBLIC_BASE_URL` not `.url()` (env.ts:32).
- **Silent truncation**: GDPR export caps audit at 5000 rows (`me.ts:38`); pagination falls back to defaults on invalid params instead of 400 (`pagination.ts:25-32`).
- **i18n**: `Content-Disposition` strips non-ASCII, mangling accented filenames (`documenti.ts:267-270`) → add RFC 5987 `filename*`.
- **Magic numbers**: reorder offset `10000` (fasi.ts:292); inline timeouts/rate-limits/HSTS maxAge across app.ts + client.ts.
