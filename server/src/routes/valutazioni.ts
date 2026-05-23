import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  candidatiFase,
  commissioni,
  commissioniCommissari,
  fasi,
  valutazioni,
} from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';

const uuid = z.string().uuid();
// N15: bound applicativo su `voto`. Il trigger DB clamp_voto normalizza
// comunque in [0, fase.scala], ma rifiutare a monte 999/-1 evita scoring
// fuorviante prima del clamp e fornisce un errore chiaro. Upper bound generoso
// (1000 = scala massima ammessa per le fasi); il clamp per-fase fa il resto.
const VOTO_MAX = 1000;
const upsertBody = z.object({
  candidatoFaseId: uuid,
  commissarioId: uuid,
  criterio: z.string().min(1).max(255),
  voto: z.number().min(0).max(VOTO_MAX),
  note: z.string().optional(),
});
const updateBody = z.object({
  voto: z.number().min(0).max(VOTO_MAX).optional(),
  note: z.string().optional(),
});

/**
 * Mappa errori Postgres dei trigger → risposta HTTP appropriata.
 * Il trigger `freeze_valutazione_fase_conclusa` solleva con SQLSTATE 23514.
 */
function handlePgError(err: unknown): { code: number; body: { error: string } } | null {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const pgCode = e.code ?? e.cause?.code;
  // Drizzle ≥ 0.42 wrappa l'errore: e.message è "Failed query: ...", il msg
  // Postgres reale è in e.cause.message. Concateniamo entrambi.
  const allMsgs = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
  if (pgCode === '23514' && allMsgs.includes('CONCLUSA')) {
    return { code: 409, body: { error: 'fase CONCLUSA: valutazioni in sola lettura' } };
  }
  return null;
}

// C6: un commissario può inserire/modificare valutazioni SOLO se è membro della
// commissione assegnata alla fase del candidatoFase. Admin/superadmin bypassano.
// Esegue il check nella stessa transazione del caller (no TOCTOU).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanEvaluateCandidatoFase(
  tx: any,
  req: FastifyRequest,
  reply: FastifyReply,
  candidatoFaseId: string,
  commissarioIdParam: string,
): Promise<boolean> {
  const role = req.account?.role;
  if (role === 'admin' || role === 'superadmin') return true;
  if (role !== 'commissario') {
    reply.code(403).send({ error: 'ruolo richiesto: admin o commissario membro della commissione' });
    return false;
  }
  const accountCommissarioId = req.account?.commissarioId;
  if (!accountCommissarioId) {
    reply.code(403).send({ error: 'commissario senza profilo' });
    return false;
  }
  if (accountCommissarioId !== commissarioIdParam) {
    reply.code(403).send({ error: 'un commissario può inserire voti solo a proprio nome' });
    return false;
  }
  // N108: FOR UPDATE su candidatiFase e fasi → un admin concorrente non può
  // cambiare fasi.commissioneId (o spostare il candidatoFase) tra questo check e
  // l'upsert valutazione, evitando valutazioni autorizzate su dati ormai stale.
  const cfRows = await tx
    .select({ faseId: candidatiFase.faseId })
    .from(candidatiFase)
    .where(eq(candidatiFase.id, candidatoFaseId))
    .limit(1)
    .for('update');
  if (cfRows.length === 0) { reply.notFound(); return false; }
  const faseRows = await tx
    .select({ commissioneId: fasi.commissioneId })
    .from(fasi)
    .where(eq(fasi.id, cfRows[0]!.faseId))
    .limit(1)
    .for('update');
  const commissioneId = faseRows[0]?.commissioneId;
  if (!commissioneId) {
    reply.code(403).send({ error: 'fase senza commissione assegnata' });
    return false;
  }
  // N88: FOR UPDATE sulla riga di membership. Questo assert gira nella stessa
  // transazione dell'upsert valutazione (vedi POST /); bloccando la riga, un
  // admin concorrente non può rimuovere il commissario dalla commissione tra il
  // check e l'INSERT/UPDATE → niente valutazioni "non più autorizzate".
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
    reply.code(403).send({ error: 'solo i membri della commissione assegnata possono valutare' });
    return false;
  }
  void commissioni;
  return true;
}

