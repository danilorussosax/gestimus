import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { eq, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { dbSuper } from '../db/client.js';
import { accounts, sessions } from '../db/schema.js';

export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

// #4: cap di vita ASSOLUTO. Il refresh rolling (sotto) estende expiresAt a ogni
// uso, quindi senza un tetto una sessione vivrebbe all'infinito. Fissiamo il
// massimo a 60 giorni dalla CREAZIONE (sessions.createdAt): il rolling 30d
// mantiene comodo l'uso quotidiano, ma dopo 60d dall'emissione si deve fare
// re-login a prescindere. La sessione oltre il cap è trattata come scaduta
// (cancellata + invalid), coerente con la gestione di expiresAt scaduto.
export const ABSOLUTE_SESSION_MAX_DAYS = 60;
const ABSOLUTE_SESSION_MAX_MS = ABSOLUTE_SESSION_MAX_DAYS * 24 * 60 * 60 * 1000;

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
 * Le sessioni scadute (rolling) NON vengono cancellate qui (hot path): la pulizia
 * è delegata al cron cleanupExpiredSessions.
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

  const now = Date.now();

  // #4: cap di vita assoluto. Anche se expiresAt è ancora futuro (per via dei
  // refresh rolling), una sessione più vecchia di createdAt + cap è considerata
  // scaduta e cancellata: forza il re-login dopo ABSOLUTE_SESSION_MAX_DAYS dalla
  // creazione. Multi-device intatto: cancelliamo SOLO questa sessione.
  const absoluteDeadline = session.createdAt.getTime() + ABSOLUTE_SESSION_MAX_MS;
  if (now > absoluteDeadline) {
    await dbSuper.delete(sessions).where(eq(sessions.id, sessionId));
    return { account: null, session: null, refreshed: false };
  }

  // Scadenza (rolling). NON cancelliamo inline: questo metodo gira su OGNI
  // richiesta nell'hot path di auth, e un utente che ripresenta un cookie scaduto
  // innescherebbe una write per ogni richiesta. La pulizia delle righe scadute è
  // delegata al cron (cleanupExpiredSessions, schedulato in index.ts). Qui basta
  // trattare la sessione come non autenticata.
  if (session.expiresAt.getTime() < now) {
    return { account: null, session: null, refreshed: false };
  }

  // Account disattivato
  if (!account.attivo) {
    await dbSuper.delete(sessions).where(eq(sessions.id, sessionId));
    return { account: null, session: null, refreshed: false };
  }

  // Refresh se entro la seconda metà della TTL. #4: il nuovo expiresAt è
  // clampato al cap assoluto (createdAt + ABSOLUTE_SESSION_MAX_MS) → il rolling
  // non può mai spingere la sessione oltre il tetto.
  let refreshed = false;
  if (now >= session.expiresAt.getTime() - REFRESH_THRESHOLD_MS) {
    const rollingTarget = now + SESSION_TTL_MS;
    const clamped = Math.min(rollingTarget, absoluteDeadline);
    const newExpiresAt = new Date(clamped);
    // Evita una UPDATE inutile se il clamp non sposta in avanti la scadenza.
    if (newExpiresAt.getTime() > session.expiresAt.getTime()) {
      await dbSuper.update(sessions).set({ expiresAt: newExpiresAt }).where(eq(sessions.id, sessionId));
      session.expiresAt = newExpiresAt;
      refreshed = true;
    }
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
