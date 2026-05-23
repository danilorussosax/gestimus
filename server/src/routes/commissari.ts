import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { commissari } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
// Helper: il form admin manda "" quando l'utente svuota un campo; gli stessi
// validator strict (z.string().email(), z.string().date()) rifiutano "" → 400.
// Trasformiamo "" in null così "campo svuotato" è esplicitamente un clear.
const emptyToNull = <T>(v: T) => (v === '' ? null : v);
const createBody = z.object({
  concorsoId: uuid,
  nome: z.string().min(1).max(255),
  cognome: z.string().max(255).optional(),
  specialita: z.string().max(255).optional(),
  email: z.preprocess(emptyToNull, z.string().email().nullable()).optional(),
  telefono: z.preprocess(emptyToNull, z.string().max(50).nullable()).optional(),
  dataNascita: z.preprocess(emptyToNull, z.string().date().nullable()).optional(),
  nazionalita: z.preprocess(emptyToNull, z.string().max(100).nullable()).optional(),
  bio: z.preprocess(emptyToNull, z.string().nullable()).optional(),
  stato: z.enum(['ATTIVO', 'INATTIVO']).optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const commissariRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /commissari?concorsoId=...
  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      const rows = q.concorsoId
        ? await tx.select().from(commissari).where(eq(commissari.concorsoId, q.concorsoId))
        : await tx.select().from(commissari);
      return rows;
    });
  });

  // GET /commissari/:id
  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(commissari).where(eq(commissari.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  // POST /commissari (admin only)
  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    return req.dbTx(async (tx) => {
      const [created] = await tx
        .insert(commissari)
        .values({
          tenantId: req.tenant!.id,
          ...parsed.data,
        })
        .returning();
      await writeAudit(tx, req, 'commissario.create', {
        targetType: 'commissario',
        targetId: created!.id,
        payload: { nome: created!.nome, cognome: created!.cognome },
      });
      return reply.code(201).send(created);
    });
  });

  // PATCH /commissari/:id (admin only)
  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(commissari)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(commissari.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'commissario.update', {
        targetType: 'commissario',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  // DELETE /commissari/:id (admin only)
  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(commissari).where(eq(commissari.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'commissario.delete', {
        targetType: 'commissario',
        targetId: id,
        payload: { nome: deleted.nome, cognome: deleted.cognome },
      });
      return reply.code(204).send();
    });
  });
};
