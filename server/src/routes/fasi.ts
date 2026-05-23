import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, candidatiFase, commissioni, concorsi, fasi, fasiSezioni, sezioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { faseChannel } from '../realtime/hub.js';
import { parsePagination } from '../lib/pagination.js';

// Permission per start/conclude/sorteggio/timer di una fase:
//   - admin/superadmin sempre OK
//   - commissario OK SE è presidente della commissione assegnata alla fase
// Esegue le SELECT nella stessa transazione del caller con SELECT … FOR UPDATE
// sulla riga `fasi` per evitare TOCTOU (assegnazione commissione cambiata tra
// check e write).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanManageFase(tx: any, req: FastifyRequest, reply: FastifyReply, faseId: string): Promise<boolean> {
  const role = req.account?.role;
  if (role === 'admin' || role === 'superadmin') return true;
  if (role !== 'commissario') {
    reply.code(403).send({ error: 'ruolo richiesto: admin o presidente della commissione' });
    return false;
  }
  const commissarioId = req.account?.commissarioId;
  if (!commissarioId) {
    reply.code(403).send({ error: 'commissario senza profilo' });
    return false;
  }
  const rows = await tx
    .select({ commissioneId: fasi.commissioneId })
    .from(fasi)
    .where(eq(fasi.id, faseId))
    .for('update')
    .limit(1);
  if (rows.length === 0) {
    reply.notFound();
    return false;
  }
  const commissioneId = rows[0]!.commissioneId;
  if (!commissioneId) {
    reply.code(403).send({ error: 'fase senza commissione assegnata: gestione admin-only' });
    return false;
  }
  // N107: FOR UPDATE sulla riga commissione → un admin concorrente non può
  // cambiare il presidente tra questo check e l'UPDATE di start/conclude/timer
  // (questo assert gira nella stessa tx del caller).
  const comRows = await tx
    .select({ presidenteId: commissioni.presidenteCommissarioId })
    .from(commissioni)
    .where(eq(commissioni.id, commissioneId))
    .limit(1)
    .for('update');
  if (comRows.length === 0 || comRows[0]!.presidenteId !== commissarioId) {
    reply.code(403).send({ error: 'solo il presidente della commissione può gestire questa fase' });
    return false;
  }
  return true;
}

// Estrae le sezioni_ids per un array di fasi via singola query batched.
// Restituisce una mappa { faseId → [sezioneId, ...] }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFaseSezioniMap(tx: any, faseIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (faseIds.length === 0) return map;
  const rows = await tx
    .select({ faseId: fasiSezioni.faseId, sezioneId: fasiSezioni.sezioneId })
    .from(fasiSezioni)
    .where(inArray(fasiSezioni.faseId, faseIds));
  for (const r of rows as Array<{ faseId: string; sezioneId: string }>) {
    const arr = map.get(r.faseId) ?? [];
    arr.push(r.sezioneId);
    map.set(r.faseId, arr);
  }
  return map;
}

