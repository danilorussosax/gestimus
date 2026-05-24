import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { eq, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { dbSuper } from '../db/client.js';
import { accounts, sessions } from '../db/schema.js';

export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

export type AccountRecord = typeof accounts.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;

export type SessionValidation =
  | { account: AccountRecord; session: SessionRecord; refreshed: boolean }
  | { account: null; session: null; refreshed: false };

function generateSessionToken(): string {
  const bytes = randomBytes(20);
  return encodeBase32LowerCaseNoPadding(bytes);
}

function tokenToSessionId(token: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

/**
 * Crea una nuova sessione per l'account.
 * Ritorna il token in chiaro (da spedire nel cookie) e l'expiresAt.
 * Il DB memorizza solo l'hash SHA-256 del token.
 */
export async function createSession(
  accountId: string,
  tenantId: string,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const sessionId = tokenToSessionId(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await dbSuper.insert(sessions).values({
    id: sessionId,
    accountId,
    tenantId,
    expiresAt,
  });

  return { token, sessionId, expiresAt };
}

/**
 * Valida un token di sessione (estratto dal cookie).
 * Auto-refresh: se la sessione è oltre la metà della sua TTL, estende l'expiresAt.
 * Auto-cleanup: sessioni scadute vengono cancellate.
 */
export async function validateSessionToken(token: string): Promise<SessionValidation> {
  if (!token || token.length < 16) return { account: null, session: null, refreshed: false };

  const sessionId = tokenToSessionId(token);

  const row = await dbSuper
    .select({
      session: sessions,
      account: accounts,
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (row.length === 0) return { account: null, session: null, refreshed: false };

  const { session, account } = row[0]!;

  // Scadenza
  if (session.expiresAt.getTime() < Date.now()) {
    await dbSuper.delete(sessions).where(eq(sessions.id, sessionId));
    return { account: null, session: null, refreshed: false };
  }

  // Account disattivato
  if (!account.attivo) {
    await dbSuper.delete(sessions).where(eq(sessions.id, sessionId));
    return { account: null, session: null, refreshed: false };
  }

  // Refresh se entro la seconda metà della TTL
  let refreshed = false;
  if (Date.now() >= session.expiresAt.getTime() - REFRESH_THRESHOLD_MS) {
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await dbSuper.update(sessions).set({ expiresAt: newExpiresAt }).where(eq(sessions.id, sessionId));
    session.expiresAt = newExpiresAt;
    refreshed = true;
  }

  return { account, session, refreshed };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await dbSuper.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateAllSessionsForAccount(accountId: string): Promise<void> {
  await dbSuper.delete(sessions).where(eq(sessions.accountId, accountId));
}

/** Pulisce le sessioni scadute. Da chiamare periodicamente (cron). */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await dbSuper.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return result.rowCount ?? 0;
}
