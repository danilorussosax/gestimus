---
phase: server-routes-domain
reviewed: 2026-06-07T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - server/src/routes/concorsi.ts
  - server/src/routes/fasi.ts
  - server/src/routes/candidati.ts
  - server/src/routes/candidati-fase.ts
  - server/src/routes/categorie.ts
  - server/src/routes/criteri.ts
  - server/src/routes/sezioni.ts
  - server/src/routes/commissari.ts
  - server/src/routes/commissioni.ts
  - server/src/routes/membri-gruppo.ts
  - server/src/routes/iscrizioni.ts
  - server/src/routes/valutazioni.ts
findings:
  critical: 0
  warning: 9
  info: 7
  total: 16
status: issues_found
---

# Server Routes Domain — Code Review Report

**Reviewed:** 2026-06-07
**Depth:** deep (cross-file: middleware/tenant.ts, lib/optimistic.ts, lib/scoring-verify.ts, services/valutazioni-service.ts, db/policies.sql)
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This is a mature, defensively-written CRUD cluster. The high-value invariants hold up under adversarial reading:

- **Tenant isolation** is enforced at the DB layer via `ENABLE + FORCE ROW LEVEL SECURITY` with `USING`/`WITH CHECK` policies on every tenant-scoped table (`db/policies.sql`), plus a CI guard that fails if any table with a `tenant_id` column lacks RLS. Missing explicit `WHERE tenant_id = ...` in the routes is therefore safe — RLS scopes both reads and writes, and FK-target existence checks return 0 rows cross-tenant. No cross-tenant read/write hole was found.
- **Scoring is server-authoritative**: `/fasi/:id/conclude` recomputes the admitted set from the DB (`computeAdmittedFromTx`) and rejects a divergent client list with `SCORING_MISMATCH` unless `override:true` is set (and then audits the deviation). The cross-fase id-injection vector is closed because the marking UPDATE is scoped with `eq(candidatiFase.faseId, id)`.
- **Optimistic locking + FOR UPDATE / advisory locks** are applied consistently across the concurrency-sensitive paths (fase transitions, timer, reorder, candidato numbering, iscrizione approve).

The findings below are the residual defects. The one BLOCKER is a logic bug in `/fasi/:id/conclude` that can throw a runtime SQL error on a legitimate request path. The remaining items are robustness/consistency gaps and a few quality nits.

## Critical Issues

None proven. After deep call-chain tracing (RLS policies, FOR UPDATE/advisory-lock placement, server-side scoring recompute, FK-existence checks), no defect rises to BLOCKER severity: tenant isolation is DB-enforced and intact, scoring is server-authoritative with audited overrides, and the concurrency-sensitive paths hold their locks. The most dangerous candidate (empty-array `inArray` in `/conclude`) is currently guarded on every reachable path and is recorded as a hardening item (WR-09) rather than a live crash.

## Warnings

### WR-01: `fasi` PATCH has no optimistic-lock support — silent last-write-wins on fase metadata

**File:** `server/src/routes/fasi.ts:314-379`
**Issue:** `concorsi` PATCH uses `expectedVersionField` + `versionFresh` to reject stale writes (concorsi.ts:354-362). The `fasi` PATCH — which mutates scoring-relevant config (`scala`, `pesi`, `metodoMedia`, `ammessi`, `tiebreakStrategy`) — has **no** optimistic lock. Two admins editing the same PIANIFICATA fase concurrently: the later write silently overwrites the earlier. Given the project invariant ("optimistic locking on mutable rows where concurrent edits happen") and that these fields directly drive the legal scoring, this is an inconsistency with the established pattern.
**Fix:** Add `expectedVersionField` to `updateBody` and a `versionFresh` check under the existing `for('update')` lock (lockRows already selects the row FOR UPDATE — extend it to read `updatedAt` and compare).

### WR-02: `candidatiFase` PATCH lets a commissario edit scheduling fields without the admin guard intent being airtight

**File:** `server/src/routes/candidati-fase.ts:143-178`
**Issue:** The role gate blocks non-admins from setting `stato/posizione/ammessoProssimaFase/eventoId/oraPrevista`. But `assertCanEditCandidatoFase` is still invoked for a commissario who sends an **empty** patch (none of the guarded fields), and an empty `updateBody` (all optional) passes validation. The UPDATE then runs `.set({ updatedAt: new Date() })` with no real change, writes an audit entry `candidato_fase.update` with an empty payload, and returns 200. This lets a commissario who is a member of the commission generate audit noise / bump `updatedAt` (which can defeat any future optimistic-lock consumer of this row) with no actual authorized change.
**Fix:** Reject when no mutable field is present: `if (Object.keys(parsed.data).length === 0) return reply.badRequest('nessun campo da aggiornare');` before the role gate.

