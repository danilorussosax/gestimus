import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { valutazioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { replyValidationError } from '../lib/validation.js';
import { replyDomainError } from '../lib/domain-error.js';
import { createValutazione, updateValutazione } from '../services/valutazioni-service.js';

const uuid = z.string().uuid();
// N15: bound applicativo su `voto` (clamp DB in [0, scala] via trigger). Upper
// bound generoso (1000 = scala massima ammessa); il clamp per-fase fa il resto.
const VOTO_MAX = 1000;
const upsertBody = z.object({
  candidatoFaseId: uuid,
  commissarioId: uuid,
  criterio: z.string().min(1).max(255),
  voto: z.number().min(0).max(VOTO_MAX),
  note: z.string().optional(),
});
const updateBody = z.object({
  voto: z.number().min(0).max(VOTO_MAX).optional(),
  note: z.string().optional(),
});

/**
 * Mappa errori Postgres dei trigger → risposta HTTP. Il trigger
 * `freeze_valutazione_fase_conclusa` solleva con SQLSTATE 23514.
 */
function handlePgError(err: unknown): { code: number; body: { error: string } } | null {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const pgCode = e.code ?? e.cause?.code;
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
    const { limit, offset } = parsePagination(req.query);
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
      const base = tx.select().from(valutazioni).$dynamic();
      const filtered = where ? base.where(where) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  // POST upsert: la logica (authz + upsert) è in services/valutazioni-service.ts.
  // La route è un thin adapter: parse → service → mappa Result/errori in HTTP.
  app.post('/', { preHandler: [requireRole('admin', 'commissario')] }, async (req, reply) => {
    const parsed = upsertBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    try {
      return await req.dbTx(async (tx) => {
        const result = await createValutazione(
          tx,
          { role: req.account?.role, commissarioId: req.account?.commissarioId },
          { tenantId: req.tenant!.id, ...parsed.data },
        );
        if (!result.ok) return replyDomainError(reply, result.error);
        const { row, inserted } = result.value;
        await writeAudit(tx, req, inserted ? 'valutazione.create' : 'valutazione.update', {
          targetType: 'valutazione',
          targetId: row.id,
          payload: { voto: row.voto, criterio: parsed.data.criterio },
        });
        if (inserted) return reply.code(201).send(row);
        return row;
      });
    } catch (err) {
      const mapped = handlePgError(err);
      if (mapped) return reply.code(mapped.code).send(mapped.body);
      throw err;
    }
  });

  app.patch('/:id', { preHandler: [requireRole('admin', 'commissario')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    try {
      return await req.dbTx(async (tx) => {
        const result = await updateValutazione(
          tx,
          { role: req.account?.role, commissarioId: req.account?.commissarioId },
          id,
          parsed.data,
        );
        if (!result.ok) return replyDomainError(reply, result.error);
        await writeAudit(tx, req, 'valutazione.update', {
          targetType: 'valutazione',
          targetId: id,
          payload: parsed.data,
        });
        return result.value;
      });
    } catch (err) {
      const mapped = handlePgError(err);
      if (mapped) return reply.code(mapped.code).send(mapped.body);
      throw err;
    }
  });

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
