import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, concorsi, fasiSezioni, sezioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();
const createBody = z.object({
  concorsoId: uuid,
  nome: z.string().min(1).max(255),
  descrizione: z.string().optional(),
  ordine: z.number().int().optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const sezioniRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(sezioni).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(sezioni.concorsoId, q.concorsoId)) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(sezioni).where(eq(sezioni.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      // N140: il concorsoId deve appartenere al tenant (la FK non è soggetta a
      // RLS). Sotto RLS questa SELECT ritorna 0 righe se cross-tenant.
      const concOk = await tx
        .select({ id: concorsi.id })
        .from(concorsi)
        .where(eq(concorsi.id, parsed.data.concorsoId))
        .limit(1);
      if (concOk.length === 0) return reply.badRequest('concorso non trovato');
      const [created] = await tx
        .insert(sezioni)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'sezione.create', {
        targetType: 'sezione',
        targetId: created!.id,
        payload: { nome: created!.nome },
      });
      return reply.code(201).send(created);
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(sezioni)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(sezioni.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'sezione.update', {
        targetType: 'sezione',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      // Pre-check: candidati e fasi che referenziano questa sezione.
      // Le `categorie` figlie e le righe `fasi_sezioni` cascade automaticamente
      // (vedi schema), ma i candidati hanno solo sezione_id NULLABLE senza FK
      // e diventerebbero orfani con dati incoerenti. Rifiutiamo.
      const candCount = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(candidati)
        .where(eq(candidati.sezioneId, id));
      const fasiCount = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(fasiSezioni)
        .where(eq(fasiSezioni.sezioneId, id));
      const nCand = candCount[0]?.n ?? 0;
      const nFasi = fasiCount[0]?.n ?? 0;
      if (nCand > 0 || nFasi > 0) {
        return reply.code(409).send({
          error: `Sezione in uso: ${nCand} candidati e ${nFasi} fasi la referenziano. Rimuovi prima i riferimenti.`,
          candidati: nCand,
          fasi: nFasi,
        });
      }
      const [deleted] = await tx.delete(sezioni).where(eq(sezioni.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'sezione.delete', {
        targetType: 'sezione',
        targetId: id,
        payload: { nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });
};
