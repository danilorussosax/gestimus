---
phase: server-services-cluster
reviewed: 2026-06-07T08:17:32Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - server/src/services/backup.ts
  - server/src/services/cleanup.ts
  - server/src/services/email.ts
  - server/src/services/event-handlers.ts
  - server/src/services/events.ts
  - server/src/services/iscrizione-email.ts
  - server/src/services/storage.ts
  - server/src/services/system-metrics.ts
  - server/src/services/valutazioni-service.ts
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Server Services Cluster: Code Review Report

**Reviewed:** 2026-06-07T08:17:32Z
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Deep cross-file review of the services layer (backup/cleanup/DR, email/SMTP, outbox events, storage, metrics, authoritative scoring). The crypto envelope, HKDF key separation, outbox at-least-once contract, RLS-scoped writes, SMTP secret handling, and SSRF-resistant verify-URL construction are all sound and well-reasoned. The serious problems are concentrated in the **backup/restore DR path**, which is the project's data-loss safety net and is exercised destructively by the automated cleanup job.

Two BLOCKERs: (1) several tenant-scoped tables are silently omitted from `TENANT_TABLES`, so a backup taken right before the cleanup job's cascade-DELETE does not capture them — restore loses that data permanently; (2) the restore JSON reviver coerces any user text matching an ISO-datetime prefix into a `Date`, corrupting `text` columns on restore.

## Critical Issues

### CR-01: Backup omits tenant-scoped tables → permanent data loss on cleanup+restore

**File:** `server/src/services/backup.ts:69-92`
**Issue:** `TENANT_TABLES` lists 22 tables, but the schema has tenant-scoped, `onDelete: 'cascade'` tables that are NOT included: `sale`, `eventi_calendario`, `calendario_pubblicazioni`, `documenti_ente` (and `events`). `runTenantCleanup()` (cleanup.ts:92-121) calls `backupTenant()` and then `DELETE FROM tenants`, whose cascade wipes ALL these tables. The backup is the only copy. `restoreTenant()` then iterates only `RESTORE_ORDER` (same 22 tables), so calendar events, rooms, publication tokens, and ente documents are gone forever after an automated hard-delete + DR restore. The reassuring comment "Tabelle che vivono dentro un tenant (tutte cascade-deleted con il tenant)" is factually wrong — the set is incomplete.
**Fix:** Add the missing tenant-scoped tables to `TENANT_TABLES` and to `RESTORE_ORDER` in FK-safe order (e.g. `sale` before `eventi_calendario`; `documenti_ente`, `calendario_pubblicazioni` after their parents). Add a unit test asserting that every schema table with a `tenant_id`+cascade FK is present in `TENANT_TABLES`, so future tables can't silently drop out of backup coverage. Decide explicitly whether `events`/`documenti_ente` files belong in the dump (documenti_ente also has on-disk files under uploads/<tenant>/documento/).

### CR-02: Restore JSON reviver corrupts text columns containing ISO-datetime-like values

