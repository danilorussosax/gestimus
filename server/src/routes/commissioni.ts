import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '../lib/zod-helpers.js';
import {
  categorie,
  commissari,
  commissioni,
  commissioniCategorie,
  commissioniCommissari,
  commissioniSezioni,
  concorsi,
  sezioni,
} from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { TxClient } from '../middleware/tenant.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { replyValidationError } from '../lib/validation.js';

const createBody = z.object({
  concorsoId: uuid,
  nome: z.string().min(1).max(255),
  presidenteCommissarioId: uuid.optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

// Carica le join tables (commissari/sezioni/categorie) in batch per N
// commissioni così l'endpoint list espone gli array senza N+1 query.
async function loadCommissioniJoins(tx: TxClient, ids: string[]) {
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
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(commissioni).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(commissioni.concorsoId, q.concorsoId)) : base;
      const rows = await filtered.limit(limit).offset(offset);
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
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      // N106: il concorsoId deve appartenere al tenant corrente (la FK verso
      // concorsi non è soggetta a RLS). Sotto RLS questa SELECT ritorna 0 righe
      // se il concorso è di un altro tenant.
      const concOk = await tx
        .select({ id: concorsi.id })
        .from(concorsi)
        .where(eq(concorsi.id, parsed.data.concorsoId))
        .limit(1);
      if (concOk.length === 0) return reply.badRequest('concorso non trovato');
      // N96: come nel PATCH (N54), se il presidente è indicato già alla
      // creazione deve essere un commissario dello stesso concorso. Alla create
      // il concorso della commissione è parsed.data.concorsoId.
      if (parsed.data.presidenteCommissarioId) {
        const cms = await tx.select({ concorsoId: commissari.concorsoId })
          .from(commissari).where(eq(commissari.id, parsed.data.presidenteCommissarioId)).limit(1);
        if (cms.length === 0) return reply.badRequest('presidente: commissario non trovato');
        if (cms[0]!.concorsoId !== parsed.data.concorsoId) {
          return reply.badRequest('il presidente non appartiene al concorso della commissione');
        }
      }
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
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      // N54: il presidente deve essere un commissario dello stesso concorso
      // della commissione. La FK garantisce solo l'esistenza.
      if (parsed.data.presidenteCommissarioId) {
        const com = await tx.select({ concorsoId: commissioni.concorsoId })
          .from(commissioni).where(eq(commissioni.id, id)).limit(1);
        if (com.length === 0) return reply.notFound();
        const cms = await tx.select({ concorsoId: commissari.concorsoId })
          .from(commissari).where(eq(commissari.id, parsed.data.presidenteCommissarioId)).limit(1);
        if (cms.length === 0) return reply.badRequest('presidente: commissario non trovato');
        if (cms[0]!.concorsoId !== com[0]!.concorsoId) {
          return reply.badRequest('il presidente non appartiene al concorso della commissione');
        }
      }
      const [updated] = await tx
        .update(commissioni)
        .set({ ...parsed.data, updatedAt: new Date() })
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
        // M11: commissario e commissione devono appartenere allo stesso concorso.
        const com = await tx
          .select({ concorsoId: commissioni.concorsoId })
          .from(commissioni)
          .where(eq(commissioni.id, id))
          .limit(1);
        if (com.length === 0) return reply.notFound();
        const cms = await tx
          .select({ concorsoId: commissari.concorsoId })
          .from(commissari)
          .where(eq(commissari.id, commissarioId))
          .limit(1);
        if (cms.length === 0) return reply.notFound();
        if (cms[0]!.concorsoId !== com[0]!.concorsoId) {
          return reply.badRequest('il commissario non appartiene al concorso della commissione');
        }
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
        // N188: se il commissario rimosso era il presidente della commissione,
        // azzera presidenteCommissarioId per non lasciare un riferimento dangling.
        await tx
          .update(commissioni)
          .set({ presidenteCommissarioId: null, updatedAt: new Date() })
          .where(and(eq(commissioni.id, id), eq(commissioni.presidenteCommissarioId, commissarioId)));
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
        // N5: sezione e commissione devono appartenere allo stesso concorso.
        const com = await tx.select({ concorsoId: commissioni.concorsoId })
          .from(commissioni).where(eq(commissioni.id, id)).limit(1);
        if (com.length === 0) return reply.notFound();
        const sez = await tx.select({ concorsoId: sezioni.concorsoId })
          .from(sezioni).where(eq(sezioni.id, sezioneId)).limit(1);
        if (sez.length === 0) return reply.notFound();
        if (sez[0]!.concorsoId !== com[0]!.concorsoId) {
          return reply.badRequest('la sezione non appartiene al concorso della commissione');
        }
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
        // N5: la categoria (via la sua sezione) deve stare nello stesso concorso
        // della commissione.
        const com = await tx.select({ concorsoId: commissioni.concorsoId })
          .from(commissioni).where(eq(commissioni.id, id)).limit(1);
        if (com.length === 0) return reply.notFound();
        const catSez = await tx
          .select({ concorsoId: sezioni.concorsoId })
          .from(categorie)
          .innerJoin(sezioni, eq(categorie.sezioneId, sezioni.id))
          .where(eq(categorie.id, categoriaId))
          .limit(1);
        if (catSez.length === 0) return reply.notFound();
        if (catSez[0]!.concorsoId !== com[0]!.concorsoId) {
          return reply.badRequest('la categoria non appartiene al concorso della commissione');
        }
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
