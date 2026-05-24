import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { verifyPassword } from '../services/password.js';
import { createSession, invalidateSession } from '../services/session.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { writeAudit, writePlatformAudit } from '../services/audit.js';
import { env } from '../env.js';

// Rate-limit brute-force credenziali: 10/15min in produzione. Fuori produzione
// (dev/test/E2E) il limite è di fatto disattivato → suite deterministica senza
// che login ripetuti esauriscano il budget per-IP.
const LOGIN_RL_MAX = env.NODE_ENV === 'production' ? 10 : 100_000;
import {
  createMfaChallenge,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyMfaChallenge,
  verifyTotp,
} from '../services/totp.js';

// M152: traccia forensica dei tentativi di login (successo e fallimento).
// Best-effort: un errore di audit non deve mai far fallire il login. Tenant →
// audit_log (RLS); superadmin/platform → platform_audit_log.
async function auditLogin(
  req: FastifyRequest,
  action: 'auth.login' | 'auth.login_failed' | 'auth.totp_enabled' | 'auth.totp_disabled',
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

// Emette la sessione (cookie), aggiorna lastLoginAt e audita il login.
// Condiviso tra login diretto (no 2FA) e verify-totp (2FA superato).
async function finishLogin(
  req: FastifyRequest,
  reply: FastifyReply,
  account: typeof accounts.$inferSelect,
): Promise<{ account: { id: string; email: string; role: string; tenantId: string }; expiresAt: Date }> {
  const { token, expiresAt } = await createSession(account.id, account.tenantId);
  setSessionCookie(reply, token, expiresAt);
  // M192: aggiorna anche updatedAt per coerenza (lastLoginAt è una mutazione).
  await dbSuper.update(accounts).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(accounts.id, account.id));
  await auditLogin(req, 'auth.login', account.email, account.id);
  return {
    account: { id: account.id, email: account.email, role: account.role, tenantId: account.tenantId },
    expiresAt,
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /auth/login
   * Body: { email, password }
   * Risolve l'account nel tenant corrente (o globalmente se subdomain = platform).
   */
  app.post('/login', {
    // H2: rate limit brute-force credenziali. 10 tentativi/15 min/IP (in prod).
    config: {
      rateLimit: {
        max: LOGIN_RL_MAX,
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

    // 2FA: se attivo, NON emettere la sessione. Ritorna un challenge firmato che
    // prova "password corretta"; il client lo riusa su /login/verify-totp col
    // codice TOTP (o un recovery code) per ottenere la sessione.
    if (account.totpEnabled && account.totpSecret) {
      return { mfaRequired: true, challenge: createMfaChallenge(account.id) };
    }

    return finishLogin(req, reply, account);
  });

  /**
   * POST /auth/login/verify-totp
   * Body: { challenge, code }  — code = TOTP 6 cifre oppure recovery code.
   * Secondo fattore: completa il login per gli account con 2FA attivo.
   */
  app.post('/login/verify-totp', {
    config: {
      rateLimit: {
        max: LOGIN_RL_MAX,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({ error: 'troppi tentativi, riprova tra qualche minuto' }),
      },
    },
  }, async (req, reply) => {
    const parsed = z
      .object({ challenge: z.string().min(1), code: z.string().min(1).max(40) })
      .safeParse(req.body);
    if (!parsed.success) return reply.badRequest('challenge/code non validi');

    const accountId = verifyMfaChallenge(parsed.data.challenge);
    if (!accountId) return reply.code(401).send({ error: 'challenge scaduto o non valido, rifai il login' });

    const rows = await dbSuper.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    const account = rows[0];
    if (!account || !account.attivo || !account.totpEnabled || !account.totpSecret) {
      return reply.code(401).send({ error: 'credenziali non valide' });
    }

    const code = parsed.data.code.trim();
    let verified = false;
    if (/^\d{6}$/.test(code)) {
      verified = verifyTotp(account.totpSecret, code);
    } else {
      // Recovery code: confronto sull'hash; se valido viene CONSUMATO (one-time).
      const codeHash = hashRecoveryCode(code);
      const remaining = (account.totpRecoveryCodes ?? []).filter((h) => h !== codeHash);
      if (remaining.length < (account.totpRecoveryCodes ?? []).length) {
        verified = true;
        await dbSuper.update(accounts).set({ totpRecoveryCodes: remaining }).where(eq(accounts.id, account.id));
      }
    }

    if (!verified) {
      await auditLogin(req, 'auth.login_failed', account.email, account.id);
      return reply.code(401).send({ error: 'codice 2FA non valido' });
    }

    await dbSuper.update(accounts).set({ totpLastUsedAt: new Date() }).where(eq(accounts.id, account.id));
    return finishLogin(req, reply, account);
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

  // --- Setup 2FA (TOTP) per l'account autenticato ---------------------------

  /**
   * POST /auth/totp/setup — genera un secret PENDING (totpEnabled resta false)
   * e ritorna secret + otpauth URI da scansionare. Non attiva ancora il 2FA.
   */
  app.post('/totp/setup', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    preHandler: [requireAuth],
  }, async (req) => {
    const a = req.account!;
    const secret = generateTotpSecret();
    await dbSuper
      .update(accounts)
      .set({ totpSecret: secret, totpEnabled: false, updatedAt: new Date() })
      .where(eq(accounts.id, a.id));
    return { secret, uri: totpUri(secret, a.email) };
  });

  /**
   * POST /auth/totp/enable { code } — verifica il codice contro il secret
   * pending; se valido attiva il 2FA e ritorna i recovery code UNA SOLA VOLTA
   * (nel DB solo gli hash).
   */
  app.post('/totp/enable', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    preHandler: [requireAuth],
  }, async (req, reply) => {
    const a = req.account!;
    const parsed = z.object({ code: z.string().min(6).max(10) }).safeParse(req.body);
    if (!parsed.success) return reply.badRequest('codice non valido');
    const rows = await dbSuper.select().from(accounts).where(eq(accounts.id, a.id)).limit(1);
    const acc = rows[0];
    if (!acc?.totpSecret) return reply.code(409).send({ error: 'setup 2FA non avviato' });
    if (acc.totpEnabled) return reply.code(409).send({ error: '2FA già attivo' });
    if (!verifyTotp(acc.totpSecret, parsed.data.code)) {
      return reply.code(400).send({ error: 'codice non valido, riprova' });
    }
    const codes = generateRecoveryCodes();
    await dbSuper
      .update(accounts)
      .set({
        totpEnabled: true,
        totpRecoveryCodes: codes.map(hashRecoveryCode),
        totpLastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, a.id));
    await auditLogin(req, 'auth.totp_enabled', a.email, a.id);
    return { ok: true, recoveryCodes: codes };
  });

  /**
   * POST /auth/totp/disable { password } — disattiva il 2FA previa riconferma
   * della password (evita che una sessione rubata possa togliere il 2FA).
   */
  app.post('/totp/disable', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    preHandler: [requireAuth],
  }, async (req, reply) => {
    const a = req.account!;
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return reply.badRequest('password richiesta');
    if (!(await verifyPassword(parsed.data.password, a.passwordHash))) {
      return reply.code(401).send({ error: 'password non valida' });
    }
    await dbSuper
      .update(accounts)
      .set({
        totpEnabled: false,
        totpSecret: null,
        totpRecoveryCodes: null,
        totpLastUsedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, a.id));
    await auditLogin(req, 'auth.totp_disabled', a.email, a.id);
    return { ok: true };
  });
};
