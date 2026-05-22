import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { candidati } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const createBody = z.object({
  concorsoId: uuid,
  numeroCandidato: z.number().int().positive(),
  nome: z.string().min(1).max(255),
  cognome: z.string().max(255).optional(),
  strumento: z.string().min(1).max(255),
  dataNascita: z.string().date().optional(),
  nazionalita: z.string().max(100).optional(),
  docentiPreparatori: z.array(z.string()).optional(),
  dataIscrizione: z.string().date().optional(),
  sezioneId: uuid.optional(),
  categoriaId: uuid.optional(),
  isGruppo: z.boolean().optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const candidatiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.concorsoId
        ? tx.select().from(candidati).where(eq(candidati.concorsoId, q.concorsoId))
        : tx.select().from(candidati);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(candidati).where(eq(candidati.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      try {
        const [created] = await tx
          .insert(candidati)
          .values({ tenantId: req.tenant!.id, ...parsed.data })
          .returning();
        await writeAudit(tx, req, 'candidato.create', {
          targetType: 'candidato',
          targetId: created!.id,
          payload: { numero: created!.numeroCandidato, nome: created!.nome },
        });
        return reply.code(201).send(created);
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === '23505') return reply.conflict('numero_candidato già usato nel concorso');
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
        .update(candidati)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(candidati.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'candidato.update', {
        targetType: 'candidato',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(candidati).where(eq(candidati.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'candidato.delete', {
        targetType: 'candidato',
        targetId: id,
        payload: { numero: deleted.numeroCandidato, nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });
};
