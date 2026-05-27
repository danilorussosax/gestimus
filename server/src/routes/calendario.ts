import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  calendarioPubblicazioni,
  candidati,
  candidatiFase,
  categorie,
  concorsi,
  eventiCalendario,
  fasi,
  fasiSezioni,
  sale,
  sezioni,
} from '../db/schema.js';
import type { TxClient } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { generateToken } from '../lib/token.js';
import { MAX_LIMIT } from '../lib/pagination.js';
import { replyValidationError } from '../lib/validation.js';

// #6: queste liste (sale/eventi/pubblicazioni) sono naturalmente limitate per
// concorso e non hanno UI di paginazione → restano senza limit/offset. Aggiungiamo
// però un cap difensivo a MAX_LIMIT per non rischiare un result set illimitato
// (DoS/OOM) se i dati crescessero oltre l'atteso. Non tronca dati realistici.

const uuid = z.string().uuid();
const emptyToNull = <T>(v: T) => (v === '' ? null : v);
// time HH:MM o HH:MM:SS
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

// ---------------------------------------------------------------------------
// Slot recompute: unico punto di calcolo degli orari individuali.
//   ora_prevista = ora_inizio + indice · durata_candidato_minuti
// Match dei candidati: candidati_fase della fase del blocco, filtrati per
// sezione/categoria del blocco (se valorizzate), ordinati per posizione.
// ---------------------------------------------------------------------------
function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}
function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Garantisce che esistano righe candidati_fase per la fase del blocco, così i
 * candidati assegnati (sezione/categoria) compaiano nel calendario anche PRIMA
 * dell'avvio fase. Idempotente: popola solo se la fase non ha ancora righe.
 * Mirror di fasi.ts POST /:id/start (auto-popola): se la fase ha sezioni
 * associate prende i candidati del concorso filtrati per quelle sezioni,
 * altrimenti tutti i candidati del concorso della fase.
 */
async function ensureCandidatiFasePopulati(tx: TxClient, tenantId: string, faseId: string): Promise<void> {
  const existing = await tx
    .select({ id: candidatiFase.id })
    .from(candidatiFase)
    .where(eq(candidatiFase.faseId, faseId))
    .limit(1);
  if (existing.length > 0) return;
  const [fase] = await tx.select({ concorsoId: fasi.concorsoId }).from(fasi).where(eq(fasi.id, faseId)).limit(1);
  if (!fase) return;
  // N109: blocca le associazioni sezione della fase per la durata della tx così
  // un PATCH concorrente delle sezioni non fa popolare candidati incoerenti.
  await tx.select({ faseId: fasiSezioni.faseId }).from(fasiSezioni).where(eq(fasiSezioni.faseId, faseId)).for('update');
  const sezRows = await tx.select({ sezioneId: fasiSezioni.sezioneId }).from(fasiSezioni).where(eq(fasiSezioni.faseId, faseId));
  const sezIds = sezRows.map((r) => r.sezioneId);
  const candRows = sezIds.length > 0
    ? await tx
        .select({ id: candidati.id })
        .from(candidati)
        .where(and(eq(candidati.concorsoId, fase.concorsoId), inArray(candidati.sezioneId, sezIds)))
    : await tx
        .select({ id: candidati.id })
        .from(candidati)
        .where(eq(candidati.concorsoId, fase.concorsoId));
  if (candRows.length === 0) return;
  // L'INSERT è idempotente (uniq su (fase_id, candidato_id) + ON CONFLICT DO
  // NOTHING) rispetto a chiamate concorrenti che trovino entrambe existing vuoto.
  await tx
    .insert(candidatiFase)
    .values(candRows.map((c, i) => ({ tenantId, faseId, candidatoId: c.id, posizione: i + 1 })))
    .onConflictDoNothing({ target: [candidatiFase.faseId, candidatiFase.candidatoId] });
}

/** Restituisce i candidati_fase del blocco, nell'ordine di esibizione. */
async function matchedSlots(tx: TxClient, evento: typeof eventiCalendario.$inferSelect) {
  if (!evento.faseId) return [];
  const conds = [eq(candidatiFase.faseId, evento.faseId)];
  if (evento.sezioneId) conds.push(eq(candidati.sezioneId, evento.sezioneId));
  if (evento.categoriaId) conds.push(eq(candidati.categoriaId, evento.categoriaId));
  return tx
    .select({ id: candidatiFase.id, posizione: candidatiFase.posizione, numero: candidati.numeroCandidato })
    .from(candidatiFase)
    .innerJoin(candidati, eq(candidati.id, candidatiFase.candidatoId))
    .where(and(...conds))
    .orderBy(asc(candidatiFase.posizione), asc(candidati.numeroCandidato));
}

