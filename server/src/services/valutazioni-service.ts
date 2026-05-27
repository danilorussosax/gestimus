import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { candidatiFase, commissioniCommissari, fasi, valutazioni } from '../db/schema.js';
import type { TxClient } from '../middleware/tenant.js';
import { ok, err, type Result } from '../lib/result.js';
import { forbidden, notFoundError, type DomainError } from '../lib/domain-error.js';

// #1 (architect) — Service layer per le valutazioni: authorization + business
// logic + accesso DB estratti dalla route (ora thin adapter). Niente Fastify
// reply qui: gli errori sono DomainError dentro un Result, testabili senza HTTP.

/** Contesto dell'attore (dall'account autenticato). */
export interface EvalActor {
  role?: string;
  commissarioId?: string | null;
}

export interface CreateValutazioneCmd {
  tenantId: string;
  candidatoFaseId: string;
  commissarioId: string;
  criterio: string;
  voto: number;
  note?: string;
}

export interface UpsertedValutazione {
  /** Riga valutazione (senza il campo tecnico `inserted`). */
  row: Record<string, unknown> & { id: string; voto: unknown };
  inserted: boolean;
}

// C6: un commissario può valutare SOLO se membro della commissione assegnata
// alla fase del candidatoFase. Admin/superadmin bypassano. Stessa transazione
// del caller (no TOCTOU). #8: lock fase → candidatoFase (stesso ordine di
// /fasi/:id/conclude) per non incrociare i lock.
export async function canEvaluateCandidatoFase(
  tx: TxClient,
  actor: EvalActor,
  candidatoFaseId: string,
  commissarioIdParam: string,
): Promise<Result<true, DomainError>> {
  const role = actor.role;
  if (role === 'admin' || role === 'superadmin') return ok(true);
  if (role !== 'commissario') {
    return err(forbidden('ruolo richiesto: admin o commissario membro della commissione'));
  }
  const accountCommissarioId = actor.commissarioId;
  if (!accountCommissarioId) return err(forbidden('commissario senza profilo'));
  if (accountCommissarioId !== commissarioIdParam) {
    return err(forbidden('un commissario può inserire voti solo a proprio nome'));
  }
  // #8: faseId immutabile → letto senza lock, poi lock fase, poi candidatoFase.
  const cfFase = await tx
    .select({ faseId: candidatiFase.faseId })
    .from(candidatiFase)
    .where(eq(candidatiFase.id, candidatoFaseId))
    .limit(1);
  if (cfFase.length === 0) return err(notFoundError());
  const faseRows = await tx
    .select({ commissioneId: fasi.commissioneId })
    .from(fasi)
    .where(eq(fasi.id, cfFase[0]!.faseId))
    .limit(1)
    .for('update');
  const cfRows = await tx
    .select({ faseId: candidatiFase.faseId })
    .from(candidatiFase)
    .where(eq(candidatiFase.id, candidatoFaseId))
    .limit(1)
    .for('update');
  if (cfRows.length === 0) return err(notFoundError());
  const commissioneId = faseRows[0]?.commissioneId;
  if (!commissioneId) return err(forbidden('fase senza commissione assegnata'));
  const memberRows = await tx
    .select({ id: commissioniCommissari.commissarioId })
    .from(commissioniCommissari)
    .where(
      and(
        eq(commissioniCommissari.commissioneId, commissioneId),
        eq(commissioniCommissari.commissarioId, accountCommissarioId),
      ),
    )
    .limit(1)
    .for('update');
  if (memberRows.length === 0) {
    return err(forbidden('solo i membri della commissione assegnata possono valutare'));
  }
  return ok(true);
}

/**
 * Upsert di una valutazione (ON CONFLICT su candidatoFase+commissario+criterio).
 * `inserted` distingue insert/update via xmax. NON cattura gli errori dei trigger
 * DB (freeze fase CONCLUSA → 23514): li lascia propagare al chiamante (la route
 * li mappa con handlePgError, comportamento invariato).
 */
export async function createValutazione(
  tx: TxClient,
  actor: EvalActor,
  cmd: CreateValutazioneCmd,
): Promise<Result<UpsertedValutazione, DomainError>> {
  const authz = await canEvaluateCandidatoFase(tx, actor, cmd.candidatoFaseId, cmd.commissarioId);
  if (!authz.ok) return authz;
  const now = new Date();
  const [row] = await tx
    .insert(valutazioni)
    .values({
      tenantId: cmd.tenantId,
      candidatoFaseId: cmd.candidatoFaseId,
      commissarioId: cmd.commissarioId,
      criterio: cmd.criterio,
      voto: cmd.voto,
      note: cmd.note,
    })
    .onConflictDoUpdate({
      target: [valutazioni.candidatoFaseId, valutazioni.commissarioId, valutazioni.criterio],
      set: { voto: cmd.voto, note: cmd.note, timestamp: now, updatedAt: now },
    })
    .returning({ ...getTableColumns(valutazioni), inserted: sql<boolean>`(xmax = 0)` });
  const { inserted, ...rowOut } = row!;
  return ok({ row: rowOut as UpsertedValutazione['row'], inserted: inserted === true });
}

export interface UpdateValutazioneCmd {
  voto?: number;
  note?: string;
}

/** PATCH di una valutazione: lock riga, ricontrollo authz, update. */
export async function updateValutazione(
  tx: TxClient,
  actor: EvalActor,
  id: string,
  patch: UpdateValutazioneCmd,
): Promise<Result<Record<string, unknown>, DomainError>> {
  const existing = await tx
    .select({ cfId: valutazioni.candidatoFaseId, commId: valutazioni.commissarioId })
    .from(valutazioni)
    .where(eq(valutazioni.id, id))
    .for('update')
    .limit(1);
  if (existing.length === 0) return err(notFoundError());
  const authz = await canEvaluateCandidatoFase(tx, actor, existing[0]!.cfId, existing[0]!.commId);
  if (!authz.ok) return authz;
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (patch.voto !== undefined) set.timestamp = new Date();
  const [updated] = await tx.update(valutazioni).set(set).where(eq(valutazioni.id, id)).returning();
  if (!updated) return err(notFoundError());
  return ok(updated);
}
