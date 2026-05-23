import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, candidatiMembri } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const createBody = z.object({
  candidatoId: uuid,
  nome: z.string().min(1).max(255),
  cognome: z.string().max(255).optional(),
  strumento: z.string().max(255).optional(),
  dataNascita: z.string().date().optional(),
  nazionalita: z.string().max(100).optional(),
});

export const membriGruppoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /membri-gruppo?candidatoId=...
  app.get('/', async (req) => {
    const q = z.object({ candidatoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.candidatoId
        ? tx.select().from(candidatiMembri).where(eq(candidatiMembri.candidatoId, q.candidatoId))
        : tx.select().from(candidatiMembri);
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      // Verifica che il candidato sia di tipo gruppo (isGruppo=true)
      const parent = await tx
        .select({ isGruppo: candidati.isGruppo })
        .from(candidati)
        .where(eq(candidati.id, parsed.data.candidatoId))
        .limit(1);
      if (parent.length === 0) return reply.notFound();
      if (!parent[0]!.isGruppo) {
        return reply.code(409).send({ error: 'il candidato non è di tipo gruppo' });
      }
      const [created] = await tx
        .insert(candidatiMembri)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'gruppo.add_membro', {
        targetType: 'candidato',
        targetId: parsed.data.candidatoId,
        payload: { membroId: created!.id, nome: created!.nome },
      });
      return reply.code(201).send(created);
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = createBody.partial().omit({ candidatoId: true }).safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(candidatiMembri)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(candidatiMembri.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'gruppo.update_membro', {
        targetType: 'gruppo_membro',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx
        .delete(candidatiMembri)
        .where(eq(candidatiMembri.id, id))
        .returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'gruppo.remove_membro', {
        targetType: 'gruppo_membro',
        targetId: id,
      });
      return reply.code(204).send();
    });
  });
};
