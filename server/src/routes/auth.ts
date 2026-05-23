import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { verifyPassword } from '../services/password.js';
import { createSession, invalidateSession } from '../services/session.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { writeAudit, writePlatformAudit } from '../services/audit.js';

// M152: traccia forensica dei tentativi di login (successo e fallimento).
// Best-effort: un errore di audit non deve mai far fallire il login. Tenant →
// audit_log (RLS); superadmin/platform → platform_audit_log.
async function auditLogin(
  req: FastifyRequest,
  action: 'auth.login' | 'auth.login_failed',
  email: string,
  actorAccountId: string | null,
): Promise<void> {
  try {
    if (req.tenant) {
      await req.dbTx(async (tx) => {
        await writeAudit(tx, req, action, { actorAccountId, payload: { email } });
      });
    } else {
      await writePlatformAudit(req, action, { actorAccountId, payload: { email } });
    }
  } catch (err) {
    req.log.warn({ err }, 'audit login best-effort fallito');
  }
}

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
  app.post('/login', {
    // H2: rate limit brute-force credenziali. 10 tentativi/15 min/IP.
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({ error: 'troppi tentativi di login, riprova tra qualche minuto' }),
      },
    },
  }, async (req, reply) => {
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
      await auditLogin(req, 'auth.login_failed', normalizedEmail, null);
      return reply.code(401).send({ error: 'credenziali non valide' });
    }

    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) {
      await auditLogin(req, 'auth.login_failed', normalizedEmail, account.id);
      return reply.code(401).send({ error: 'credenziali non valide' });
    }

    const { token, expiresAt } = await createSession(account.id, account.tenantId);
    setSessionCookie(reply, token, expiresAt);

    // M192: aggiorna anche updatedAt per coerenza (lastLoginAt è una mutazione).
    await dbSuper.update(accounts).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(accounts.id, account.id));
    await auditLogin(req, 'auth.login', normalizedEmail, account.id);

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
  app.post('/logout', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    preHandler: [requireAuth],
  }, async (req, reply) => {
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
  app.get('/me', {
    // N8: rate limit leggero contro polling abusivo (ogni hit tocca il DB
    // per la validazione sessione). 120/min copre l'uso normale dell'app.
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    preHandler: [requireAuth],
  }, async (req) => {
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