**File:** `server/src/services/backup.ts:234,272-274`
**Issue:** The reviver coerces ANY string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}` into a `new Date(...)`. This is applied blindly to every string in the manifest, including user-controlled `text` columns (`valutazioni.note`, `criteri.nome/descrizione`, `candidati`/`commissari` free-text, etc.). A note like `"2026-01-01T10:00:00 incontro"` becomes a `Date`, which Drizzle then inserts back into a `text` column — round-trip corruption / type mismatch on restore. The regex is also unanchored at the end so trailing garbage still matches. Restore is the DR last resort, so silent data mangling here is high-severity.
**Fix:** Do not reconstruct dates via a global string-sniffing reviver. Instead drive the conversion from schema metadata: for each table, know which columns are `timestamp` (mode date) and convert only those values to `Date`, leaving `text`/`date`-string columns untouched. Alternatively serialize timestamps in a typed envelope at backup time. At minimum, anchor the regex (`...:\d{2}(\.\d+)?Z?$`) and exclude known text columns.

## Warnings

### WR-01: `deleteFile` path-guard is vulnerable to sibling-prefix bypass

**File:** `server/src/services/storage.ts:193-200` (same pattern at `saveFile` `167`)
**Issue:** `normalized.startsWith(root)` matches `/app/uploads-secret/...` as if it were inside `/app/uploads` (verified: `"/app/uploads-secret".startsWith("/app/uploads") === true`). If any caller ever passes a path whose value derives from outside-controlled data, the guard is defeated. Current callers pass DB-stored keys/random filenames (not directly attacker-controlled), so it is not presently exploitable — hence WARNING, not BLOCKER — but it is the project's last-line traversal defense and is silently weaker than it reads.
**Fix:** Compare against `root + path.sep` (and treat exact-equal-to-root as inside): `const base = root.endsWith(sep) ? root : root + sep; if (normalized !== root && !normalized.startsWith(base)) throw ...`. Apply the same to `saveFile` line 167.

### WR-02: `pruneOldBackups` deletes across ALL tenants by mtime, no per-tenant retention floor

**File:** `server/src/services/backup.ts:350-366` / called at `cleanup.ts:141`
**Issue:** Retention is global by file mtime only. A tenant that was archived+deleted and whose single DR dump is older than `BACKUP_RETENTION_DAYS` will have its only backup pruned — even though the live data no longer exists (it was hard-deleted by the same cleanup job). There is no guarantee of "keep at least the latest backup per tenant." Combined with CR-01 this widens the data-loss blast radius.
**Fix:** Before unlinking, parse the slug (regex already exists, line 313) and never delete the most-recent backup for any slug; or skip pruning dumps whose tenant no longer exists. Log each deletion at info level for auditability.

### WR-03: `restoreTenant` accepts an arbitrary filesystem path with no containment check

**File:** `server/src/services/backup.ts:242,247`
**Issue:** `readFile(filepath)` reads whatever path is passed, with no validation that it lives under `ARCHIVE_DIR`. The doc says "Da usare via script ops, non via HTTP," but nothing enforces that — if a future route or ops wrapper forwards a user value, it is an arbitrary-file-read + decrypt-attempt primitive.
**Fix:** Resolve and assert the path is inside `archiveDir()` (using the sep-aware prefix check from WR-01) before reading, and/or accept only a filename and join it to the archive dir.

### WR-04: Backup buffers full gzip output in memory, partially defeating the streaming refactor

**File:** `server/src/services/backup.ts:155,198`
**Issue:** The streaming comment (N117) claims to avoid holding all tables + JSON in RAM, but `gzChunks` accumulates the entire compressed output and `Buffer.concat` materializes it whole before encryption. For a large tenant this still produces a single large buffer (compressed, but unbounded). The per-table `await dbSuper.select(...)` also loads each table fully into memory. Not a correctness bug, but the stated OOM mitigation is weaker than documented. (Performance is out of v1 scope; flagged because the comment asserts a guarantee the code does not provide, which misleads future maintainers.)
**Fix:** Either stream gzip → cipher → file via pipeline (encrypt incrementally; GCM tag appended at end requires a header rewrite or tag-trailer format), or downgrade the comment to reflect that only per-table JSON stringification is streamed, not the final artifact.

### WR-05: `getTransporter` swallow on `cache.get(cacheKey)?.transporter.close()` could throw on stale entry

**File:** `server/src/services/email.ts:94`
**Issue:** `cache.get(cacheKey)?.transporter.close()` is not wrapped in try/catch, unlike the other two `.close()` sites (lines 25, 115 use try/catch). If nodemailer's `close()` throws on an already-failed transporter, `getTransporter` rejects and email sending fails even though a fresh transporter was just built. Minor but inconsistent with the deliberate best-effort pattern used elsewhere in the same file.
**Fix:** Wrap in `try { ... } catch { /* best-effort */ }` to match lines 25 and 115.

## Info

### IN-01: Outbox `events` table never reset from a 'processing' state — documented but `processing` status is unreachable dead value

**File:** `server/src/services/events.ts:44-105`; `server/src/db/schema.ts:953`
**Issue:** The status check constraint allows `'processing'`, and comments reference avoiding "stato processing orfano," but the code only ever sets `pending`/`done`/`failed` (claim is via `FOR UPDATE SKIP LOCKED`, not a status write). `'processing'` is dead in the schema enum. Harmless, but a maintainer may assume a processing lifecycle exists.
**Fix:** Drop `'processing'` from the check constraint, or add a comment that it is reserved/unused.

### IN-02: `verifyTenantSmtp` returns raw SMTP error string to caller

**File:** `server/src/services/email.ts:152-161`
**Issue:** `error: (err as Error).message` can surface SMTP server banners / hostnames to the admin UI. Low risk (admin-only super-admin context), but SMTP errors occasionally echo credentials/host details.
**Fix:** Map to a generic message and log the detail server-side; or confirm the consumer is super-admin-only and acceptable.

### IN-03: `system-metrics` first immediate sample can race with `startSystemMetricsSampler` returning a no-op stopper

**File:** `server/src/services/system-metrics.ts:52-62`
**Issue:** When already started (`if (timer) return () => {}`), the returned stop function is a no-op — a second caller who believes it owns the sampler cannot stop it. Idempotent-start is intended, but the no-op stopper silently breaks the stop contract for the second caller.
**Fix:** Return the real stopper (or document that only the first start owns lifecycle).

---

## Verified-sound (not findings)

- **valutazioni-service.ts**: scoring is server-authoritative; `voto` validated zod `min(0).max(1000)` + DB check + clamp trigger; authz re-checked under row locks (`.for('update')`) in consistent fase→candidatoFase order (no TOCTOU); upsert ON CONFLICT correct; cross-tenant PATCH/DELETE by id are RLS-scoped via `req.dbTx` (SET LOCAL app.current_tenant). No client influence on computation.
- **events.ts**: outbox at-least-once is correctly implemented; failures reach Sentry only at dead-letter (intentional, documented); no-handler case alerts; FOR UPDATE SKIP LOCKED prevents double-claim.
- **email.ts / iscrizione-email.ts**: no SMTP credential logging (only `err.message`); no plaintext-SMTP fallback (M16); recipient is zod `.email()` validated upstream; verify URL is SSRF-safe (env base or token-only, `encodeURIComponent`); no template injection (only server-built URL interpolated).
- **storage.ts**: magic-byte vs MIME check, EXIF stripping via sharp re-encode (GDPR), extension derived from MIME not filename (anti stored-XSS), atomic write+rename, slug/id sanitized.

---

_Reviewed: 2026-06-07T08:17:32Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
