import type { FastifyPluginAsync } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { accounts } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { hashPassword } from '../services/password.js';
import { invalidateAllSessionsForAccount } from '../services/session.js';

const uuid = z.string().uuid();
const createBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'commissario']),
  commissarioId: uuid.optional(),
  attivo: z.boolean().optional(),
});
const updateBody = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'commissario']).optional(),
  attivo: z.boolean().optional(),
  commissarioId: uuid.nullable().optional(),
});
const resetPwdBody = z.object({
  password: z.string().min(8).max(200),
});

function publicAccount(a: typeof accounts.$inferSelect) {
  return {
    id: a.id,
    email: a.email,
    role: a.role,
    attivo: a.attivo,
    emailVerified: a.emailVerified,
    commissarioId: a.commissarioId,
    totpEnabled: a.totpEnabled,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
  };
}

export const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /accounts → solo admin
  app.get('/', { preHandler: [requireRole('admin')] }, async (req) => {
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(accounts);
      return rows.map(publicAccount);
    });
  });

  app.get('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return publicAccount(rows[0]!);
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    const passwordHash = await hashPassword(parsed.data.password);
    return req.dbTx(async (tx) => {
      try {
        const [created] = await tx
          .insert(accounts)
          .values({
            tenantId: req.tenant!.id,
            email: parsed.data.email.toLowerCase(),
            passwordHash,
            role: parsed.data.role,
            commissarioId: parsed.data.commissarioId ?? null,
            attivo: parsed.data.attivo ?? true,
            emailVerified: true,
          })
          .returning();
        await writeAudit(tx, req, 'account.create', {
          targetType: 'account',
          targetId: created!.id,
          payload: { email: created!.email, role: created!.role },
        });
        return reply.code(201).send(publicAccount(created!));
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if ((e.code ?? e.cause?.code) === '23505') return reply.conflict('email già usata nel tenant');
        throw err;
      }
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    // Anti self-demotion: l'admin non può togliere a sé stesso il ruolo admin
    if (req.account && req.account.id === id && parsed.data.role && parsed.data.role !== 'admin') {
      return reply.code(403).send({ error: 'non puoi cambiare il tuo stesso ruolo da admin' });
    }
    if (req.account && req.account.id === id && parsed.data.attivo === false) {
      return reply.code(403).send({ error: 'non puoi disattivare il tuo stesso account' });
    }

    return req.dbTx(async (tx) => {
      const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
      if (parsed.data.email) patch.email = parsed.data.email.toLowerCase();
      const [updated] = await tx
        .update(accounts)
        .set(patch)
        .where(eq(accounts.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'account.update', {
        targetType: 'account',
        targetId: id,
        payload: parsed.data,
      });
      // Disattivazione o cambio ruolo invalida le sessioni attive
      if (parsed.data.attivo === false || parsed.data.role) {
        await invalidateAllSessionsForAccount(id);
      }
      return publicAccount(updated);
    });
  });

  app.post('/:id/reset-password', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = resetPwdBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const passwordHash = await hashPassword(parsed.data.password);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(accounts)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(accounts.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'account.reset_password', {
        targetType: 'account',
        targetId: id,
      });
      await invalidateAllSessionsForAccount(id);
      return { ok: true };
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    if (req.account && req.account.id === id) {
      return reply.code(403).send({ error: 'non puoi cancellare il tuo stesso account' });
    }
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(accounts).where(eq(accounts.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'account.delete', {
        targetType: 'account',
        targetId: id,
        payload: { email: deleted.email, role: deleted.role },
      });
      return reply.code(204).send();
    });
  });
};
