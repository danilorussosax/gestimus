import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  commissioni,
  commissioniCategorie,
  commissioniCommissari,
  commissioniSezioni,
} from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const createBody = z.object({
  concorsoId: uuid,
  nome: z.string().min(1).max(255),
  presidenteCommissarioId: uuid.optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const commissioniRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.concorsoId
        ? tx.select().from(commissioni).where(eq(commissioni.concorsoId, q.concorsoId))
        : tx.select().from(commissioni);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(commissioni).where(eq(commissioni.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      const commissione = rows[0]!;
      const [comms, sezs, cats] = await Promise.all([
        tx
          .select({ id: commissioniCommissari.commissarioId })
          .from(commissioniCommissari)
          .where(eq(commissioniCommissari.commissioneId, id)),
        tx
          .select({ id: commissioniSezioni.sezioneId })
          .from(commissioniSezioni)
          .where(eq(commissioniSezioni.commissioneId, id)),
        tx
          .select({ id: commissioniCategorie.categoriaId })
          .from(commissioniCategorie)
          .where(eq(commissioniCategorie.commissioneId, id)),
      ]);
      return {
        ...commissione,
        commissari: comms.map((c) => c.id),
        sezioni: sezs.map((s) => s.id),
        categorie: cats.map((c) => c.id),
      };
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [created] = await tx
        .insert(commissioni)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'commissione.create', {
        targetType: 'commissione',
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
        .update(commissioni)
        .set(parsed.data)
        .where(eq(commissioni.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'commissione.update', {
        targetType: 'commissione',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(commissioni).where(eq(commissioni.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'commissione.delete', {
        targetType: 'commissione',
        targetId: id,
        payload: { nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });

  // ------- Membri della commissione --------

  app.post(
    '/:id/commissari/:commissarioId',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id, commissarioId } = z
        .object({ id: uuid, commissarioId: uuid })
        .parse(req.params);
      return req.dbTx(async (tx) => {
        await tx
          .insert(commissioniCommissari)
          .values({ tenantId: req.tenant!.id, commissioneId: id, commissarioId })
          .onConflictDoNothing();
        await writeAudit(tx, req, 'commissione.add_commissario', {
          targetType: 'commissione',
          targetId: id,
          payload: { commissarioId },
        });
        return reply.code(204).send();
      });
    },
  );

  app.delete(
    '/:id/commissari/:commissarioId',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id, commissarioId } = z
        .object({ id: uuid, commissarioId: uuid })
        .parse(req.params);
      return req.dbTx(async (tx) => {
        await tx
          .delete(commissioniCommissari)
          .where(
            and(
              eq(commissioniCommissari.commissioneId, id),
              eq(commissioniCommissari.commissarioId, commissarioId),
            ),
          );
        await writeAudit(tx, req, 'commissione.remove_commissario', {
          targetType: 'commissione',
          targetId: id,
          payload: { commissarioId },
        });
        return reply.code(204).send();
      });
    },
  );

  // ------- Sezioni assegnate --------

  app.post(
    '/:id/sezioni/:sezioneId',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id, sezioneId } = z.object({ id: uuid, sezioneId: uuid }).parse(req.params);
      return req.dbTx(async (tx) => {
        await tx
          .insert(commissioniSezioni)
          .values({ tenantId: req.tenant!.id, commissioneId: id, sezioneId })
          .onConflictDoNothing();
        return reply.code(204).send();
      });
    },
  );

  app.delete(
    '/:id/sezioni/:sezioneId',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id, sezioneId } = z.object({ id: uuid, sezioneId: uuid }).parse(req.params);
      return req.dbTx(async (tx) => {
        await tx
          .delete(commissioniSezioni)
          .where(
            and(
              eq(commissioniSezioni.commissioneId, id),
              eq(commissioniSezioni.sezioneId, sezioneId),
            ),
          );
        return reply.code(204).send();
      });
    },
  );

  // ------- Categorie assegnate --------

  app.post(
    '/:id/categorie/:categoriaId',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id, categoriaId } = z.object({ id: uuid, categoriaId: uuid }).parse(req.params);
      return req.dbTx(async (tx) => {
        await tx
          .insert(commissioniCategorie)
          .values({ tenantId: req.tenant!.id, commissioneId: id, categoriaId })
          .onConflictDoNothing();
        return reply.code(204).send();
      });
    },
  );

  app.delete(
    '/:id/categorie/:categoriaId',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id, categoriaId } = z.object({ id: uuid, categoriaId: uuid }).parse(req.params);
      return req.dbTx(async (tx) => {
        await tx
          .delete(commissioniCategorie)
          .where(
            and(
              eq(commissioniCategorie.commissioneId, id),
              eq(commissioniCategorie.categoriaId, categoriaId),
            ),
          );
        return reply.code(204).send();
      });
    },
  );
};
