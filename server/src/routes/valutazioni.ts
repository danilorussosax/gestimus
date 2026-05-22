import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { valutazioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
const upsertBody = z.object({
  candidatoFaseId: uuid,
  commissarioId: uuid,
  criterio: z.string().min(1).max(255),
  voto: z.number(),
  note: z.string().optional(),
});
const updateBody = z.object({
  voto: z.number().optional(),
  note: z.string().optional(),
});

/**
 * Mappa errori Postgres dei trigger → risposta HTTP appropriata.
 * Il trigger `freeze_valutazione_fase_conclusa` solleva con SQLSTATE 23514.
 */
function handlePgError(err: unknown): { code: number; body: { error: string } } | null {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const pgCode = e.code ?? e.cause?.code;
  // Drizzle ≥ 0.42 wrappa l'errore: e.message è "Failed query: ...", il msg
  // Postgres reale è in e.cause.message. Concateniamo entrambi.
  const allMsgs = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
  if (pgCode === '23514' && allMsgs.includes('CONCLUSA')) {
    return { code: 409, body: { error: 'fase CONCLUSA: valutazioni in sola lettura' } };
  }
  return null;
}

export const valutazioniRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /valutazioni?candidatoFaseId=...&commissarioId=...
  app.get('/', async (req) => {
    const q = z
      .object({ candidatoFaseId: uuid.optional(), commissarioId: uuid.optional() })
      .parse(req.query);
    return req.dbTx(async (tx) => {
      let where;
      if (q.candidatoFaseId && q.commissarioId) {
        where = and(
          eq(valutazioni.candidatoFaseId, q.candidatoFaseId),
          eq(valutazioni.commissarioId, q.commissarioId),
        );
      } else if (q.candidatoFaseId) {
        where = eq(valutazioni.candidatoFaseId, q.candidatoFaseId);
      } else if (q.commissarioId) {
        where = eq(valutazioni.commissarioId, q.commissarioId);
      }
      return where ? tx.select().from(valutazioni).where(where) : tx.select().from(valutazioni);
    });
  });

  // POST upsert: clamp voto e freeze fase CONCLUSA sono gestiti dai trigger DB.
  app.post(
    '/',
    { preHandler: [requireRole('admin', 'commissario')] },
    async (req, reply) => {
      const parsed = upsertBody.safeParse(req.body);
      if (!parsed.success) return reply.badRequest(parsed.error.message);
      try {
        return await req.dbTx(async (tx) => {
          const existing = await tx
            .select()
            .from(valutazioni)
            .where(
              and(
                eq(valutazioni.candidatoFaseId, parsed.data.candidatoFaseId),
                eq(valutazioni.commissarioId, parsed.data.commissarioId),
                eq(valutazioni.criterio, parsed.data.criterio),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            const [updated] = await tx
              .update(valutazioni)
              .set({
                voto: parsed.data.voto,
                note: parsed.data.note,
                timestamp: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(valutazioni.id, existing[0]!.id))
              .returning();
            await writeAudit(tx, req, 'valutazione.update', {
              targetType: 'valutazione',
              targetId: updated!.id,
              payload: { voto: updated!.voto, criterio: parsed.data.criterio },
            });
            return updated;
          }

          const [created] = await tx
            .insert(valutazioni)
            .values({
              tenantId: req.tenant!.id,
              candidatoFaseId: parsed.data.candidatoFaseId,
              commissarioId: parsed.data.commissarioId,
              criterio: parsed.data.criterio,
              voto: parsed.data.voto,
              note: parsed.data.note,
            })
            .returning();
          await writeAudit(tx, req, 'valutazione.create', {
            targetType: 'valutazione',
            targetId: created!.id,
            payload: { voto: created!.voto, criterio: parsed.data.criterio },
          });
          return reply.code(201).send(created);
        });
      } catch (err) {
        const mapped = handlePgError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.patch(
    '/:id',
    { preHandler: [requireRole('admin', 'commissario')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const parsed = updateBody.safeParse(req.body);
      if (!parsed.success) return reply.badRequest(parsed.error.message);
      try {
        return await req.dbTx(async (tx) => {
          const patch: Record<string, unknown> = {
            ...parsed.data,
            updatedAt: new Date(),
          };
          if (parsed.data.voto !== undefined) {
            patch.timestamp = new Date();
          }
          const [updated] = await tx
            .update(valutazioni)
            .set(patch)
            .where(eq(valutazioni.id, id))
            .returning();
          if (!updated) return reply.notFound();
          await writeAudit(tx, req, 'valutazione.update', {
            targetType: 'valutazione',
            targetId: id,
            payload: parsed.data,
          });
          return updated;
        });
      } catch (err) {
        const mapped = handlePgError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    try {
      return await req.dbTx(async (tx) => {
        const [deleted] = await tx.delete(valutazioni).where(eq(valutazioni.id, id)).returning();
        if (!deleted) return reply.notFound();
        await writeAudit(tx, req, 'valutazione.delete', {
          targetType: 'valutazione',
          targetId: id,
        });
        return reply.code(204).send();
      });
    } catch (err) {
      const mapped = handlePgError(err);
      if (mapped) return reply.code(mapped.code).send(mapped.body);
      throw err;
    }
  });
};
