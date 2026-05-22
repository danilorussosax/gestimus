import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const uuid = z.string().uuid();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  action: z.string().max(100).optional(),
  actor: uuid.optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('admin'));

  /**
   * GET /audit-log?limit=&action=&actor=&before=&after=
   * Solo admin del tenant. Ordinamento desc per created_at.
   */
  app.get('/', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const { limit, action, actor, before, after } = parsed.data;

    return req.dbTx(async (tx) => {
      const conditions = [];
      if (action) conditions.push(eq(auditLog.action, action));
      if (actor) conditions.push(eq(auditLog.actorAccountId, actor));
      if (before) conditions.push(lt(auditLog.createdAt, new Date(before)));
      if (after) conditions.push(gte(auditLog.createdAt, new Date(after)));

      const where = conditions.length ? and(...conditions) : undefined;
      const query = tx.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
      return where ? await query.where(where) : await query;
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
