import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { criteri } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const createBody = z.object({
  faseId: uuid,
  nome: z.string().min(1).max(255),
  descrizione: z.string().optional(),
  peso: z.number().int().min(0).max(100).optional(),
  ordine: z.number().int().optional(),
});
const updateBody = createBody.partial().omit({ faseId: true });

export const criteriRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ faseId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.faseId
        ? tx.select().from(criteri).where(eq(criteri.faseId, q.faseId))
        : tx.select().from(criteri);
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [created] = await tx
        .insert(criteri)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'criterio.create', {
        targetType: 'criterio',
        targetId: created!.id,
        payload: { nome: created!.nome, peso: created!.peso },
      });
      return reply.code(201).send(created);
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(criteri)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(criteri.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'criterio.update', {
        targetType: 'criterio',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(criteri).where(eq(criteri.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'criterio.delete', {
        targetType: 'criterio',
        targetId: id,
        payload: { nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });
};
