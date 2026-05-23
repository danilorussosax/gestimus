import { count, eq } from 'drizzle-orm';
import { candidati, commissari, concorsi, tenantConfig } from '../db/schema.js';

/**
 * N57: enforcement dei limiti di piano (tenant_config). I limiti NULL = illimitato.
 * Tutte le query girano sotto RLS nella transazione del caller → contano solo
 * le righe del tenant corrente.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function limits(tx: any, tenantId: string): Promise<{
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkConcorsiLimit(tx: any, tenantId: string): Promise<string | null> {
  const { maxConcorsi } = await limits(tx, tenantId);
  if (maxConcorsi == null) return null;
  const [{ n }] = await tx.select({ n: count() }).from(concorsi);
  return Number(n) >= maxConcorsi
    ? `limite del piano raggiunto: massimo ${maxConcorsi} concorsi`
    : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkCommissariLimit(tx: any, tenantId: string): Promise<string | null> {
  const { maxCommissari } = await limits(tx, tenantId);
  if (maxCommissari == null) return null;
  const [{ n }] = await tx.select({ n: count() }).from(commissari);
  return Number(n) >= maxCommissari
    ? `limite del piano raggiunto: massimo ${maxCommissari} commissari`
    : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkCandidatiLimit(tx: any, tenantId: string, concorsoId: string): Promise<string | null> {
  const { maxCandidatiPerConcorso } = await limits(tx, tenantId);
  if (maxCandidatiPerConcorso == null) return null;
  const [{ n }] = await tx
    .select({ n: count() })
    .from(candidati)
    .where(eq(candidati.concorsoId, concorsoId));
  return Number(n) >= maxCandidatiPerConcorso
    ? `limite del piano raggiunto: massimo ${maxCandidatiPerConcorso} candidati per concorso`
    : null;
}