### WR-03: `candidatiFase` assign accepts arbitrary `posizione` with no uniqueness/range coordination

**File:** `server/src/routes/candidati-fase.ts:75-79, 125-128`
**Issue:** `assignBody.posizione` is `z.number().int().positive().optional()` and inserted verbatim. There is no lock or check that the position is unique within the fase, unlike `/sorteggio` and `/start` which assign `1..N`. A manual assign can create duplicate or gapped positions, corrupting the ordering the sorteggio/runtime relies on. Auto-population in `/start` (fasi.ts:549) starts positions at `i+1` independent of existing rows.
**Fix:** Either drop client-supplied `posizione` and always compute `MAX(posizione)+1` under the fase lock, or add a unique constraint + conflict handling.

### WR-04: `iscrizioni` admin list filters `stato` against unvalidated free-string

**File:** `server/src/routes/iscrizioni.ts:720-733`
**Issue:** `q.stato` is `z.string().optional()` and pushed straight into `eq(iscrizioni.stato, q.stato)`. Not a SQL-injection risk (parameterized), but any value outside the CHECK enum (`BOZZA/INVIATA/EMAIL_VERIFICATA/APPROVATA/RIFIUTATA`) silently returns an empty list instead of a 400, masking client bugs and complicating support.
**Fix:** `stato: z.enum(['BOZZA','INVIATA','EMAIL_VERIFICATA','APPROVATA','RIFIUTATA']).optional()`.

### WR-05: `iscrizioni` allegato download — path read from DB without confinement check

**File:** `server/src/routes/iscrizioni.ts:700-718`
**Issue:** `readFile(a.path)` reads whatever absolute path is stored in `iscrizioni_allegati.path`. The value is produced by `saveFile` (trusted), so this is not directly exploitable today, but there is no defense-in-depth assertion that the resolved path stays under the tenant uploads root. If any future write path (import, migration, manual fix) ever lands an attacker-influenced or traversal value in `path`, this becomes an arbitrary-file-read. RLS scopes the row to the tenant but does not constrain the filesystem path.
**Fix:** Before reading, resolve and assert containment: `const abs = path.resolve(a.path); if (!abs.startsWith(path.resolve(uploadsRootForTenant(req.tenant.slug)))) return reply.notFound();`

### WR-06: Duplica concorso copies large structures with per-row INSERTs and no upper bound

**File:** `server/src/routes/concorsi.ts:130-347`
**Issue:** The duplica loop issues an individual INSERT per sezione/categoria/commissione/join/fase/criterio inside one transaction with no cap on source size. While correctness is fine (FK remap is sound), a concorso with thousands of rows holds a long transaction and many round-trips. More importantly there is **no validation that the source structure is bounded**, and `checkConcorsiLimit` only counts the new top-level concorso, not the children it clones — a tenant near its candidati/commissari plan limits can clone structure that the create path would have blocked. (Children excluded here are runtime data, so the candidati limit is not bypassed; but the pattern is worth noting.)
**Fix:** Batch the inserts with multi-row `.values([...])` per level, and document the intentional exclusion of plan-limited child entities.

### WR-07: `membri-gruppo` create does not re-check parent candidato is still a gruppo under lock

**File:** `server/src/routes/membri-gruppo.ts:37-58`
**Issue:** It reads `candidati.isGruppo` then inserts a membro, but without a `FOR UPDATE` on the parent. A concurrent PATCH on the candidato flipping `isGruppo` to false (candidati.ts PATCH allows `isGruppo`) can interleave, leaving membri attached to a non-gruppo candidato — an incoherent state the count logic ("iscritto = persona fisica, quartetto = 4") depends on.
**Fix:** Select the parent with `.for('update')` before inserting, or add a DB-level trigger/constraint tying membri existence to `isGruppo = true`.

### WR-08: `candidati` PATCH can change `isGruppo`/`tipoGruppo` with existing membri, no consistency guard

**File:** `server/src/routes/candidati.ts:100-103, 187-233`
**Issue:** Complementary to WR-07. PATCH accepts `isGruppo: false` even when `candidati_membri` rows exist, orphaning them logically (they remain in the table but the candidato is now "individuale"). The "iscritto = persona fisica" counting invariant can then mis-count (a former quartetto still has 4 membri rows but counts as 1 individual).
**Fix:** When PATCH sets `isGruppo=false`, either reject if membri exist or cascade-delete them inside the same tx; document the chosen semantics.

### WR-09: Implicit empty-array invariant on `effectiveAdmitted` in conclude (hardening)

