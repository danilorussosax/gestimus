import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { verifyPassword } from '../services/password.js';
import { createSession, invalidateSession } from '../services/session.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /auth/login
   * Body: { email, password }
   * Risolve l'account nel tenant corrente (o globalmente se subdomain = platform).
   */
  app.post('/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest('email/password non validi');
    }
    const { email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    // Risolve l'account: se siamo su subdomain tenant, restringe al tenant_id;
    // se siamo su subdomain platform, l'account deve avere role=superadmin.
    let account: typeof accounts.$inferSelect | undefined;
    if (req.tenant) {
      const rows = await dbSuper
        .select()
        .from(accounts)
        .where(and(eq(accounts.tenantId, req.tenant.id), eq(accounts.email, normalizedEmail)))
        .limit(1);
      account = rows[0];
    } else if (req.isSuperadmin) {
      const rows = await dbSuper
        .select()
        .from(accounts)
        .where(and(eq(accounts.email, normalizedEmail), eq(accounts.role, 'superadmin')))
        .limit(1);
      account = rows[0];
    } else {
      return reply.badRequest('contesto tenant/superadmin mancante');
    }

    if (!account || !account.attivo) {
      // Verifica fittizia per timing-safe
      await verifyPassword(password, '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      return reply.code(401).send({ error: 'credenziali non valide' });
    }

    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: 'credenziali non valide' });
    }

    const { token, expiresAt } = await createSession(account.id, account.tenantId);
    setSessionCookie(reply, token, expiresAt);

    await dbSuper.update(accounts).set({ lastLoginAt: new Date() }).where(eq(accounts.id, account.id));

    return {
      account: {
        id: account.id,
        email: account.email,
        role: account.role,
        tenantId: account.tenantId,
      },
      expiresAt,
    };
  });

  /**
   * POST /auth/logout
   * Invalida la sessione corrente e cancella il cookie.
   */
  app.post('/logout', { preHandler: [requireAuth] }, async (req, reply) => {
    if (req.session) {
      await invalidateSession(req.session.id);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  /**
   * GET /auth/me
   * Ritorna l'account loggato.
   */
  app.get('/me', { preHandler: [requireAuth] }, async (req) => {
    const a = req.account!;
    return {
      id: a.id,
      email: a.email,
      role: a.role,
      attivo: a.attivo,
      tenantId: a.tenantId,
      commissarioId: a.commissarioId,
      totpEnabled: a.totpEnabled,
    };
  });
};
