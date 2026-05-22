import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { categorie } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const createBody = z.object({
  sezioneId: uuid,
  nome: z.string().min(1).max(255),
  descrizione: z.string().optional(),
  etaMin: z.number().int().min(0).max(120).optional(),
  etaMax: z.number().int().min(0).max(120).optional(),
  ordine: z.number().int().optional(),
});
const updateBody = createBody.partial().omit({ sezioneId: true });

export const categorieRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ sezioneId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.sezioneId
        ? tx.select().from(categorie).where(eq(categorie.sezioneId, q.sezioneId))
        : tx.select().from(categorie);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(categorie).where(eq(categorie.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [created] = await tx
        .insert(categorie)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'categoria.create', {
        targetType: 'categoria',
        targetId: created!.id,
        payload: { nome: created!.nome },
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
        .update(categorie)
        .set(parsed.data)
        .where(eq(categorie.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'categoria.update', {
        targetType: 'categoria',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(categorie).where(eq(categorie.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'categoria.delete', {
        targetType: 'categoria',
        targetId: id,
        payload: { nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });
};
