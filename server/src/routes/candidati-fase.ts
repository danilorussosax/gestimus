import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { uuid, emptyToNull } from '../lib/zod-helpers.js';
import { candidati, candidatiFase, commissioniCommissari, fasi } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { TxClient } from '../middleware/tenant.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { replyValidationError } from '../lib/validation.js';

// Permesso a marcare ammessoProssimaFase / cambiare lo stato di un candidato_fase:
//   - admin/superadmin sempre
//   - commissario che è membro della commissione assegnata alla fase del cf
//     (caso tipico: ogni commissario salva il proprio "voto di ammissione"
//     insieme alla valutazione → il flag riflette la decisione collegiale)
// Se la fase non ha commissione assegnata, solo admin può modificarlo.
// Esegue tutte le SELECT nella stessa transazione del caller con SELECT … FOR
// UPDATE sulla riga candidatiFase per evitare TOCTOU (cambio assegnazione
// commissione tra check e write).
async function assertCanEditCandidatoFase(tx: TxClient, req: FastifyRequest, reply: FastifyReply, cfId: string): Promise<boolean> {
  const role = req.account?.role;
  if (role === 'admin' || role === 'superadmin') return true;
  if (role !== 'commissario') {
    reply.code(403).send({ error: 'ruolo richiesto: admin o commissario membro della commissione' });
    return false;
  }
  const commissarioId = req.account?.commissarioId;
  if (!commissarioId) {
    reply.code(403).send({ error: 'commissario senza profilo' });
    return false;
  }
  const rows = await tx
    .select({ faseId: candidatiFase.faseId })
    .from(candidatiFase)
    .where(eq(candidatiFase.id, cfId))
    .for('update')
    .limit(1);
  if (rows.length === 0) { reply.notFound(); return false; }
  const faseId = rows[0]!.faseId;
  // N189: FOR UPDATE anche su fasi → un admin non può cambiare
  // fasi.commissioneId tra questo check e l'UPDATE del candidatoFase (TOCTOU).
  const faseRows = await tx
    .select({ commissioneId: fasi.commissioneId })
    .from(fasi)
    .where(eq(fasi.id, faseId))
    .limit(1)
    .for('update');
  const commissioneId = faseRows[0]?.commissioneId;
  if (!commissioneId) {
    reply.code(403).send({ error: 'fase senza commissione assegnata: modifica admin-only' });
    return false;
  }
  const memberRows = await tx
    .select({ id: commissioniCommissari.commissarioId })
    .from(commissioniCommissari)
    .where(
      and(
        eq(commissioniCommissari.commissioneId, commissioneId),
        eq(commissioniCommissari.commissarioId, commissarioId),
      ),
    )
    // R15: FOR UPDATE come in valutazioni.ts (N88) — un admin che rimuove il
    // commissario dalla commissione concorrentemente non può far passare l'edit
    // dopo che la membership è stata revocata (TOCTOU).
    .for('update')
    .limit(1);
  if (memberRows.length === 0) {
    reply.code(403).send({ error: 'solo i membri della commissione assegnata possono modificare questo candidato' });
    return false;
  }
  return true;
}

const assignBody = z.object({
  faseId: uuid,
  candidatoId: uuid,
  posizione: z.number().int().positive().optional(),
});
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);
const updateBody = z.object({
  posizione: z.number().int().positive().optional(),
  stato: z.enum(['IN_ATTESA', 'IN_ESECUZIONE', 'COMPLETATO', 'ELIMINATO']).optional(),
  ammessoProssimaFase: z.boolean().optional(),
  // Scheduling: assegnazione manuale del blocco e override dell'orario individuale.
  eventoId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  oraPrevista: z.preprocess(emptyToNull, timeStr.nullable()).optional(),
});

export const candidatiFaseRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /candidati-fase?faseId=... → tutti i candidati di una fase
  app.get('/', async (req) => {
    const q = z.object({ faseId: uuid.optional() }).parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(candidatiFase).$dynamic();
      const filtered = q.faseId ? base.where(eq(candidatiFase.faseId, q.faseId)) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  // POST /candidati-fase → assegna candidato a fase
  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = assignBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      try {
        // N140: fase e candidato devono appartenere al tenant (le FK non sono
        // soggette a RLS; il trigger di coerenza N114 è la rete di sicurezza a
        // livello DB, qui diamo un 404 pulito invece di un errore di trigger).
        const faseOk = await tx
          .select({ id: fasi.id })
          .from(fasi)
          .where(eq(fasi.id, parsed.data.faseId))
          .limit(1);
        if (faseOk.length === 0) return reply.badRequest('fase non trovata');
        const candOk = await tx
          .select({ id: candidati.id })
          .from(candidati)
          .where(eq(candidati.id, parsed.data.candidatoId))
          .limit(1);
        if (candOk.length === 0) return reply.badRequest('candidato non trovato');
        const [created] = await tx
          .insert(candidatiFase)
          .values({ tenantId: req.tenant!.id, ...parsed.data })
          .returning();
        await writeAudit(tx, req, 'candidato_fase.assign', {
          targetType: 'candidato_fase',
          targetId: created!.id,
          payload: { faseId: parsed.data.faseId, candidatoId: parsed.data.candidatoId },
        });
        return reply.code(201).send(created);
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if ((e.code ?? e.cause?.code) === '23505') return reply.conflict('candidato già assegnato a questa fase');
        throw err;
      }
    });
  });

  app.patch('/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    // N13 + N144: i campi che decidono l'esito (stato, posizione,
    // ammessoProssimaFase) sono admin-only. L'ammissione non è più una scelta
    // del singolo commissario (era last-write-wins): viene calcolata
    // dall'aggregato e applicata atomicamente al conclude della fase.
    const role = req.account?.role;
    if (role !== 'admin' && role !== 'superadmin') {
      if (
        parsed.data.stato !== undefined ||
        parsed.data.posizione !== undefined ||
        parsed.data.ammessoProssimaFase !== undefined ||
        parsed.data.eventoId !== undefined ||
        parsed.data.oraPrevista !== undefined
      ) {
        return reply.code(403).send({ error: 'solo admin può modificare stato/posizione/ammissione del candidato' });
      }
    }
    return req.dbTx(async (tx) => {
      if (!await assertCanEditCandidatoFase(tx, req, reply, id)) return;
      const [updated] = await tx
        .update(candidatiFase)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(candidatiFase.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'candidato_fase.update', {
        targetType: 'candidato_fase',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(candidatiFase).where(eq(candidatiFase.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'candidato_fase.unassign', {
        targetType: 'candidato_fase',
        targetId: id,
      });
      return reply.code(204).send();
    });
  });
};
