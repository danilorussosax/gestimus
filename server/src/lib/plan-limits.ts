import { count, eq } from 'drizzle-orm';
import { candidati, commissari, concorsi, tenantConfig } from '../db/schema.js';
import type { TxClient } from '../middleware/tenant.js';

/**
 * N57: enforcement dei limiti di piano (tenant_config). I limiti NULL = illimitato.
 * Tutte le query girano sotto RLS nella transazione del caller → contano solo
 * le righe del tenant corrente.
 */

async function limits(tx: TxClient, tenantId: string): Promise<{
  maxConcorsi: number | null;
  maxCommissari: number | null;
  maxCandidatiPerConcorso: number | null;
}> {
  const rows = await tx
    .select({
      maxConcorsi: tenantConfig.maxConcorsi,
      maxCommissari: tenantConfig.maxCommissari,
      maxCandidatiPerConcorso: tenantConfig.maxCandidatiPerConcorso,
    })
    .from(tenantConfig)
    .where(eq(tenantConfig.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? { maxConcorsi: null, maxCommissari: null, maxCandidatiPerConcorso: null };
}

/** Ritorna un messaggio di errore se il limite è raggiunto, altrimenti null. */
export async function checkConcorsiLimit(tx: TxClient, tenantId: string): Promise<string | null> {
  const { maxConcorsi } = await limits(tx, tenantId);
  if (maxConcorsi == null) return null;
  const rows = await tx.select({ n: count() }).from(concorsi);
  const n = rows[0]?.n ?? 0;
  return Number(n) >= maxConcorsi
    ? `limite del piano raggiunto: massimo ${maxConcorsi} concorsi`
    : null;
}

export async function checkCommissariLimit(tx: TxClient, tenantId: string): Promise<string | null> {
  const { maxCommissari } = await limits(tx, tenantId);
  if (maxCommissari == null) return null;
  const rows = await tx.select({ n: count() }).from(commissari);
  const n = rows[0]?.n ?? 0;
  return Number(n) >= maxCommissari
    ? `limite del piano raggiunto: massimo ${maxCommissari} commissari`
    : null;
}

export async function checkCandidatiLimit(tx: TxClient, tenantId: string, concorsoId: string): Promise<string | null> {
  const { maxCandidatiPerConcorso } = await limits(tx, tenantId);
  if (maxCandidatiPerConcorso == null) return null;
  const rows = await tx
    .select({ n: count() })
    .from(candidati)
    .where(eq(candidati.concorsoId, concorsoId));
  const n = rows[0]?.n ?? 0;
  return Number(n) >= maxCandidatiPerConcorso
    ? `limite del piano raggiunto: massimo ${maxCandidatiPerConcorso} candidati per concorso`
    : null;
}
