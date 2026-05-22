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
export async function runTenantCleanup(): Promise<CleanupResult> {
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

  const result: CleanupResult = {
    candidatesFound: candidates.length,
    deleted: 0,
    backedUp: 0,
    prunedOldBackups: 0,
    errors: [],
  };

  for (const t of candidates) {
    try {
      const backup = await backupTenant(t.id);
      result.backedUp += 1;
      // Audit prima della DELETE: l'INSERT su platform_audit_log non è soggetto a
      // cascade (no FK su tenants) quindi sopravvive comunque, ma scriverlo prima
      // garantisce che resti traccia anche se la DELETE fallisce.
      await dbSuper.insert(platformAuditLog).values({
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
      await dbSuper.delete(tenants).where(eq(tenants.id, t.id));
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
}
