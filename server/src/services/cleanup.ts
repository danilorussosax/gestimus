import { and, eq, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { dbSuper, superPool } from '../db/client.js';
import { iscrizioni, platformAuditLog, tenants } from '../db/schema.js';
import { backupTenant, pruneOldBackups } from './backup.js';
import { computePlatformAuditSig } from './audit.js';
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

// R15: TTL delle iscrizioni in stato BOZZA. L'indice unique parziale considera
// "attiva" ogni iscrizione non RIFIUTATA → una BOZZA abbandonata bloccherebbe
// per sempre la re-iscrizione con la stessa email/concorso. Le BOZZA non
// completate entro 24h vengono eliminate, liberando la re-iscrizione (la
// finestra di 24h consente di recuperare/completare la bozza nel frattempo).
const BOZZA_TTL_MS = 24 * 60 * 60 * 1000;

/** Elimina le iscrizioni in BOZZA più vecchie di 24h. Ritorna il numero rimosso. */
export async function cleanupStaleBozze(): Promise<number> {
  const cutoff = new Date(Date.now() - BOZZA_TTL_MS);
  const res = await dbSuper
    .delete(iscrizioni)
    .where(and(eq(iscrizioni.stato, 'BOZZA'), lt(iscrizioni.createdAt, cutoff)));
  return res.rowCount ?? 0;
}

export async function runTenantCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    candidatesFound: 0,
    deleted: 0,
    backedUp: 0,
    prunedOldBackups: 0,
    errors: [],
  };

  // M15 + N182: lock advisory di SESSIONE su una connessione DEDICATA. Acquire e
  // unlock DEVONO avvenire sulla stessa connessione: con dbSuper (pool) l'unlock
  // poteva finire su una connessione diversa → lock di sessione mai rilasciato.
  const lockClient = await superPool.connect();
  let acquired = false;
  try {
    const lockRes = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [CLEANUP_ADVISORY_LOCK_KEY],
    );
    acquired = lockRes.rows[0]?.acquired === true;
    if (!acquired) return result; // un'altra istanza sta già eseguendo il cleanup

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
          // M196: insert diretto (no req) → firmiamo esplicitamente la riga.
          const auditRow = {
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
            ip: null,
            userAgent: null,
          };
          await tx.insert(platformAuditLog).values({ ...auditRow, sig: computePlatformAuditSig(auditRow) });
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
    // M15 + N182: unlock sulla STESSA connessione del lock, poi rilascia il client.
    if (acquired) {
      await lockClient
        .query('SELECT pg_advisory_unlock($1)', [CLEANUP_ADVISORY_LOCK_KEY])
        .catch(() => {});
    }
    lockClient.release();
  }
}
