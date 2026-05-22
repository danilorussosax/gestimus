import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
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

// Carica le join tables (commissari/sezioni/categorie) in batch per N
// commissioni così l'endpoint list espone gli array senza N+1 query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCommissioniJoins(tx: any, ids: string[]) {
  const cMap = new Map<string, string[]>();
  const sMap = new Map<string, string[]>();
  const catMap = new Map<string, string[]>();
  if (ids.length === 0) return { cMap, sMap, catMap };
  const [comms, sezs, cats] = await Promise.all([
    tx
      .select({ commissioneId: commissioniCommissari.commissioneId, commissarioId: commissioniCommissari.commissarioId })
      .from(commissioniCommissari)
      .where(inArray(commissioniCommissari.commissioneId, ids)),
    tx
      .select({ commissioneId: commissioniSezioni.commissioneId, sezioneId: commissioniSezioni.sezioneId })
      .from(commissioniSezioni)
      .where(inArray(commissioniSezioni.commissioneId, ids)),
    tx
      .select({ commissioneId: commissioniCategorie.commissioneId, categoriaId: commissioniCategorie.categoriaId })
      .from(commissioniCategorie)
      .where(inArray(commissioniCategorie.commissioneId, ids)),
  ]);
  for (const r of comms as Array<{ commissioneId: string; commissarioId: string }>) {
    const arr = cMap.get(r.commissioneId) ?? [];
    arr.push(r.commissarioId);
    cMap.set(r.commissioneId, arr);
  }
  for (const r of sezs as Array<{ commissioneId: string; sezioneId: string }>) {
    const arr = sMap.get(r.commissioneId) ?? [];
    arr.push(r.sezioneId);
    sMap.set(r.commissioneId, arr);
  }
  for (const r of cats as Array<{ commissioneId: string; categoriaId: string }>) {
    const arr = catMap.get(r.commissioneId) ?? [];
    arr.push(r.categoriaId);
    catMap.set(r.commissioneId, arr);
  }
  return { cMap, sMap, catMap };
}

export const commissioniRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      const rows = q.concorsoId
        ? await tx.select().from(commissioni).where(eq(commissioni.concorsoId, q.concorsoId))
        : await tx.select().from(commissioni);
      const { cMap, sMap, catMap } = await loadCommissioniJoins(tx, rows.map((r) => r.id));
      return rows.map((r) => ({
        ...r,
        commissari: cMap.get(r.id) ?? [],
        sezioni: sMap.get(r.id) ?? [],
        categorie: catMap.get(r.id) ?? [],
      }));
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
        await writeAudit(tx, req, 'commissione.add_sezione', {
          targetType: 'commissione',
          targetId: id,
          payload: { sezioneId },
        });
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
        await writeAudit(tx, req, 'commissione.remove_sezione', {
          targetType: 'commissione',
          targetId: id,
          payload: { sezioneId },
        });
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
        await writeAudit(tx, req, 'commissione.add_categoria', {
          targetType: 'commissione',
          targetId: id,
          payload: { categoriaId },
        });
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
        await writeAudit(tx, req, 'commissione.remove_categoria', {
          targetType: 'commissione',
          targetId: id,
          payload: { categoriaId },
        });
        return reply.code(204).send();
      });
    },
  );
};
