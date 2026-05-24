import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { env } from '../env.js';
import {
  invalidateSession,
  validateSessionToken,
  type AccountRecord,
  type SessionRecord,
} from '../services/session.js';

export type AuthRole = 'admin' | 'commissario' | 'superadmin';

declare module 'fastify' {
  interface FastifyRequest {
    account: AccountRecord | null;
    session: SessionRecord | null;
  }
}

export const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  // N136 (non firmato di proposito): il cookie NON codifica fiducia — contiene
  // solo un token casuale opaco validato lato server (validateSessionToken).
  // Una manomissione produce un token inesistente → 401, non una sessione
  // forgiata. La firma HMAC protegge i cookie che *trasportano* dati di trust
  // (es. uno userId): qui sarebbe ridondante. httpOnly + opacità + lookup DB
  // sono la difesa effettiva.
  signed: false,
};

/**
 * Hook globale: legge il cookie di sessione (se presente), valida il token,
 * e popola req.account / req.session. Non blocca nulla — sono le route
 * a decidere se richiedere auth tramite preHandler requireAuth/requireRole.
 */
export async function registerAuthMiddleware(app: FastifyInstance): Promise<void> {
  app.decorateRequest('account', null);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[env.SESSION_COOKIE_NAME];
    if (!token) return;
    const result = await validateSessionToken(token);
    req.account = result.account;
    req.session = result.session;
    // R15: se la sessione è stata auto-rinnovata lato DB, ri-emetti il cookie con
    // la nuova scadenza — altrimenti il browser lo lascia scadere all'orario
    // originale e l'utente viene sloggato a metà finestra nonostante il refresh.
    if (result.refreshed && result.session) {
      setSessionCookie(reply, token, result.session.expiresAt);
    }
  });
}

/** Richiede sessione valida. Verifica anche che il tenant del cookie matchi il subdomain. */
export const requireAuth: preHandlerAsyncHookHandler = async (req, reply) => {
  if (!req.account || !req.session) {
    return reply.code(401).send({ error: 'autenticazione richiesta' });
  }
  if (req.tenant && req.session.tenantId !== req.tenant.id) {
    // C12: cookie firmato per tenant A presentato su tenant B → invalida la
    // sessione (DB-side) e cancella il cookie. Senza questo, un cookie rubato
    // poteva essere usato per sondare infiniti tenant senza penalità.
    // N134 (falso positivo): questo check blocca ANCHE un superadmin sul
    // subdomain di un tenant — la sua sessione ha tenantId = platform, che non
    // combacia con req.tenant.id del tenant → 403. Nessun accesso cross-tenant.
    try { await invalidateSession(req.session.id); } catch { /* best-effort */ }
    req.account = null;
    req.session = null;
    clearSessionCookie(reply);
    return reply.code(403).send({ error: 'sessione di altro tenant' });
  }
  if (req.isSuperadmin && req.account.role !== 'superadmin') {
    return reply.code(403).send({ error: 'solo super-admin' });
  }
};

/** Richiede uno specifico ruolo. Va combinato con requireAuth. */
export function requireRole(...roles: AuthRole[]): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    if (!req.account) {
      return reply.code(401).send({ error: 'autenticazione richiesta' });
    }
    if (!roles.includes(req.account.role as AuthRole)) {
      return reply.code(403).send({ error: `ruolo richiesto: ${roles.join(' | ')}` });
    }
  };
}

export function clearSessionCookie(reply: FastifyReply): void {
  // L224: il clear deve combaciare con gli attributi del set (path/httpOnly/
  // secure/sameSite), altrimenti alcuni browser non rimuovono un cookie Secure.
  reply.clearCookie(env.SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    expires: expiresAt,
  });
}
