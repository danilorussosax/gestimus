import type { FastifyPluginAsync } from 'fastify';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination.js';
import { accounts, commissari } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { hashPassword } from '../services/password.js';
import { invalidateAllSessionsForAccount } from '../services/session.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();

// L16: conta gli admin attivi del tenant DIVERSI da `excludeId`. Serve a
// impedire la rimozione/disattivazione/demozione dell'ultimo admin (lockout
// del tenant). La query gira sotto RLS quindi è già ristretta al tenant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function otherActiveAdminsCount(tx: any, excludeId: string): Promise<number> {
  const rows = await tx
    .select({ n: count() })
    .from(accounts)
    .where(and(eq(accounts.role, 'admin'), eq(accounts.attivo, true), ne(accounts.id, excludeId)));
  return Number(rows[0]?.n ?? 0);
}
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
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(accounts).limit(limit).offset(offset);
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
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);

    const passwordHash = await hashPassword(parsed.data.password);
    return req.dbTx(async (tx) => {
      // N53: come il PATCH, valida che commissarioId appartenga al tenant
      // (query sotto RLS → commissario di altro tenant non visibile).
      if (parsed.data.commissarioId) {
        const cm = await tx
          .select({ id: commissari.id })
          .from(commissari)
          .where(eq(commissari.id, parsed.data.commissarioId))
          .limit(1);
        if (cm.length === 0) return reply.badRequest('commissario non trovato nel tenant corrente');
      }
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
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);

    // Anti self-demotion: l'admin non può togliere a sé stesso il ruolo admin
    if (req.account && req.account.id === id && parsed.data.role && parsed.data.role !== 'admin') {
      return reply.code(403).send({ error: 'non puoi cambiare il tuo stesso ruolo da admin' });
    }
    if (req.account && req.account.id === id && parsed.data.attivo === false) {
      return reply.code(403).send({ error: 'non puoi disattivare il tuo stesso account' });
    }

    return req.dbTx(async (tx) => {
      // N25: se viene assegnato un commissarioId, deve appartenere al tenant
      // corrente. La query gira sotto RLS (app.tenant_id) quindi un commissario
      // di altro tenant non è visibile → 0 righe → rifiuto esplicito.
      if (parsed.data.commissarioId) {
        const cm = await tx
          .select({ id: commissari.id })
          .from(commissari)
          .where(eq(commissari.id, parsed.data.commissarioId))
          .limit(1);
        if (cm.length === 0) {
          return reply.badRequest('commissario non trovato nel tenant corrente');
        }
      }
      // R15: invariante role↔commissarioId. Un account 'commissario' DEVE avere
      // un commissarioId (tenant-valido); un 'admin' NON deve averne uno — un
      // binding residuo lascerebbe l'authz commissario-scoped incoerente. Calcola
      // il risultato del patch e correggi/rifiuta di conseguenza.
      const cur = await tx
        .select({ role: accounts.role, commissarioId: accounts.commissarioId })
        .from(accounts)
        .where(eq(accounts.id, id))
        .limit(1);
      if (cur.length === 0) return reply.notFound();
      const resultRole = parsed.data.role ?? cur[0]!.role;
      const resultCommissarioId =
        parsed.data.commissarioId !== undefined ? parsed.data.commissarioId : cur[0]!.commissarioId;
      if (resultRole === 'commissario') {
        if (!resultCommissarioId) {
          return reply.badRequest('un account commissario richiede un commissarioId valido');
        }
      } else if (resultCommissarioId !== null) {
        parsed.data.commissarioId = null; // ruolo non-commissario → azzera il binding
      }
      // L16: blocca demozione/disattivazione dell'ultimo admin del tenant.
      const demoting = parsed.data.role && parsed.data.role !== 'admin';
      const disabling = parsed.data.attivo === false;
      if (demoting || disabling) {
        const target = await tx.select({ role: accounts.role, attivo: accounts.attivo })
          .from(accounts).where(eq(accounts.id, id)).limit(1);
        const isActiveAdmin = target[0]?.role === 'admin' && target[0]?.attivo === true;
        if (isActiveAdmin && (await otherActiveAdminsCount(tx, id)) === 0) {
          return reply.code(409).send({ error: 'non puoi rimuovere l\'ultimo admin attivo del tenant' });
        }
      }
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
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
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
      // L16: blocca la cancellazione dell'ultimo admin attivo del tenant.
      const target = await tx.select({ role: accounts.role, attivo: accounts.attivo })
        .from(accounts).where(eq(accounts.id, id)).limit(1);
      if (target[0]?.role === 'admin' && target[0]?.attivo === true
        && (await otherActiveAdminsCount(tx, id)) === 0) {
        return reply.code(409).send({ error: 'non puoi cancellare l\'ultimo admin attivo del tenant' });
      }
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
