import type { FastifyPluginAsync } from 'fastify';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { accounts, auditLog, commissari } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit, computeAuditLogSig } from '../services/audit.js';
import { invalidateAllSessionsForAccount } from '../services/session.js';
import { dbSuper } from '../db/client.js';

// #3 — Self-service GDPR per l'utente AUTENTICATO (admin/commissario). Prima i
// diritti di accesso (Art.15), portabilità (Art.20) e oblio (Art.17) erano
// esercitabili SOLO dall'admin del tenant: un commissario non poteva accedere
// né cancellare i propri dati autonomamente. Nota: i candidati/iscritti NON
// hanno login → i loro diritti restano mediati dall'admin (/api/privacy) o da un
// futuro flusso a token; qui copriamo gli account con sessione.
const REDACTED = '[ERASED]';

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // GET /me/data — esporta i propri dati personali (Art.15/20).
  app.get('/data', async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    const accountId = req.account!.id;
    const commissarioId = req.account!.commissarioId;
    return req.dbTx(async (tx) => {
      const [acc] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      const account = acc ? {
        id: acc.id, email: acc.email, role: acc.role, attivo: acc.attivo,
        emailVerified: acc.emailVerified, commissarioId: acc.commissarioId,
        totpEnabled: acc.totpEnabled, lastLoginAt: acc.lastLoginAt, createdAt: acc.createdAt,
      } : null;
      const commissario = commissarioId
        ? (await tx.select().from(commissari).where(eq(commissari.id, commissarioId)).limit(1))[0] ?? null
        : null;
      // Trattamenti in cui l'utente è ATTORE (le sue azioni nell'audit log).
      const azioni = await tx
        .select({ id: auditLog.id, action: auditLog.action, targetType: auditLog.targetType, targetId: auditLog.targetId, createdAt: auditLog.createdAt })
        .from(auditLog).where(eq(auditLog.actorAccountId, accountId)).orderBy(auditLog.createdAt).limit(5000);
      return { exportedAt: new Date().toISOString(), account, commissario, azioni };
    });
  });

  // POST /me/erase — diritto all'oblio self-service (Art.17). Pseudonimizza il
  // proprio profilo commissario e anonimizza/disattiva il proprio account.
  app.post('/erase', async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    const accountId = req.account!.id;
    const commissarioId = req.account!.commissarioId;
    const result = await req.dbTx(async (tx) => {
      // L'ULTIMO admin attivo non può auto-cancellarsi (lockout del tenant):
      // deve prima promuovere/riattivare un altro admin.
      if (req.account!.role === 'admin') {
        const others = await tx.select({ n: count() }).from(accounts)
          .where(and(eq(accounts.role, 'admin'), eq(accounts.attivo, true), ne(accounts.id, accountId)));
        if (Number(others[0]?.n ?? 0) === 0) {
          reply.code(409).send({ error: 'sei l\'unico admin attivo del tenant: promuovi un altro admin prima di cancellare il tuo account', code: 'LAST_ADMIN' });
          return null;
        }
      }
      if (commissarioId) {
        await tx.update(commissari).set({
          nome: REDACTED, cognome: REDACTED, email: null, telefono: null,
          dataNascita: null, nazionalita: null, foto: null, bio: null,
          stato: 'INATTIVO', updatedAt: new Date(),
        }).where(eq(commissari.id, commissarioId));
      }
      await tx.update(accounts).set({
        email: sql`'erased+' || ${accounts.id}::text || '@erased.local'`,
        attivo: false, totpSecret: null, totpEnabled: false, totpRecoveryCodes: null,
        updatedAt: new Date(),
      }).where(eq(accounts.id, accountId));
      await writeAudit(tx, req, 'privacy.self_erase', { payload: { hadCommissario: !!commissarioId } });
      return { ok: true as const };
    });
    if (!result) return reply; // 409 LAST_ADMIN già inviato

    // Art.17: azzera ip/userAgent dalle PROPRIE azioni nell'audit (PII residue).
    // audit_log è append-only per il ruolo app → dbSuper. Ogni riga ri-firmata
    // (createdAt invariato → resta firma v2 valida).
    try {
      const rows = await dbSuper.select().from(auditLog)
        .where(and(eq(auditLog.tenantId, req.tenant.id), eq(auditLog.actorAccountId, accountId)));
      if (rows.length > 0) {
        await dbSuper.transaction(async (tx) => {
          for (const r of rows) {
            const sig = computeAuditLogSig({
              tenantId: r.tenantId, actorAccountId: r.actorAccountId, action: r.action,
              targetType: r.targetType, targetId: r.targetId, payload: r.payload,
              ip: null, userAgent: null,
            }, r.createdAt);
            await tx.update(auditLog).set({ ip: null, userAgent: null, sig }).where(eq(auditLog.id, r.id));
          }
        });
      }
    } catch (err) {
      req.log.warn({ err }, 'self_erase: scrub ip/userAgent audit fallito (best-effort)');
    }

    // Disconnette l'utente (account ora disattivato).
    await invalidateAllSessionsForAccount(accountId);
    return { ok: true };
  });
};
