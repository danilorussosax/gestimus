import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { dbSuper } from '../db/client.js';
import { platformAuditLog, tenants } from '../db/schema.js';
import { backupTenant, pruneOldBackups } from './backup.js';
import { env } from '../env.js';

export type CleanupResult = {
  candidatesFound: number;
  deleted: number;
  backedUp: number;
  prunedOldBackups: number;
  errors: Array<{ tenantId: string; slug: string; error: string }>;
};

/**
 * Job di hard-delete automatico dei tenant archiviati con cleanup_scheduled_at scaduto.
 *
 * Per ciascun candidato:
 *  1. backupTenant() → dump JSON gzip in ARCHIVE_DIR
 *  2. DELETE FROM tenants (cascade su tutte le tabelle di dominio)
 *  3. INSERT in platform_audit_log azione 'platform.tenant.cleanup_auto' con payload
 *     (slug, dump path, sizeBytes, tableCounts) — sopravvive al cascade
 *
 * Dopo aver processato i tenant, esegue pruneOldBackups() per la retention.
 *
 * I tenant con `cleanup_after_days = 0` sono esclusi (significa "non cancellare mai").
 */
// M15: chiave per l'advisory lock globale del job di cleanup. Valore arbitrario
// ma stabile: due istanze che girano il cron in contemporanea non devono
// processare gli stessi tenant (doppio backup + DELETE race).
const CLEANUP_ADVISORY_LOCK_KEY = 994_001;

export async function runTenantCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    candidatesFound: 0,
    deleted: 0,
    backedUp: 0,
    prunedOldBackups: 0,
    errors: [],
  };

  // M15: prova ad acquisire il lock advisory a livello sessione. Se un'altra
  // istanza lo detiene, saltiamo questo run (verrà ritentato al prossimo cron).
  const lockRes = await dbSuper.execute(
    sql`SELECT pg_try_advisory_lock(${CLEANUP_ADVISORY_LOCK_KEY}) AS acquired`,
  );
  const acquired = (lockRes as unknown as { rows?: Array<{ acquired: boolean }> }).rows?.[0]?.acquired
    ?? (lockRes as unknown as Array<{ acquired: boolean }>)[0]?.acquired;
  if (!acquired) {
    return result; // un'altra istanza sta già eseguendo il cleanup
  }

  try {
    const candidates = await dbSuper
      .select()
      .from(tenants)
      .where(
        and(
          eq(tenants.stato, 'archiviato'),
          isNotNull(tenants.archiviatoAt),
          isNotNull(tenants.cleanupScheduledAt),
          // cleanup_after_days > 0 == "non mai"
          sql`${tenants.cleanupAfterDays} > 0`,
          lte(tenants.cleanupScheduledAt, new Date()),
        ),
      );
    result.candidatesFound = candidates.length;

    for (const t of candidates) {
      try {
        const backup = await backupTenant(t.id);
        result.backedUp += 1;
        // M14: audit INSERT + DELETE nella stessa transazione. Se il processo
        // crasha tra i due, la transazione fa rollback e lo stato resta
        // consistente (tenant ancora presente, ritentabile al prossimo run).
        await dbSuper.transaction(async (tx) => {
          await tx.insert(platformAuditLog).values({
            actorAccountId: null,
            action: 'platform.tenant.cleanup_auto',
            targetTenantSlug: t.slug,
            targetTenantId: t.id,
            payload: {
              slug: t.slug,
              nome: t.nome,
              backupPath: backup.path,
              backupSizeBytes: backup.sizeBytes,
              tableCounts: backup.tableCounts,
              archiviatoAt: t.archiviatoAt,
              cleanupScheduledAt: t.cleanupScheduledAt,
            },
          });
          await tx.delete(tenants).where(eq(tenants.id, t.id));
        });
        result.deleted += 1;
      } catch (err) {
        result.errors.push({
          tenantId: t.id,
          slug: t.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Retention: rimuovi i dump più vecchi della finestra configurata
    try {
      const pruned = await pruneOldBackups(env.BACKUP_RETENTION_DAYS);
      result.prunedOldBackups = pruned.deleted;
    } catch (err) {
      result.errors.push({
        tenantId: '',
        slug: 'prune',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  } finally {
    // M15: rilascia sempre il lock advisory di sessione.
    await dbSuper.execute(sql`SELECT pg_advisory_unlock(${CLEANUP_ADVISORY_LOCK_KEY})`);
  }
}
