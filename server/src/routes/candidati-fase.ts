import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { candidatiFase } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const assignBody = z.object({
  faseId: uuid,
  candidatoId: uuid,
  posizione: z.number().int().positive().optional(),
});
const updateBody = z.object({
  posizione: z.number().int().positive().optional(),
  stato: z.enum(['IN_ATTESA', 'IN_ESECUZIONE', 'COMPLETATO', 'ELIMINATO']).optional(),
  ammessoProssimaFase: z.boolean().optional(),
});

export const candidatiFaseRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /candidati-fase?faseId=... → tutti i candidati di una fase
  app.get('/', async (req) => {
    const q = z.object({ faseId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.faseId
        ? tx.select().from(candidatiFase).where(eq(candidatiFase.faseId, q.faseId))
        : tx.select().from(candidatiFase);
    });
  });

  // POST /candidati-fase → assegna candidato a fase
  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = assignBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      try {
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
        const e = err as { code?: string };
        if (e.code === '23505') return reply.conflict('candidato già assegnato a questa fase');
        throw err;
      }
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
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
