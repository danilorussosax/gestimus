import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
  action: z.string().max(100).optional(),
  actor: uuid.optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('admin'));

  /**
   * GET /audit-log?limit=&offset=&action=&actor=&before=&after=
   * Solo admin del tenant. Ordinamento desc per created_at.
   *
   * Contratto lista paginato (riusabile): `{ items, total, limit, offset }`.
   * `total` è il conteggio totale che soddisfa i filtri (non solo la pagina),
   * così il client può mostrare "N di M" e abilitare avanti/indietro.
   */
  app.get('/', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    const { limit, offset, action, actor, before, after } = parsed.data;

    return req.dbTx(async (tx) => {
      const conditions = [];
      if (action) conditions.push(eq(auditLog.action, action));
      if (actor) conditions.push(eq(auditLog.actorAccountId, actor));
      if (before) conditions.push(lt(auditLog.createdAt, new Date(before)));
      if (after) conditions.push(gte(auditLog.createdAt, new Date(after)));

      const where = conditions.length ? and(...conditions) : undefined;

      const pageQuery = tx
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset);
      const items = where ? await pageQuery.where(where) : await pageQuery;

      const countQuery = tx.select({ n: sql<number>`count(*)::int` }).from(auditLog);
      const [countRow] = where ? await countQuery.where(where) : await countQuery;

      return { items, total: countRow?.n ?? 0, limit, offset };
    });
  });

  /**
   * GET /audit-log/stats → conteggio per action negli ultimi 30gg
   */
  app.get('/stats', async (req) => {
    return req.dbTx(async (tx) => {
      const rows = await tx
        .select({
          action: auditLog.action,
          count: sql<number>`count(*)::int`.as('count'),
        })
        .from(auditLog)
        .where(gte(auditLog.createdAt, sql`now() - interval '30 days'`))
        .groupBy(auditLog.action)
        .orderBy(desc(sql`count(*)`));
      return rows;
    });
  });
};
