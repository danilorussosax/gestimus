import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { candidatiFase, fasi } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { faseChannel } from '../realtime/hub.js';

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const uuid = z.string().uuid();
// Helper: il frontend tipicamente invia "" per i campi vuoti del form (es.
// commissioneId="" quando "Nessuna commissione" è selezionato). Convertiamo
// "" in null così le zod sotto possono accettare il valore "non impostato"
// uniformemente, sia come undefined sia come null.
const emptyToNull = <T>(v: T) => (v === '' ? null : v);

const createBody = z.object({
  concorsoId: uuid,
  ordine: z.number().int().min(1),
  nome: z.string().min(1).max(255),
  ammessi: z.preprocess(emptyToNull, z.number().int().positive().nullable()).optional(),
  dataPrevista: z.preprocess(emptyToNull, z.string().date().nullable()).optional(),
  scala: z.number().int().min(2).max(1000).optional(),
  modoValutazione: z.preprocess(
    emptyToNull,
    z.enum(['autonoma', 'sincrona']).nullable(),
  ).optional(),
  pesi: z.unknown().optional(),
  metodoMedia: z
    .preprocess(
      emptyToNull,
      z.enum(['aritmetica', 'olimpica', 'winsorizzata', 'mediana', 'deviazione_standard']).nullable(),
    )
    .optional(),
  tempoMinuti: z.preprocess(emptyToNull, z.number().int().nonnegative().nullable()).optional(),
  commissioneId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  tiebreakStrategy: z
    .array(z.object({ key: z.string().min(1).max(50), enabled: z.boolean() }))
    .nullable()
    .optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const fasiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      return q.concorsoId
        ? tx.select().from(fasi).where(eq(fasi.concorsoId, q.concorsoId))
        : tx.select().from(fasi);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(fasi).where(eq(fasi.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      try {
        const [created] = await tx
          .insert(fasi)
          .values({ tenantId: req.tenant!.id, ...parsed.data })
          .returning();
        await writeAudit(tx, req, 'fase.create', {
          targetType: 'fase',
          targetId: created!.id,
          payload: { ordine: created!.ordine, nome: created!.nome },
        });
        return reply.code(201).send(created);
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === '23505') return reply.conflict('ordine già usato nel concorso');
        throw err;
      }
    });
  });

  // --------- Reorder fasi nel concorso (PRIMA della catch-all PATCH /:id) ---------

  app.patch('/reorder', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const body = z
      .object({
        concorsoId: uuid,
        ids: z.array(uuid).min(1),
      })
      .safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    return req.dbTx(async (tx) => {
      const found = await tx
        .select({ id: fasi.id })
        .from(fasi)
        .where(eq(fasi.concorsoId, body.data.concorsoId));
      const allowed = new Set(found.map((r) => r.id));
      for (const id of body.data.ids) {
        if (!allowed.has(id)) {
          return reply.badRequest(`fase ${id} non appartiene al concorso`);
        }
      }
      const offset = 10000;
      for (let i = 0; i < body.data.ids.length; i++) {
        await tx
          .update(fasi)
          .set({ ordine: offset + i, updatedAt: new Date() })
          .where(eq(fasi.id, body.data.ids[i]!));
      }
      for (let i = 0; i < body.data.ids.length; i++) {
        await tx
          .update(fasi)
          .set({ ordine: i + 1, updatedAt: new Date() })
          .where(eq(fasi.id, body.data.ids[i]!));
      }
      await writeAudit(tx, req, 'fase.reorder', {
        targetType: 'concorso',
        targetId: body.data.concorsoId,
        payload: { ids: body.data.ids },
      });
      return { ok: true };
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(fasi)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'fase.update', {
        targetType: 'fase',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(fasi).where(eq(fasi.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'fase.delete', {
        targetType: 'fase',
        targetId: id,
        payload: { ordine: deleted.ordine, nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });

  // --------- Transizioni stato ---------
  // PIANIFICATA → IN_CORSO → CONCLUSA

  app.post('/:id/start', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const startedAt = new Date();
      const [updated] = await tx
        .update(fasi)
        .set({
          stato: 'IN_CORSO',
          timerStartedAt: startedAt,
          updatedAt: startedAt,
        })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'fase.start', {
        targetType: 'fase',
        targetId: id,
      });
      // NOTIFY ai client SSE
      const payload = JSON.stringify({
        action: 'start',
        faseId: id,
        startedAt: startedAt.toISOString(),
        tempoMinuti: updated.tempoMinuti,
      });
      await tx.execute(sql`SELECT pg_notify(${faseChannel(id)}, ${payload})`);
      return updated;
    });
  });

  app.post('/:id/conclude', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(fasi)
        .set({ stato: 'CONCLUSA', updatedAt: new Date() })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'fase.conclude', {
        targetType: 'fase',
        targetId: id,
      });
      const payload = JSON.stringify({ action: 'conclude', faseId: id });
      await tx.execute(sql`SELECT pg_notify(${faseChannel(id)}, ${payload})`);
      return updated;
    });
  });

  // --------- Timer runtime ---------

  app.get('/:id/runtime', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx
        .select({
          stato: fasi.stato,
          tempoMinuti: fasi.tempoMinuti,
          timerStartedAt: fasi.timerStartedAt,
          timerPausedAt: fasi.timerPausedAt,
          timerBonusSeconds: fasi.timerBonusSeconds,
          timerStartedForCfId: fasi.timerStartedForCfId,
        })
        .from(fasi)
        .where(eq(fasi.id, id))
        .limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post(
    '/:id/timer/start',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const body = z.object({ candidatoFaseId: uuid.optional() }).safeParse(req.body ?? {});
      if (!body.success) return reply.badRequest(body.error.message);
      return req.dbTx(async (tx) => {
        const now = new Date();
        const [updated] = await tx
          .update(fasi)
          .set({
            timerStartedAt: now,
            timerPausedAt: null,
            timerBonusSeconds: 0,
            timerStartedForCfId: body.data.candidatoFaseId ?? null,
            updatedAt: now,
          })
          .where(eq(fasi.id, id))
          .returning();
        if (!updated) return reply.notFound();
        await writeAudit(tx, req, 'fase.timer_start', { targetType: 'fase', targetId: id });
        await tx.execute(
          sql`SELECT pg_notify(${faseChannel(id)}, ${JSON.stringify({
            action: 'timer.start',
            faseId: id,
            at: now.toISOString(),
            candidatoFaseId: body.data.candidatoFaseId ?? null,
          })})`,
        );
        return updated;
      });
    },
  );

  app.post('/:id/timer/pause', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(fasi)
        .set({ timerPausedAt: new Date(), updatedAt: new Date() })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'fase.timer_pause', { targetType: 'fase', targetId: id });
      await tx.execute(
        sql`SELECT pg_notify(${faseChannel(id)}, ${JSON.stringify({ action: 'timer.pause', faseId: id })})`,
      );
      return updated;
    });
  });

  app.post('/:id/timer/resume', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      // Calcola lo shift della startedAt in base alla durata della pausa
      const rows = await tx.select().from(fasi).where(eq(fasi.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      const fase = rows[0]!;
      if (!fase.timerPausedAt || !fase.timerStartedAt) {
        return reply.code(409).send({ error: 'timer non in pausa' });
      }
      const pauseDuration = Date.now() - fase.timerPausedAt.getTime();
      const newStartedAt = new Date(fase.timerStartedAt.getTime() + pauseDuration);
      const [updated] = await tx
        .update(fasi)
        .set({ timerStartedAt: newStartedAt, timerPausedAt: null, updatedAt: new Date() })
        .where(eq(fasi.id, id))
        .returning();
      await writeAudit(tx, req, 'fase.timer_resume', { targetType: 'fase', targetId: id });
      await tx.execute(
        sql`SELECT pg_notify(${faseChannel(id)}, ${JSON.stringify({ action: 'timer.resume', faseId: id })})`,
      );
      return updated;
    });
  });

  app.post('/:id/timer/reset', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(fasi)
        .set({
          timerStartedAt: null,
          timerPausedAt: null,
          timerBonusSeconds: 0,
          timerStartedForCfId: null,
          updatedAt: new Date(),
        })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'fase.timer_reset', { targetType: 'fase', targetId: id });
      await tx.execute(
        sql`SELECT pg_notify(${faseChannel(id)}, ${JSON.stringify({ action: 'timer.reset', faseId: id })})`,
      );
      return updated;
    });
  });

  // --------- Sorteggio ordine candidati ---------

  app.post('/:id/sorteggio', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ seed: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    return req.dbTx(async (tx) => {
      const rows = await tx
        .select({ id: candidatiFase.id })
        .from(candidatiFase)
        .where(eq(candidatiFase.faseId, id));
      if (rows.length === 0) return reply.code(409).send({ error: 'nessun candidato in questa fase' });

      const shuffled = shuffleSeeded(
        rows.map((r) => r.id),
        body.data.seed,
      );

      // Aggiorna le posizioni in batch (1..N)
      for (let i = 0; i < shuffled.length; i++) {
        await tx
          .update(candidatiFase)
          .set({ posizione: i + 1, updatedAt: new Date() })
          .where(eq(candidatiFase.id, shuffled[i]!));
      }

      await writeAudit(tx, req, 'fase.sorteggio', {
        targetType: 'fase',
        targetId: id,
        payload: { seed: body.data.seed, count: shuffled.length },
      });
      return { ok: true, count: shuffled.length, seed: body.data.seed };
    });
  });

  app.post('/:id/timer/bonus', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ seconds: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(fasi)
        .set({
          timerBonusSeconds: sql`${fasi.timerBonusSeconds} + ${body.data.seconds}`,
          updatedAt: new Date(),
        })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'fase.timer_bonus', {
        targetType: 'fase',
        targetId: id,
        payload: { seconds: body.data.seconds },
      });
      await tx.execute(
        sql`SELECT pg_notify(${faseChannel(id)}, ${JSON.stringify({
          action: 'timer.bonus',
          faseId: id,
          seconds: body.data.seconds,
        })})`,
      );
      return updated;
    });
  });
};