async function recomputeSlots(tx: TxClient, tenantId: string, eventoId: string): Promise<void> {
  const [evento] = await tx.select().from(eventiCalendario).where(eq(eventiCalendario.id, eventoId)).limit(1);
  if (!evento) return;
  // Sgancia eventuali slot precedenti del blocco (es. dopo cambio sezione/categoria).
  await tx
    .update(candidatiFase)
    .set({ eventoId: null, oraPrevista: null, updatedAt: new Date() })
    .where(eq(candidatiFase.eventoId, eventoId));
  if (evento.tipo !== 'ESIBIZIONE' || !evento.faseId) return;
  // Popola candidati_fase se la fase è ancora vuota: i candidati assegnati
  // devono comparire nel blocco anche prima dell'avvio fase.
  await ensureCandidatiFasePopulati(tx, tenantId, evento.faseId);
  const slots = await matchedSlots(tx, evento);
  const startMin = evento.oraInizio ? parseTimeToMinutes(evento.oraInizio) : null;
  const durata = evento.durataCandidatoMinuti ?? 0;
  for (let i = 0; i < slots.length; i++) {
    const ora = startMin != null ? minutesToTime(startMin + i * durata) : null;
    await tx
      .update(candidatiFase)
      .set({ eventoId, oraPrevista: ora, updatedAt: new Date() })
      .where(eq(candidatiFase.id, slots[i]!.id));
  }
}

// ---------------------------------------------------------------------------
// Zod bodies
// ---------------------------------------------------------------------------
const salaCreate = z.object({
  concorsoId: uuid,
  nome: z.string().min(1).max(255),
  indirizzo: z.preprocess(emptyToNull, z.string().max(500).nullable()).optional(),
  ordine: z.number().int().nullable().optional(),
});
const salaUpdate = salaCreate.partial().omit({ concorsoId: true });

const eventoCreate = z.object({
  concorsoId: uuid,
  faseId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  sezioneId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  categoriaId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  salaId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  tipo: z.enum(['ESIBIZIONE', 'EVENTO']).optional(),
  titolo: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  data: z.string().date(),
  oraInizio: z.preprocess(emptyToNull, timeStr.nullable()).optional(),
  oraFine: z.preprocess(emptyToNull, timeStr.nullable()).optional(),
  durataCandidatoMinuti: z.number().int().min(0).max(1440).nullable().optional(),
  note: z.preprocess(emptyToNull, z.string().max(2000).nullable()).optional(),
  ordine: z.number().int().nullable().optional(),
});
const eventoUpdate = eventoCreate.partial().omit({ concorsoId: true });

const pubCreate = z.object({
  concorsoId: uuid,
  scopo: z.enum(['CONCORSO', 'SEZIONE', 'GIORNO']),
  sezioneId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  giorno: z.preprocess(emptyToNull, z.string().date().nullable()).optional(),
  etichetta: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  attivo: z.boolean().optional(),
  mostraNomi: z.boolean().optional(),
  mostraCommissione: z.boolean().optional(),
});
const pubUpdate = pubCreate.partial().omit({ concorsoId: true, scopo: true });

const riordinaBody = z.object({ ordine: z.array(uuid).min(1) });

// Verifica che un id (FK) appartenga al tenant corrente (sotto RLS la SELECT
// ritorna 0 righe se è di un altro tenant) — pattern N105.
async function exists(
  tx: TxClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  idCol: any,
  id: string,
): Promise<boolean> {
  const rows = await tx.select({ id: idCol }).from(table).where(eq(idCol, id)).limit(1);
  return rows.length > 0;
}

