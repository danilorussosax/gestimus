import type { FastifyPluginAsync } from 'fastify';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '../lib/zod-helpers.js';
import { parsePagination } from '../lib/pagination.js';
import { expectedVersionField, versionFresh, STALE_VERSION_BODY } from '../lib/optimistic.js';
import { accounts, commissari } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { TxClient } from '../middleware/tenant.js';
import { writeAudit } from '../services/audit.js';
import { hashPassword } from '../services/password.js';
import { invalidateAllSessionsForAccount } from '../services/session.js';
import { replyValidationError } from '../lib/validation.js';


// L16: conta gli admin attivi del tenant DIVERSI da `excludeId`. Serve a
// impedire la rimozione/disattivazione/demozione dell'ultimo admin (lockout
// del tenant). La query gira sotto RLS quindi è già ristretta al tenant.
async function otherActiveAdminsCount(tx: TxClient, excludeId: string): Promise<number> {
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
    // #4: esposto per il controllo ottimistico (il client lo rimanda in PATCH).
    updatedAt: a.updatedAt,
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
    // #4: campo versione parsato a parte (updateBody scarta le chiavi sconosciute).
    const { expectedUpdatedAt } = z.object(expectedVersionField).parse(req.body ?? {});

    // Anti self-demotion: l'admin non può togliere a sé stesso il ruolo admin
    if (req.account && req.account.id === id && parsed.data.role && parsed.data.role !== 'admin') {
      return reply.code(403).send({ error: 'non puoi cambiare il tuo stesso ruolo da admin' });
    }
    if (req.account && req.account.id === id && parsed.data.attivo === false) {
      return reply.code(403).send({ error: 'non puoi disattivare il tuo stesso account' });
    }

    const outcome = await req.dbTx(async (tx) => {
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
        .select({ role: accounts.role, commissarioId: accounts.commissarioId, updatedAt: accounts.updatedAt })
        .from(accounts)
        .where(eq(accounts.id, id))
        .limit(1)
        .for('update');
      if (cur.length === 0) return reply.notFound();
      // #4: controllo ottimistico opt-in (sotto il FOR UPDATE → niente TOCTOU).
      if (!versionFresh(cur[0]!.updatedAt, expectedUpdatedAt)) return reply.code(409).send(STALE_VERSION_BODY);
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
        // #4 (TOCTOU): advisory lock transazionale per-tenant → serializza TUTTE
        // le demozioni/disattivazioni/cancellazioni di admin del tenant. Prima il
        // check "ultimo admin" leggeva senza lock: due richieste concorrenti che
        // degradavano gli ultimi due admin potevano passare entrambe (count letto
        // prima di entrambe le scritture) → tenant senza admin. Con il lock la
        // seconda attende il commit della prima e vede il conteggio aggiornato.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('admin_guard:' || ${req.tenant!.id}::text, 0))`);
        const target = await tx.select({ role: accounts.role, attivo: accounts.attivo })
          .from(accounts).where(eq(accounts.id, id)).limit(1).for('update');
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
      // #3: l'invalidazione sessioni NON va più eseguita qui dentro. Gira su
      // dbSuper (connessione/tx separata) e con autocommit immediato verrebbe
      // persistita PRIMA del commit del PATCH: un rollback del tx lascerebbe le
      // sessioni cancellate ma il cambio ruolo/disattivazione annullato. La
      // rimandiamo a dopo il commit, segnalando se serve.
      const mustInvalidate = parsed.data.attivo === false || parsed.data.role !== undefined;
      return { account: publicAccount(updated), mustInvalidate };
    });
    // L'inner callback ritorna l'oggetto reply solo sui percorsi d'errore
    // (notFound/badRequest/409): in quei casi la reply è già configurata e va
    // restituita così com'è. Il successo ritorna { account, mustInvalidate }.
    if (!outcome || !('account' in outcome)) return outcome;
    // #3: invalidazione STRETTAMENTE post-commit del PATCH. Disattivazione o
    // cambio ruolo deve revocare le sessioni attive; l'errore è atteso e
    // propagato (no fire-and-forget) così la disattivazione non resta "a metà".
    if (outcome.mustInvalidate) {
      try {
        await invalidateAllSessionsForAccount(id);
      } catch (err) {
        req.log.error({ accountId: id, err: (err as Error).message }, 'account.update: invalidazione sessioni fallita dopo commit');
        return reply.internalServerError('account aggiornato ma invalidazione sessioni fallita: riprova');
      }
    }
    return outcome.account;
  });

  app.post('/:id/reset-password', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = resetPwdBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    const passwordHash = await hashPassword(parsed.data.password);
    // #3: l'invalidazione sessioni gira su dbSuper (connessione/tx separata dal
    // dbTx della route → NON arruolabile nella stessa transazione). Va quindi
    // eseguita STRETTAMENTE DOPO il commit del cambio password, non dentro il
    // callback: dentro, la DELETE sessioni (autocommit immediato su dbSuper)
    // verrebbe persistita prima del commit del nuovo hash, e un rollback del tx
    // (es. writeAudit fallisce) lascerebbe le sessioni cancellate ma la password
    // invariata. Post-commit l'ordine è corretto: prima la password è durabile,
    // poi si invalidano le sessioni vecchie. L'errore di invalidazione è atteso
    // e propagato (non fire-and-forget) → la finestra in cui sessioni con la
    // vecchia password sopravvivono a un cambio riuscito resta chiusa.
    const result = await req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(accounts)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(accounts.id, id))
        .returning();
      if (!updated) return { notFound: true as const };
      await writeAudit(tx, req, 'account.reset_password', {
        targetType: 'account',
        targetId: id,
      });
      return { notFound: false as const };
    });
    if (result.notFound) return reply.notFound();
    try {
      await invalidateAllSessionsForAccount(id);
    } catch (err) {
      // La password è già cambiata e committata: NON possiamo annullarla. Se
      // l'invalidazione fallisce restano sessioni con la vecchia password →
      // rispondiamo 500 perché il client (admin) deve sapere che il reset NON è
      // completo e va ritentato (l'invalidazione è idempotente).
      req.log.error({ accountId: id, err: (err as Error).message }, 'reset-password: invalidazione sessioni fallita dopo commit');
      return reply.internalServerError('password cambiata ma invalidazione sessioni fallita: riprova');
    }
    return { ok: true };
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    if (req.account && req.account.id === id) {
      return reply.code(403).send({ error: 'non puoi cancellare il tuo stesso account' });
    }
    return req.dbTx(async (tx) => {
      // L16 + #4 (TOCTOU): stesso advisory lock per-tenant del PATCH → serializza
      // la cancellazione dell'ultimo admin con le altre mutazioni admin.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('admin_guard:' || ${req.tenant!.id}::text, 0))`);
      const target = await tx.select({ role: accounts.role, attivo: accounts.attivo })
        .from(accounts).where(eq(accounts.id, id)).limit(1).for('update');
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