export const valutazioniRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /valutazioni?candidatoFaseId=...&commissarioId=...
  app.get('/', async (req) => {
    const q = z
      .object({ candidatoFaseId: uuid.optional(), commissarioId: uuid.optional() })
      .parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      let where;
      if (q.candidatoFaseId && q.commissarioId) {
        where = and(
          eq(valutazioni.candidatoFaseId, q.candidatoFaseId),
          eq(valutazioni.commissarioId, q.commissarioId),
        );
      } else if (q.candidatoFaseId) {
        where = eq(valutazioni.candidatoFaseId, q.candidatoFaseId);
      } else if (q.commissarioId) {
        where = eq(valutazioni.commissarioId, q.commissarioId);
      }
      const base = tx.select().from(valutazioni).$dynamic();
      const filtered = where ? base.where(where) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  // POST upsert: clamp voto e freeze fase CONCLUSA sono gestiti dai trigger DB.
  // Concurrency: ON CONFLICT DO UPDATE sull'unique index `uniq_valutazioni`
  // (candidato_fase, commissario, criterio) → niente TOCTOU su upsert concorrenti.
  app.post(
    '/',
    { preHandler: [requireRole('admin', 'commissario')] },
    async (req, reply) => {
      const parsed = upsertBody.safeParse(req.body);
      if (!parsed.success) return reply.badRequest(parsed.error.message);
      try {
        return await req.dbTx(async (tx) => {
          if (!await assertCanEvaluateCandidatoFase(
            tx, req, reply, parsed.data.candidatoFaseId, parsed.data.commissarioId,
          )) return;
          const now = new Date();
          const [row] = await tx
            .insert(valutazioni)
            .values({
              tenantId: req.tenant!.id,
              candidatoFaseId: parsed.data.candidatoFaseId,
              commissarioId: parsed.data.commissarioId,
              criterio: parsed.data.criterio,
              voto: parsed.data.voto,
              note: parsed.data.note,
            })
            .onConflictDoUpdate({
              target: [valutazioni.candidatoFaseId, valutazioni.commissarioId, valutazioni.criterio],
              set: {
                voto: parsed.data.voto,
                note: parsed.data.note,
                timestamp: now,
                updatedAt: now,
              },
            })
            // N31: distinzione insert/update affidabile via xmax. Per una riga
            // appena inserita xmax=0; per una aggiornata xmax≠0. Prima si
            // confrontava createdAt==updatedAt (millisecondo), fragile.
            // N116 (falso positivo): verificato empiricamente su Postgres —
            // ON CONFLICT insert → xmax=0 (true), conflict→update → xmax≠0
            // (false). L'audit log distingue quindi correttamente create/update.
            .returning({ ...getTableColumns(valutazioni), inserted: sql<boolean>`(xmax = 0)` });
          const wasInsert = row!.inserted === true;
          await writeAudit(tx, req, wasInsert ? 'valutazione.create' : 'valutazione.update', {
            targetType: 'valutazione',
            targetId: row!.id,
            payload: { voto: row!.voto, criterio: parsed.data.criterio },
          });
          // Rimuovi il campo tecnico `inserted` dalla risposta al client.
          const { inserted: _omit, ...rowOut } = row!;
          if (wasInsert) return reply.code(201).send(rowOut);
          return rowOut;
        });
      } catch (err) {
        const mapped = handlePgError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.patch(
    '/:id',
    { preHandler: [requireRole('admin', 'commissario')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const parsed = updateBody.safeParse(req.body);
      if (!parsed.success) return reply.badRequest(parsed.error.message);
      try {
        return await req.dbTx(async (tx) => {
          const existing = await tx
            .select({ cfId: valutazioni.candidatoFaseId, commId: valutazioni.commissarioId })
            .from(valutazioni)
            .where(eq(valutazioni.id, id))
            .for('update')
            .limit(1);
          if (existing.length === 0) return reply.notFound();
          if (!await assertCanEvaluateCandidatoFase(
            tx, req, reply, existing[0]!.cfId, existing[0]!.commId,
          )) return;
          const patch: Record<string, unknown> = {
            ...parsed.data,
            updatedAt: new Date(),
          };
          if (parsed.data.voto !== undefined) {
            patch.timestamp = new Date();
          }
          const [updated] = await tx
            .update(valutazioni)
            .set(patch)
            .where(eq(valutazioni.id, id))
            .returning();
          if (!updated) return reply.notFound();
          await writeAudit(tx, req, 'valutazione.update', {
            targetType: 'valutazione',
            targetId: id,
            payload: parsed.data,
          });
          return updated;
        });
      } catch (err) {
        const mapped = handlePgError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    try {
      return await req.dbTx(async (tx) => {
        const [deleted] = await tx.delete(valutazioni).where(eq(valutazioni.id, id)).returning();
        if (!deleted) return reply.notFound();
        await writeAudit(tx, req, 'valutazione.delete', {
          targetType: 'valutazione',
          targetId: id,
        });
        return reply.code(204).send();
      });
    } catch (err) {
      const mapped = handlePgError(err);
      if (mapped) return reply.code(mapped.code).send(mapped.body);
      throw err;
    }
  });
};