export const calendarioRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // =========================== SALE ===========================
  app.get('/sale', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(sale).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(sale.concorsoId, q.concorsoId)) : base;
      return filtered.orderBy(asc(sale.ordine), asc(sale.nome)).limit(MAX_LIMIT);
    });
  });

  app.post('/sale', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = salaCreate.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      if (!(await exists(tx, concorsi, concorsi.id, parsed.data.concorsoId)))
        return reply.badRequest('concorso non trovato');
      const [created] = await tx
        .insert(sale)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'sala.create', { targetType: 'sala', targetId: created!.id, payload: { nome: created!.nome } });
      return reply.code(201).send(created);
    });
  });

  app.patch('/sale/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = salaUpdate.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(sale)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(sale.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'sala.update', { targetType: 'sala', targetId: id, payload: parsed.data });
      return updated;
    });
  });

  app.delete('/sale/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(sale).where(eq(sale.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'sala.delete', { targetType: 'sala', targetId: id, payload: { nome: deleted.nome } });
      return reply.code(204).send();
    });
  });

  // =========================== EVENTI ===========================
  app.get('/eventi', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(eventiCalendario).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(eventiCalendario.concorsoId, q.concorsoId)) : base;
      return filtered.orderBy(asc(eventiCalendario.data), asc(eventiCalendario.oraInizio), asc(eventiCalendario.ordine)).limit(MAX_LIMIT);
    });
  });

  // Valida i FK opzionali dell'evento contro il tenant corrente (N105). I
  // controlli di coerenza tenant sono ridondati dal trigger DB, ma qui diamo
  // un 400 esplicito invece di un errore di constraint.
  async function checkEventoRefs(
    tx: TxClient,
    reply: FastifyReply,
    d: Partial<z.infer<typeof eventoCreate>>,
  ): Promise<boolean> {
    if (d.faseId && !(await exists(tx, fasi, fasi.id, d.faseId))) { reply.badRequest('fase non trovata'); return false; }
    if (d.sezioneId && !(await exists(tx, sezioni, sezioni.id, d.sezioneId))) { reply.badRequest('sezione non trovata'); return false; }
    if (d.categoriaId && !(await exists(tx, categorie, categorie.id, d.categoriaId))) { reply.badRequest('categoria non trovata'); return false; }
    if (d.salaId && !(await exists(tx, sale, sale.id, d.salaId))) { reply.badRequest('sala non trovata'); return false; }
    return true;
  }

  app.post('/eventi', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = eventoCreate.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      if (!(await exists(tx, concorsi, concorsi.id, parsed.data.concorsoId)))
        return reply.badRequest('concorso non trovato');
      if (!(await checkEventoRefs(tx, reply, parsed.data))) return reply;
      const [created] = await tx
        .insert(eventiCalendario)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      // Popola subito gli slot: i candidati assegnati alla sezione/categoria del
      // blocco compaiono nel calendario alla creazione, senza attendere l'avvio fase.
      await recomputeSlots(tx, req.tenant!.id, created!.id);
      await writeAudit(tx, req, 'evento.create', { targetType: 'evento', targetId: created!.id, payload: { data: created!.data, tipo: created!.tipo } });
      return reply.code(201).send(created);
    });
  });

  app.patch('/eventi/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = eventoUpdate.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      if (!(await checkEventoRefs(tx, reply, parsed.data))) return reply;
      const [updated] = await tx
        .update(eventiCalendario)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(eventiCalendario.id, id))
        .returning();
      if (!updated) return reply.notFound();
      // Lo spostamento (data/sala/ora/durata/sezione/categoria) cambia gli orari:
      // ricalcola gli slot di conseguenza.
      await recomputeSlots(tx, req.tenant!.id, id);
      await writeAudit(tx, req, 'evento.update', { targetType: 'evento', targetId: id, payload: parsed.data });
      return updated;
    });
  });

  app.delete('/eventi/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(eventiCalendario).where(eq(eventiCalendario.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'evento.delete', { targetType: 'evento', targetId: id });
      return reply.code(204).send();
    });
  });

  // Genera/ricalcola gli orari dei candidati del blocco.
  app.post('/eventi/:id/genera-slot', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [evento] = await tx.select().from(eventiCalendario).where(eq(eventiCalendario.id, id)).limit(1);
      if (!evento) return reply.notFound();
      await recomputeSlots(tx, req.tenant!.id, id);
      await writeAudit(tx, req, 'evento.genera_slot', { targetType: 'evento', targetId: id });
      // Ritorna gli slot aggiornati (cf + numero candidato + orario).
      return tx
        .select({ id: candidatiFase.id, candidatoId: candidatiFase.candidatoId, posizione: candidatiFase.posizione, oraPrevista: candidatiFase.oraPrevista, numeroCandidato: candidati.numeroCandidato })
        .from(candidatiFase)
        .innerJoin(candidati, eq(candidati.id, candidatiFase.candidatoId))
        .where(eq(candidatiFase.eventoId, id))
        .orderBy(asc(candidatiFase.posizione), asc(candidati.numeroCandidato));
    });
  });

  // Riordina gli slot del blocco (drag&drop card-candidato): riscrive posizione
  // secondo l'ordine passato, poi ricalcola gli orari.
  app.post('/eventi/:id/riordina-slot', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = riordinaBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      const [evento] = await tx.select().from(eventiCalendario).where(eq(eventiCalendario.id, id)).limit(1);
      if (!evento) return reply.notFound();
      const matched = await matchedSlots(tx, evento);
      const matchedIds = new Set(matched.map((m) => m.id));
      const given = parsed.data.ordine;
      // L'ordine fornito deve essere una permutazione esatta degli slot del blocco.
      if (given.length !== matchedIds.size || !given.every((x) => matchedIds.has(x)))
        return reply.badRequest('ordine non valido: deve contenere esattamente gli slot del blocco');
      for (let i = 0; i < given.length; i++) {
        await tx
          .update(candidatiFase)
          .set({ posizione: i + 1, updatedAt: new Date() })
          .where(eq(candidatiFase.id, given[i]!));
      }
      await recomputeSlots(tx, req.tenant!.id, id);
      await writeAudit(tx, req, 'evento.riordina_slot', { targetType: 'evento', targetId: id, payload: { n: given.length } });
      return tx
        .select({ id: candidatiFase.id, candidatoId: candidatiFase.candidatoId, posizione: candidatiFase.posizione, oraPrevista: candidatiFase.oraPrevista, numeroCandidato: candidati.numeroCandidato })
        .from(candidatiFase)
        .innerJoin(candidati, eq(candidati.id, candidatiFase.candidatoId))
        .where(eq(candidatiFase.eventoId, id))
        .orderBy(asc(candidatiFase.posizione), asc(candidati.numeroCandidato));
    });
  });

  // =========================== PUBBLICAZIONI ===========================
  app.get('/pubblicazioni', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(calendarioPubblicazioni).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(calendarioPubblicazioni.concorsoId, q.concorsoId)) : base;
      return filtered.orderBy(asc(calendarioPubblicazioni.createdAt)).limit(MAX_LIMIT);
    });
  });

  app.post('/pubblicazioni', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = pubCreate.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    const d = parsed.data;
    if (d.scopo === 'SEZIONE' && !d.sezioneId) return reply.badRequest('scopo SEZIONE richiede sezioneId');
    if (d.scopo === 'GIORNO' && !d.giorno) return reply.badRequest('scopo GIORNO richiede giorno');
    return req.dbTx(async (tx) => {
      if (!(await exists(tx, concorsi, concorsi.id, d.concorsoId))) return reply.badRequest('concorso non trovato');
      if (d.sezioneId && !(await exists(tx, sezioni, sezioni.id, d.sezioneId))) return reply.badRequest('sezione non trovata');
      const [created] = await tx
        .insert(calendarioPubblicazioni)
        .values({ tenantId: req.tenant!.id, token: generateToken(), ...d })
        .returning();
      await writeAudit(tx, req, 'calendario_pub.create', { targetType: 'calendario_pub', targetId: created!.id, payload: { scopo: created!.scopo } });
      return reply.code(201).send(created);
    });
  });

  app.patch('/pubblicazioni/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = pubUpdate.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      if (parsed.data.sezioneId && !(await exists(tx, sezioni, sezioni.id, parsed.data.sezioneId)))
        return reply.badRequest('sezione non trovata');
      const [updated] = await tx
        .update(calendarioPubblicazioni)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(calendarioPubblicazioni.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'calendario_pub.update', { targetType: 'calendario_pub', targetId: id, payload: parsed.data });
      return updated;
    });
  });

  app.delete('/pubblicazioni/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(calendarioPubblicazioni).where(eq(calendarioPubblicazioni.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'calendario_pub.delete', { targetType: 'calendario_pub', targetId: id });
      return reply.code(204).send();
    });
  });
};
