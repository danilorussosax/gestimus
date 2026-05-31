import type { FastifyPluginAsync } from 'fastify';
import { eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuid, emptyToNull } from '../lib/zod-helpers.js';
import { parsePagination } from '../lib/pagination.js';
import { checkCandidatiLimit, planExpiredError } from '../lib/plan-limits.js';
import { candidati, candidatiFase, categorie, sezioni, valutazioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { TxClient } from '../middleware/tenant.js';
import { writeAudit } from '../services/audit.js';
import { replyValidationError } from '../lib/validation.js';

// Verifica che sezione e categoria scelte appartengano al concorso del
// candidato (e che la categoria appartenga alla sezione). Senza FK al DB
// queste relazioni potrebbero andare in incoerenza; rifiutiamo qui.
// Ritorna { ok: true } oppure { ok: false, error: '...' }.
async function validateScope(tx: TxClient, concorsoId: string, sezioneId: string | null | undefined, categoriaId: string | null | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  if (sezioneId) {
    const sez = await tx.select({ concorsoId: sezioni.concorsoId }).from(sezioni).where(eq(sezioni.id, sezioneId)).limit(1);
    const sezRow = sez[0];
    if (!sezRow) return { ok: false, error: 'sezione non trovata' };
    if (sezRow.concorsoId !== concorsoId) return { ok: false, error: 'la sezione non appartiene al concorso del candidato' };
  }
  if (categoriaId) {
    const cat = await tx.select({ sezioneId: categorie.sezioneId }).from(categorie).where(eq(categorie.id, categoriaId)).limit(1);
    const catRow = cat[0];
    if (!catRow) return { ok: false, error: 'categoria non trovata' };
    if (sezioneId && catRow.sezioneId !== sezioneId) {
      return { ok: false, error: 'la categoria non appartiene alla sezione scelta' };
    }
    // Caso PATCH solo-categoria senza nuova sezione: verifica che la sezione
    // della categoria appartenga al concorso del candidato.
    if (!sezioneId) {
      const catSez = await tx.select({ concorsoId: sezioni.concorsoId }).from(sezioni).where(eq(sezioni.id, catRow.sezioneId)).limit(1);
      const catSezRow = catSez[0];
      if (!catSezRow || catSezRow.concorsoId !== concorsoId) {
        return { ok: false, error: 'la categoria non appartiene al concorso del candidato' };
      }
    }
  }
  return { ok: true };
}

// Helper: il frontend manda "" o null per i campi vuoti del form (es. la radio
// "Nessuna sezione" del candidato). Trasformiamo "" in null così le zod sotto
// possono accettare il valore "non impostato" uniformemente.
const createBody = z.object({
  concorsoId: uuid,
  // M6: opzionale. Se omesso, il server calcola MAX(numero)+1 nella transazione
  // (con lock sulle righe del concorso) per evitare numeri duplicati su creazioni
  // rapide concorrenti. Il client non deve più calcolarlo.
  numeroCandidato: z.number().int().positive().optional(),
  nome: z.string().min(1).max(255),
  cognome: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  strumento: z.string().min(1).max(255),
  dataNascita: z.preprocess(emptyToNull, z.string().date().nullable()).optional(),
  nazionalita: z.preprocess(emptyToNull, z.string().max(100).nullable()).optional(),
  // Anagrafica/residenza estese (allineamento con iscrizioni)
  email: z.preprocess(emptyToNull, z.string().email().nullable()).optional(),
  telefono: z.preprocess(emptyToNull, z.string().max(50).nullable()).optional(),
  sesso: z.preprocess(emptyToNull, z.string().max(20).nullable()).optional(),
  luogoNascita: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  codiceFiscale: z.preprocess(emptyToNull, z.string().max(32).nullable()).optional(),
  indirizzo: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  citta: z.preprocess(emptyToNull, z.string().max(120).nullable()).optional(),
  cap: z.preprocess(emptyToNull, z.string().max(16).nullable()).optional(),
  provincia: z.preprocess(emptyToNull, z.string().max(64).nullable()).optional(),
  paese: z.preprocess(emptyToNull, z.string().max(100).nullable()).optional(),
  anniStudio: z.number().int().min(0).max(99).nullable().optional(),
  scuolaProvenienza: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  docentiPreparatori: z.array(z.string()).optional(),
  // Programma musicale: schema delimitato (era z.unknown()). Stessa shape del
  // form iscrizione (titolo/autore/durata_min); z.object scarta extra, durata
  // coerced, max 200 brani. Difesa in profondità (admin, ma reso via JSX).
  programma: z
    .array(
      z.object({
        titolo: z.string().max(500),
        autore: z.string().max(300).optional(),
        durata_min: z.coerce.number().min(0).max(600).optional(),
      }),
    )
    .max(200)
    .optional(),
  // Schema strutturato del tutore: STESSA shape di iscrizioni.ts (era
  // z.unknown(), accettava JSON arbitrario). Mantenere allineato così candidati
  // e iscrizioni validano il tutore in modo identico.
  tutore: z
    .object({
      nome: z.string().max(255).optional(),
      cognome: z.string().max(255).optional(),
      email: z.string().email().optional(),
      telefono: z.string().max(50).optional(),
    })
    .optional(),
  noteLibere: z.preprocess(emptyToNull, z.string().max(2000).nullable()).optional(),
  dataIscrizione: z.preprocess(emptyToNull, z.string().date().nullable()).optional(),
  sezioneId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  categoriaId: z.preprocess(emptyToNull, uuid.nullable()).optional(),
  isGruppo: z.boolean().optional(),
  gruppoNome: z.preprocess(emptyToNull, z.string().max(255).nullable()).optional(),
  tipoGruppo: z.preprocess(emptyToNull, z.enum(['ensemble', 'orchestra']).nullable()).optional(),
});
const updateBody = createBody.partial().omit({ concorsoId: true });

export const candidatiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ concorsoId: uuid.optional() }).parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(candidati).$dynamic();
      const filtered = q.concorsoId ? base.where(eq(candidati.concorsoId, q.concorsoId)) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(candidati).where(eq(candidati.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      // #5 TOCTOU: il lock advisory per-concorso DEVE precedere il check del
      // limite di piano, altrimenti due create concorrenti contano entrambe
      // count<limit e sforano il tetto. Lo acquisiamo INCONDIZIONATAMENTE (non
      // più solo quando numeroCandidato è null) così count→insert è serializzato
      // per concorso. È lo STESSO lock di iscrizioni.ts/approve
      // (hashtextextended a 64-bit) → create diretto e approve si serializzano.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${parsed.data.concorsoId}::text, 0))`);
      // Durata piano: scaduto → niente nuove creazioni.
      const expErr = planExpiredError(req.tenant);
      if (expErr) return reply.code(403).send({ error: expErr });
      // N57: enforce limite di piano sul numero di candidati per concorso (sotto
      // il lock → il conteggio non può essere superato da una create concorrente).
      const limitErr = await checkCandidatiLimit(tx, req.tenant!.id, parsed.data.concorsoId);
      if (limitErr) return reply.code(403).send({ error: limitErr });
      const scope = await validateScope(tx, parsed.data.concorsoId, parsed.data.sezioneId, parsed.data.categoriaId);
      if (!scope.ok) return reply.badRequest(scope.error);
      // Gerarchia categoria→sezione: se è stata scelta una categoria ma non
      // una sezione (es. payload generato da import/script esterno), deriviamo
      // la sezione dalla categoria così il record resta coerente.
      const data = { ...parsed.data };
      if (data.categoriaId && !data.sezioneId) {
        const cat = await tx.select({ sezioneId: categorie.sezioneId }).from(categorie).where(eq(categorie.id, data.categoriaId)).limit(1);
        if (cat.length > 0) data.sezioneId = cat[0]!.sezioneId;
      }
      // M6 + N24: numero candidato calcolato server-side se non fornito. Il lock
      // advisory per-concorso è già stato acquisito sopra (#5) — lo STESSO lock di
      // iscrizioni.ts/approve (hashtextextended 64-bit) serializza create diretto e
      // approve sul concorso, evitando duplicati di numeroCandidato. L'unique index
      // resta come rete di sicurezza (23505).
      if (data.numeroCandidato == null) {
        const next = await tx
          .select({ m: max(candidati.numeroCandidato) })
          .from(candidati)
          .where(eq(candidati.concorsoId, data.concorsoId));
        data.numeroCandidato = (next[0]?.m ?? 0) + 1;
      }
      try {
        const [created] = await tx
          .insert(candidati)
          .values({ tenantId: req.tenant!.id, ...data, numeroCandidato: data.numeroCandidato })
          .returning();
        await writeAudit(tx, req, 'candidato.create', {
          targetType: 'candidato',
          targetId: created!.id,
          payload: { numero: created!.numeroCandidato, nome: created!.nome },
        });
        return reply.code(201).send(created);
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if ((e.code ?? e.cause?.code) === '23505') return reply.conflict('numero_candidato già usato nel concorso');
        throw err;
      }
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      // Per validare lo scope sezione/categoria serve sapere il concorso del
      // candidato. Lo leggiamo prima (l'id non è modificabile via PATCH).
      const cur = await tx
        .select({ concorsoId: candidati.concorsoId, sezioneId: candidati.sezioneId })
        .from(candidati)
        .where(eq(candidati.id, id))
        .limit(1);
      if (cur.length === 0) return reply.notFound();
      const scope = await validateScope(
        tx,
        cur[0]!.concorsoId,
        // Se la PATCH non tocca sezione, usa quella corrente come riferimento
        // per verificare la coerenza della categoria.
        parsed.data.sezioneId !== undefined ? parsed.data.sezioneId : cur[0]!.sezioneId,
        parsed.data.categoriaId,
      );
      if (!scope.ok) return reply.badRequest(scope.error);
      // Gerarchia categoria→sezione: se la PATCH cambia la categoria senza
      // toccare la sezione, propaghiamo la sezione della nuova categoria così
      // i due campi restano coerenti.
      const data = { ...parsed.data };
      // R15: deriva la sezione dalla categoria anche quando sezioneId è azzerato
      // esplicitamente (null), non solo quando è omesso (undefined) — altrimenti
      // resta una categoria senza sezione (stato incoerente).
      if (data.categoriaId && (data.sezioneId === undefined || data.sezioneId === null)) {
        const cat = await tx.select({ sezioneId: categorie.sezioneId }).from(categorie).where(eq(categorie.id, data.categoriaId)).limit(1);
        if (cat.length > 0) data.sezioneId = cat[0]!.sezioneId;
      }
      const [updated] = await tx
        .update(candidati)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(candidati.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'candidato.update', {
        targetType: 'candidato',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      // #2: il DELETE cascada e distrugge candidati_fase + valutazioni (i voti),
      // senza recupero possibile. PRIMA del delete (che resta hard-delete) ne
      // facciamo uno snapshot COMPLETO nel payload (jsonb) dell'audit log
      // tamper-evident → i voti restano ricostruibili dall'audit immutabile.
      const curRows = await tx.select().from(candidati).where(eq(candidati.id, id)).limit(1);
      if (curRows.length === 0) return reply.notFound();
      const candidato = curRows[0]!;
      const cfRows = await tx.select().from(candidatiFase).where(eq(candidatiFase.candidatoId, id));
      const cfIds = cfRows.map((r) => r.id);
      const valRows = cfIds.length
        ? await tx.select().from(valutazioni).where(inArray(valutazioni.candidatoFaseId, cfIds))
        : [];
      // Raggruppa le valutazioni per candidato_fase per uno snapshot strutturato.
      const valByCf = new Map<string, typeof valRows>();
      for (const v of valRows) {
        const arr = valByCf.get(v.candidatoFaseId) ?? [];
        arr.push(v);
        valByCf.set(v.candidatoFaseId, arr);
      }
      const snapshot = {
        candidato,
        candidatiFase: cfRows.map((cf) => ({ candidatoFase: cf, valutazioni: valByCf.get(cf.id) ?? [] })),
      };

      const [deleted] = await tx.delete(candidati).where(eq(candidati.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'candidato.delete', {
        targetType: 'candidato',
        targetId: id,
        payload: { numero: deleted.numeroCandidato, nome: deleted.nome, snapshot },
      });
      return reply.code(204).send();
    });
  });
};