// N51: tutte le sezioni indicate devono appartenere al concorso della fase.
// La FK garantisce solo l'esistenza, non la coerenza di concorso. Ritorna true
// se ok. La query gira sotto RLS (solo sezioni del tenant visibili).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sezioniAllInConcorso(tx: any, sezioniIds: string[], concorsoId: string): Promise<boolean> {
  if (!sezioniIds || sezioniIds.length === 0) return true;
  const rows = await tx
    .select({ id: sezioni.id })
    .from(sezioni)
    .where(and(inArray(sezioni.id, sezioniIds), eq(sezioni.concorsoId, concorsoId)));
  return rows.length === sezioniIds.length;
}

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
      // N185: 'deviazione_std' (NON 'deviazione_standard') per combaciare con le
      // chiavi METODI_MEDIA / computeAggregate del frontend; con il valore
      // sbagliato getMetodoMedia non lo trovava e ripiegava su media aritmetica.
      z.enum(['aritmetica', 'olimpica', 'winsorizzata', 'mediana', 'deviazione_std']).nullable(),
    )
    .optional(),
  tempoMinuti: z.preprocess(emptyToNull, z.number().int().nonnegative().nullable()).optional(),
  commissioneId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  tiebreakStrategy: z
    .array(z.object({ key: z.string().min(1).max(50), enabled: z.boolean() }))
    .nullable()
    .optional(),
  testoEsitoPromosso: z.preprocess(emptyToNull, z.string().max(80).nullable()).optional(),
  testoEsitoEliminato: z.preprocess(emptyToNull, z.string().max(80).nullable()).optional(),
  // Ambito sezione della fase: array di sezioniId che restringono la fase a
  // determinate sezioni. Se omesso o array vuoto, la fase è "globale" sul
  // concorso. Lo sync della join table fasi_sezioni avviene nel POST/PATCH.
  sezioniIds: z.array(uuid).optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const fasiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(fasi).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(fasi.concorsoId, q.concorsoId)) : base;
      const rows = await filtered.limit(limit).offset(offset);
      const sezMap = await loadFaseSezioniMap(tx, rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, sezioniIds: sezMap.get(r.id) ?? [] }));
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(fasi).where(eq(fasi.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      const sezMap = await loadFaseSezioniMap(tx, [id]);
      return { ...rows[0]!, sezioniIds: sezMap.get(id) ?? [] };
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      try {
        const { sezioniIds, ...faseFields } = parsed.data;
        // N103: stesso lock del reorder sulla riga del concorso → create e
        // reorder si serializzano e non collidono sull'ordine.
        await tx
          .select({ id: concorsi.id })
          .from(concorsi)
          .where(eq(concorsi.id, faseFields.concorsoId))
          .limit(1)
          .for('update');
        // N51: le sezioni devono essere dello stesso concorso della fase.
        if (!(await sezioniAllInConcorso(tx, sezioniIds ?? [], faseFields.concorsoId))) {
          return reply.badRequest('una o più sezioni non appartengono al concorso della fase');
        }
        const [created] = await tx
          .insert(fasi)
          .values({ tenantId: req.tenant!.id, ...faseFields })
          .returning();
        // Sync join table fasi_sezioni (insert iniziale, no detach necessario)
        if (sezioniIds && sezioniIds.length > 0) {
          await tx.insert(fasiSezioni).values(
            sezioniIds.map((sid) => ({ faseId: created!.id, sezioneId: sid, tenantId: req.tenant!.id })),
          );
        }
        await writeAudit(tx, req, 'fase.create', {
          targetType: 'fase',
          targetId: created!.id,
          payload: { ordine: created!.ordine, nome: created!.nome },
        });
        return reply.code(201).send({ ...created, sezioniIds: sezioniIds ?? [] });
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if ((e.code ?? e.cause?.code) === '23505') return reply.conflict('ordine già usato nel concorso');
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
      // N103: lock sulla riga del concorso → serializza reorder e create fasi.
      // Il solo FOR UPDATE sulle righe `fasi` non basta: su concorso vuoto non
      // blocca nulla e non blocca comunque l'INSERT concorrente di una nuova
      // fase. Il lock sul concorso, condiviso con il create, chiude il buco.
      await tx
        .select({ id: concorsi.id })
        .from(concorsi)
        .where(eq(concorsi.id, body.data.concorsoId))
        .limit(1)
        .for('update');
      // N20: lock pessimistico sulle fasi del concorso per serializzare reorder
      // concorrenti (due richieste non si sovrascrivono a metà).
      const found = await tx
        .select({ id: fasi.id })
        .from(fasi)
        .where(eq(fasi.concorsoId, body.data.concorsoId))
        .for('update');
      const allowed = new Set(found.map((r) => r.id));
      for (const id of body.data.ids) {
        if (!allowed.has(id)) {
          return reply.badRequest(`fase ${id} non appartiene al concorso`);
        }
      }
      // N11: l'array `ids` deve contenere TUTTE le fasi del concorso. Se ne
      // omette qualcuna, il suo `ordine` resta invariato e collide con i nuovi
      // valori 1..N → violazione di uniq_fasi_concorso_ordine.
      if (body.data.ids.length !== found.length) {
        return reply.badRequest(
          `reorder deve includere tutte le ${found.length} fasi del concorso (ricevute ${body.data.ids.length})`,
        );
      }
      // Difesa contro duplicati nell'array.
      if (new Set(body.data.ids).size !== body.data.ids.length) {
        return reply.badRequest('ids duplicati nel reorder');
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
      const { sezioniIds, ...faseFields } = parsed.data;
      // Aggiorna i campi base solo se ne è stato passato almeno uno (oltre a sezioniIds)
      let updated;
      if (Object.keys(faseFields).length > 0) {
        const [u] = await tx
          .update(fasi)
          .set({ ...faseFields, updatedAt: new Date() })
          .where(eq(fasi.id, id))
          .returning();
        updated = u;
      } else {
        const rows = await tx.select().from(fasi).where(eq(fasi.id, id)).limit(1);
        updated = rows[0];
      }
      if (!updated) return reply.notFound();
      // Sync della join table solo se sezioniIds è stato esplicitamente inviato
      // (undefined = "non modificare", array vuoto = "rimuovi tutte le sezioni").
      if (sezioniIds !== undefined) {
        // N51: le sezioni devono appartenere al concorso della fase.
        if (!(await sezioniAllInConcorso(tx, sezioniIds, updated.concorsoId))) {
          return reply.badRequest('una o più sezioni non appartengono al concorso della fase');
        }
        await tx.delete(fasiSezioni).where(eq(fasiSezioni.faseId, id));
        if (sezioniIds.length > 0) {
          await tx.insert(fasiSezioni).values(
            sezioniIds.map((sid) => ({ faseId: id, sezioneId: sid, tenantId: req.tenant!.id })),
          );
        }
      }
      await writeAudit(tx, req, 'fase.update', {
        targetType: 'fase',
        targetId: id,
        payload: parsed.data,
      });
      const finalSezMap = await loadFaseSezioniMap(tx, [id]);
      return { ...updated, sezioniIds: finalSezMap.get(id) ?? [] };
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

  app.post('/:id/start', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
      // N21: valida la transizione di stato. start ammesso solo da PIANIFICATA.
      const cur = await tx.select({ stato: fasi.stato }).from(fasi).where(eq(fasi.id, id)).limit(1);
      if (cur.length === 0) return reply.notFound();
      if (cur[0]!.stato !== 'PIANIFICATA') {
        return reply.code(409).send({ error: `fase in stato ${cur[0]!.stato}: avviabile solo da PIANIFICATA` });
      }
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

      // Auto-popola candidati_fase se la fase è ancora vuota.
      // - se la fase ha sezioni associate, prende i candidati del concorso
      //   filtrati per quelle sezioni; altrimenti tutti i candidati del concorso.
      // L'INSERT è idempotente sia rispetto a chiamate ripetute (uniq_candidati_fase
      // su (fase_id, candidato_id) + ON CONFLICT DO NOTHING) sia rispetto a chiamate
      // concorrenti che potrebbero entrambe trovare existing.length === 0.
      const existing = await tx
        .select({ id: candidatiFase.id })
        .from(candidatiFase)
        .where(eq(candidatiFase.faseId, id));
      if (existing.length === 0) {
        // N109: blocca le associazioni sezione della fase per la durata della tx
        // così una PATCH concorrente delle sezioni non fa popolare candidati
        // incoerenti (il lock sulla riga `fasi` non copre fasi_sezioni).
        await tx
          .select({ faseId: fasiSezioni.faseId })
          .from(fasiSezioni)
          .where(eq(fasiSezioni.faseId, id))
          .for('update');
        const sezMap = await loadFaseSezioniMap(tx, [id]);
        const sezIds = sezMap.get(id) ?? [];
        const candRows = sezIds.length > 0
          ? await tx
              .select({ id: candidati.id })
              .from(candidati)
              .where(and(eq(candidati.concorsoId, updated.concorsoId), inArray(candidati.sezioneId, sezIds)))
          : await tx
              .select({ id: candidati.id })
              .from(candidati)
              .where(eq(candidati.concorsoId, updated.concorsoId));
        if (candRows.length > 0) {
          await tx
            .insert(candidatiFase)
            .values(
              candRows.map((c, i) => ({
                tenantId: req.tenant!.id,
                faseId: id,
                candidatoId: c.id,
                posizione: i + 1,
              })),
            )
            .onConflictDoNothing({ target: [candidatiFase.faseId, candidatiFase.candidatoId] });
        }
      }

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
      // Restituiamo la fase arricchita con sezioniIds: senza questo, il client
      // mapFase legge sezioniIds=undefined → sezioni_ids=[] e la fase appare
      // come "globale" finché non viene fatto un refresh hard (cache state).
      const sezMap = await loadFaseSezioniMap(tx, [id]);
      return { ...updated, sezioniIds: sezMap.get(id) ?? [] };
    });
  });

  app.post('/:id/conclude', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
      // N21: conclude ammesso solo da IN_CORSO (non da PIANIFICATA/CONCLUSA).
      const cur = await tx.select({ stato: fasi.stato }).from(fasi).where(eq(fasi.id, id)).limit(1);
      if (cur.length === 0) return reply.notFound();
      if (cur[0]!.stato !== 'IN_CORSO') {
        return reply.code(409).send({ error: `fase in stato ${cur[0]!.stato}: concludibile solo da IN_CORSO` });
      }
      // N30: la conclusione resetta i campi timer (restavano stali → la UI
      // poteva mostrare un countdown attivo su una fase chiusa).
      const [updated] = await tx
        .update(fasi)
        .set({
          stato: 'CONCLUSA',
          timerStartedAt: null,
          timerPausedAt: null,
          timerBonusSeconds: 0,
          timerStartedForCfId: null,
          updatedAt: new Date(),
        })
        .where(eq(fasi.id, id))
        .returning();
      if (!updated) return reply.notFound();
      // Finalizza i candidati_fase della fase: tutti quelli non ELIMINATI
      // passano a COMPLETATO. Senza questo update la view risultati legge
      // `cf.stato !== 'COMPLETATO'` e mostra "in attesa" per sempre, anche
      // dopo che la fase è chiusa e ammesso_prossima_fase è stato deciso.
      await tx
        .update(candidatiFase)
        .set({
          stato: 'COMPLETATO',
          // N43: un candidato COMPLETATO deve avere un esito esplicito. Se
          // ammesso_prossima_fase non è stato deciso, default false ("non
          // promosso") → niente NULL su COMPLETATO (rispetta il CHECK).
          ammessoProssimaFase: sql`COALESCE(${candidatiFase.ammessoProssimaFase}, false)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(candidatiFase.faseId, id),
            sql`${candidatiFase.stato} <> 'ELIMINATO'`,
          ),
        );
      await writeAudit(tx, req, 'fase.conclude', {
        targetType: 'fase',
        targetId: id,
      });
      const payload = JSON.stringify({ action: 'conclude', faseId: id });
      await tx.execute(sql`SELECT pg_notify(${faseChannel(id)}, ${payload})`);
      // Include sezioniIds nel response (vedi commento in /start): senza,
      // il client perde lo scope di sezione della fase dopo il concludi.
      const sezMap = await loadFaseSezioniMap(tx, [id]);
      return { ...updated, sezioniIds: sezMap.get(id) ?? [] };
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
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const body = z.object({ candidatoFaseId: uuid.optional() }).safeParse(req.body ?? {});
      if (!body.success) return reply.badRequest(body.error.message);
      return req.dbTx(async (tx) => {
        if (!await assertCanManageFase(tx, req, reply, id)) return;
        // N87: il candidatoFaseId, se fornito, deve appartenere a QUESTA fase.
        // L'UUID era validato sintatticamente ma non per appartenenza → un
        // presidente poteva scrivere in timerStartedForCfId un id arbitrario
        // (di un'altra fase/tenant sotto RLS), corrompendo i metadati del timer.
        if (body.data.candidatoFaseId) {
          const cf = await tx
            .select({ id: candidatiFase.id })
            .from(candidatiFase)
            .where(and(eq(candidatiFase.id, body.data.candidatoFaseId), eq(candidatiFase.faseId, id)))
            .limit(1);
          if (cf.length === 0) {
            return reply.code(400).send({ error: 'candidatoFaseId non appartiene a questa fase' });
          }
        }
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

  app.post('/:id/timer/pause', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
      // N141: non ri-mettere in pausa un timer già in pausa (o mai avviato):
      // sovrascrivere timerPausedAt falserebbe il calcolo della durata pausa al
      // resume, spostando timerStartedAt. FOR UPDATE per serializzare pause
      // concorrenti.
      const cur = await tx
        .select({ timerStartedAt: fasi.timerStartedAt, timerPausedAt: fasi.timerPausedAt })
        .from(fasi)
        .where(eq(fasi.id, id))
        .limit(1)
        .for('update');
      if (cur.length === 0) return reply.notFound();
      if (!cur[0]!.timerStartedAt) return reply.code(409).send({ error: 'timer non avviato' });
      if (cur[0]!.timerPausedAt) return reply.code(409).send({ error: 'timer già in pausa' });
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

  app.post('/:id/timer/resume', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
      // Calcola lo shift della startedAt in base alla durata della pausa.
      // L221: FOR UPDATE come in /pause (N141) → resume concorrenti serializzati.
      const rows = await tx.select().from(fasi).where(eq(fasi.id, id)).limit(1).for('update');
      if (rows.length === 0) return reply.notFound();
      const fase = rows[0]!;
      if (!fase.timerPausedAt || !fase.timerStartedAt) {
        return reply.code(409).send({ error: 'timer non in pausa' });
      }
      // L178: clamp a 0 — un salto NTP all'indietro darebbe pauseDuration
      // negativo, spostando timerStartedAt indietro (timer che "guadagna" tempo).
      const pauseDuration = Math.max(0, Date.now() - fase.timerPausedAt.getTime());
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

  app.post('/:id/timer/reset', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
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

  app.post('/:id/sorteggio', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    // M158: seed limitato a int32 non negativo — un valore estremo passerebbe a
    // shuffleSeeded producendo aritmetica fuori range / comportamento anomalo.
    const body = z.object({ seed: z.number().int().min(0).max(2_147_483_647) }).safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
      // N23: il sorteggio non ha senso su una fase conclusa (riordinare una
      // classifica chiusa). Ammesso su PIANIFICATA/IN_CORSO.
      const cur = await tx.select({ stato: fasi.stato }).from(fasi).where(eq(fasi.id, id)).limit(1);
      if (cur.length === 0) return reply.notFound();
      if (cur[0]!.stato === 'CONCLUSA') {
        return reply.code(409).send({ error: 'fase CONCLUSA: sorteggio non consentito' });
      }
      const rows = await tx
        .select({ id: candidatiFase.id })
        .from(candidatiFase)
        .where(eq(candidatiFase.faseId, id));
      if (rows.length === 0) return reply.code(409).send({ error: 'nessun candidato in questa fase' });

      const shuffled = shuffleSeeded(
        rows.map((r) => r.id),
        body.data.seed,
      );

      // Bulk UPDATE: una sola query con UNNEST invece di N UPDATE sequenziali.
      // Per 100+ candidati questo è ~30x più veloce sul DB.
      const ids = shuffled;
      const positions = shuffled.map((_, i) => i + 1);
      await tx.execute(sql`
        UPDATE candidati_fase AS cf
        SET posizione = data.pos, updated_at = NOW()
        FROM (
          SELECT unnest(${ids}::uuid[]) AS id, unnest(${positions}::int[]) AS pos
        ) AS data
        WHERE cf.id = data.id
      `);

      await writeAudit(tx, req, 'fase.sorteggio', {
        targetType: 'fase',
        targetId: id,
        payload: { seed: body.data.seed, count: shuffled.length },
      });
      return { ok: true, count: shuffled.length, seed: body.data.seed };
    });
  });

  app.post('/:id/timer/bonus', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    // H1: bonus seconds must be non-negative. Reset si fa via /timer/reset, non
    // con un bonus negativo (che renderebbe l'aggregato fortemente sottozero).
    const body = z.object({ seconds: z.number().int().min(0).max(3600) }).safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    return req.dbTx(async (tx) => {
      if (!await assertCanManageFase(tx, req, reply, id)) return;
      // N22: il bonus ha senso solo su un timer avviato. Su fase mai avviata
      // (timerStartedAt null) accumulare bonus è privo di significato.
      const cur = await tx
        .select({ startedAt: fasi.timerStartedAt })
        .from(fasi)
        .where(eq(fasi.id, id))
        .limit(1);
      if (cur.length === 0) return reply.notFound();
      if (cur[0]!.startedAt == null) {
        return reply.code(409).send({ error: 'timer non avviato: bonus non applicabile' });
      }
      const [updated] = await tx
        .update(fasi)
        .set({
          // M147: tetto cumulativo (24h) sul bonus → niente accumulo illimitato
          // che potrebbe far overfloware l'INTEGER (~2.1B) dopo molte richieste.
          timerBonusSeconds: sql`LEAST(${fasi.timerBonusSeconds} + ${body.data.seconds}, 86400)`,
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
