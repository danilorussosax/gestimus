import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, commissari, commissioni, concorsi, fasi, iscrizioni, sezioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { checkConcorsiLimit } from '../lib/plan-limits.js';
import { expectedVersionField, versionFresh, STALE_VERSION_BODY } from '../lib/optimistic.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();
const createBody = z.object({
  nome: z.string().min(1).max(255),
  anno: z.number().int().min(1900).max(2200),
  dataInizio: z.string().date().optional(),
  stato: z.enum(['ATTIVO', 'CONCLUSO']).optional(),
  logo: z.string().optional(),
  anonimo: z.boolean().optional(),
  iscrizioniAperte: z.boolean().optional(),
  iscrizioniScadenza: z.string().date().optional(),
  // Cascata tiebreak di default del concorso (array [{key,enabled}]) — nullable
  // per poterla azzerare. jsonb passthrough.
  defaultTiebreakStrategy: z
    .array(z.object({ key: z.string(), enabled: z.boolean() }))
    .nullable()
    .optional(),
});
const updateBody = createBody.partial();

export const concorsiRoutes: FastifyPluginAsync = async (app) => {
  // GET pubblico-ish ma richiede comunque sessione (admin/commissario)
  app.get('/concorsi', { preHandler: [requireAuth] }, async (req) => {
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => tx.select().from(concorsi).limit(limit).offset(offset));
  });

  app.get('/concorsi/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(concorsi).where(eq(concorsi.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  // Conteggi sintetici del concorso per badge/header del workspace admin: query
  // aggregate dedicate invece di scaricare 5 liste intere lato client. Le count
  // girano nella stessa transazione (RLS per-tenant) sequenzialmente — il pool
  // pg espone UNA connessione per tx, quindi niente query concorrenti.
  app.get('/concorsi/:id/summary', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      // Esistenza + isolamento tenant (RLS): concorso assente/altrui → 404.
      const [exists] = await tx.select({ id: concorsi.id }).from(concorsi).where(eq(concorsi.id, id)).limit(1);
      if (!exists) return reply.notFound();
      const n = sql<number>`count(*)::int`;
      const [cand]  = await tx.select({ n }).from(candidati).where(eq(candidati.concorsoId, id));
      const [comm]  = await tx.select({ n }).from(commissari).where(eq(commissari.concorsoId, id));
      const [commi] = await tx.select({ n }).from(commissioni).where(eq(commissioni.concorsoId, id));
      const [fas]   = await tx.select({ n }).from(fasi).where(eq(fasi.concorsoId, id));
      const [sez]   = await tx.select({ n }).from(sezioni).where(eq(sezioni.concorsoId, id));
      return {
        concorsoId: id,
        candidati:   cand?.n ?? 0,
        commissari:  comm?.n ?? 0,
        commissioni: commi?.n ?? 0,
        fasi:        fas?.n ?? 0,
        sezioni:     sez?.n ?? 0,
      };
    });
  });

  app.post(
    '/concorsi',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, req, parsed.error);
      return req.dbTx(async (tx) => {
        // N57: enforce limite di piano sul numero di concorsi.
        const limitErr = await checkConcorsiLimit(tx, req.tenant!.id);
        if (limitErr) return reply.code(403).send({ error: limitErr });
        const [created] = await tx
          .insert(concorsi)
          .values({ tenantId: req.tenant!.id, ...parsed.data })
          .returning();
        await writeAudit(tx, req, 'concorso.create', {
          targetType: 'concorso',
          targetId: created!.id,
          payload: { nome: created!.nome, anno: created!.anno },
        });
        return reply.code(201).send(created);
      });
    },
  );

  app.patch(
    '/concorsi/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const parsed = updateBody.extend(expectedVersionField).safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, req, parsed.error);
      const { expectedUpdatedAt, ...patch } = parsed.data;
      return req.dbTx(async (tx) => {
        // #4: controllo ottimistico opt-in sotto lock (evita la TOCTOU sul check).
        if (expectedUpdatedAt !== undefined) {
          const [cur] = await tx.select({ updatedAt: concorsi.updatedAt }).from(concorsi).where(eq(concorsi.id, id)).limit(1).for('update');
          if (!cur) return reply.notFound();
          if (!versionFresh(cur.updatedAt, expectedUpdatedAt)) return reply.code(409).send(STALE_VERSION_BODY);
        }
        const [updated] = await tx
          .update(concorsi)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(concorsi.id, id))
          .returning();
        if (!updated) return reply.notFound();
        await writeAudit(tx, req, 'concorso.update', {
          targetType: 'concorso',
          targetId: id,
          payload: patch,
        });
        return updated;
      });
    },
  );

  app.delete(
    '/concorsi/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const force = z.object({ force: z.coerce.boolean().optional() }).parse(req.query).force === true;
      return req.dbTx(async (tx) => {
        // M193: il DELETE concorso fa CASCADE su TUTTI i dati collegati
        // (candidati, iscrizioni, fasi, valutazioni, …). Senza ?force=true
        // rifiutiamo la cancellazione di un concorso con dati reali → niente
        // perdita accidentale; il client la ripete con force dopo conferma.
        if (!force) {
          const [cand] = await tx.select({ n: sql<number>`count(*)::int` }).from(candidati).where(eq(candidati.concorsoId, id));
          const [isc] = await tx.select({ n: sql<number>`count(*)::int` }).from(iscrizioni).where(eq(iscrizioni.concorsoId, id));
          if ((cand?.n ?? 0) > 0 || (isc?.n ?? 0) > 0) {
            return reply.code(409).send({
              error: 'concorso con dati collegati: ripeti con ?force=true per eliminare tutto',
              candidati: cand?.n ?? 0,
              iscrizioni: isc?.n ?? 0,
            });
          }
        }
        const [deleted] = await tx.delete(concorsi).where(eq(concorsi.id, id)).returning();
        if (!deleted) return reply.notFound();
        await writeAudit(tx, req, 'concorso.delete', {
          targetType: 'concorso',
          targetId: id,
          payload: { nome: deleted.nome, anno: deleted.anno },
        });
        return reply.code(204).send();
      });
    },
  );
};