**File:** `server/src/routes/fasi.ts:686-705`
**Issue:** Correctness currently depends on the `if (effectiveAdmitted.length > 0)` guard preventing `inArray(..., [])`. The invariant is undocumented and one careless edit away from emitting `IN ()` (Postgres syntax error → 500 on a legitimate conclude). See CR-01 narrative.
**Fix:** Centralize the empty-array guard (snippet in CR-01) and add a comment stating that `inArray` must never receive `[]`.

## Info

### IN-01: `fasi` reorder uses a magic offset constant

**File:** `server/src/routes/fasi.ts:292`
**Issue:** `const offset = 10000;` is a magic number used to park `ordine` values out of the unique range during the two-pass swap. If a concorso legitimately exceeds ~10000 fasi the two passes could collide. Practically impossible, but the assumption is silent.
**Fix:** Derive from `MAX(ordine)+found.length+1` or name the constant with a documented upper bound.

### IN-02: `candidati` PATCH audit payload logs full submitted data including PII

**File:** `server/src/routes/candidati.ts:226-230` (also iscrizioni/commissari updates)
**Issue:** `payload: parsed.data` writes the entire patch (which may include email, codiceFiscale, indirizzo, tutore) into the audit log. Audit immutability is desirable, but storing full PII on every edit expands the GDPR data-retention surface. Consider logging only changed field *names* or a redacted summary for PII fields.
**Fix:** Whitelist non-PII fields in audit payloads, or hash/omit PII.

### IN-03: Duplicated `assertCanManageFase` / `assertCanEditCandidatoFase` / `canEvaluateCandidatoFase` pattern

**File:** `server/src/routes/fasi.ts:20-61`, `server/src/routes/candidati-fase.ts:21-73`, `server/src/services/valutazioni-service.ts:34-91`
**Issue:** Three near-identical "is this commissario a member/president of the fase's commission, under FOR UPDATE" helpers. Logic drift risk (e.g., one uses president-only, others member). Consolidating into one parameterized helper (`membership: 'member' | 'president'`) would reduce the authorization surface.
**Fix:** Extract a shared `assertCommissionAccess(tx, actor, faseId, mode)` in a lib.

### IN-04: Duplicated FK-remap copy logic and `slugifyKey` re-implementation

**File:** `server/src/routes/criteri.ts:17-25`
**Issue:** `slugifyKey` is re-implemented in the server to mirror the frontend `scoring.js`. This is intentional (comment explains) but is a duplicate of logic that lives in `@gestimus/scoring`. If the shared package exposes the slug derivation, import it instead to prevent divergence with the scoring engine that consumes the keys.
**Fix:** Import the slug function from `@gestimus/scoring` if available.

### IN-05: `commissari` DELETE does not null out `presidenteCommissarioId` references

**File:** `server/src/routes/commissari.ts:118-130`
**Issue:** Deleting a commissario relies on FK cascade/constraint to clean `commissioni.presidenteCommissarioId`. The membership-removal endpoint (commissioni.ts:256-261, N188) explicitly nulls the president; the direct commissario DELETE does not, so behavior depends on the FK ON DELETE rule. If the FK is `ON DELETE SET NULL` this is fine; if `RESTRICT`/`NO ACTION` the delete throws a raw 500 instead of a clean message.
**Fix:** Verify the FK rule; if not SET NULL, pre-null the president reference and/or map the FK error to a 409.

### IN-06: `iscrizioni` resend-verify sends email outside the transaction after commit

**File:** `server/src/routes/iscrizioni.ts:520-536`
**Issue:** The token is updated in-tx, then the email is sent best-effort outside the tx. If the send fails the token is already rotated, so the previously-sent link (if any) is now invalid and the user must resend again. Minor UX wrinkle, not a defect; the public create path correctly uses the outbox (publishEvent in-tx). Consider routing resend through the same outbox for consistency.
**Fix:** Use `publishEvent(tx, ...)` for resend to match the create path's transactional delivery.

### IN-07: `valutazioni` GET allows admin/superadmin to read across all commissari (by design) — verify intent

**File:** `server/src/routes/valutazioni.ts:46-67`
**Issue:** A commissario is correctly clamped to their own `commissarioId`. Admin/superadmin can read every commissario's votes (within tenant via RLS). This is presumably intentional (admin oversight), but the comment only documents the commissario clamp. Confirm that exposing per-commissario raw votes to admin during an IN_CORSO (not yet concluded/frozen) fase is acceptable for the anonymity/impartiality requirements of the competition.
**Fix:** Document the admin-read intent explicitly; if blind judging is required, gate raw per-commissario reads until fase conclusion.

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
