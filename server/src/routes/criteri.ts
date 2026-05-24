import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { criteri, fasi } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';

const uuid = z.string().uuid();

// R15 (M208): stessa derivazione chiave del client (js/scoring.js slugifyKey).
// Lo scoring mappa i voti per chiave-da-nome: due criteri il cui nome produce la
// stessa chiave (es. "Tempo" / "Tèmpo", o troncamento a 30 char) collassano in
// una sola, fondendo pesi/voti. Bloccarlo qui, alla creazione, è il fix corretto
// (cambiare la derivazione in lettura romperebbe il match coi voti già salvati).
function slugifyKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'crit';
}

const createBody = z.object({
  faseId: uuid,
  nome: z.string().min(1).max(255),
  descrizione: z.string().optional(),
  peso: z.number().int().min(0).max(100).optional(),
  ordine: z.number().int().optional(),
});
const updateBody = createBody.partial().omit({ faseId: true });

// N34+N35: replace atomico dei criteri di una fase. Il peso è 0-100 (decimale
// ammesso in input, normalizzato dopo). Almeno 1 criterio.
const replaceBody = z.object({
  criteri: z
    .array(
      z.object({
        nome: z.string().min(1).max(255),
        descrizione: z.string().optional(),
        peso: z.number().min(0).max(100),
        ordine: z.number().int().optional(),
      }),
    )
    .min(1),
});

export const criteriRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ faseId: uuid.optional() }).parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(criteri).$dynamic();
      const filtered = q.faseId ? base.where(eq(criteri.faseId, q.faseId)) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      // N52+N62: la fase deve esistere ed essere del tenant corrente (la query
      // gira sotto RLS → una fase di altro tenant non è visibile → 404). Evita
      // sia il bypass del tenant ownership sia la FK violation grezza (500).
      const f = await tx.select({ id: fasi.id }).from(fasi).where(eq(fasi.id, parsed.data.faseId)).limit(1);
      if (f.length === 0) return reply.code(404).send({ error: 'fase non trovata nel tenant corrente' });
      const [created] = await tx
        .insert(criteri)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'criterio.create', {
        targetType: 'criterio',
        targetId: created!.id,
        payload: { nome: created!.nome, peso: created!.peso },
      });
      return reply.code(201).send(created);
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(criteri)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(criteri.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'criterio.update', {
        targetType: 'criterio',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const [deleted] = await tx.delete(criteri).where(eq(criteri.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'criterio.delete', {
        targetType: 'criterio',
        targetId: id,
        payload: { nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });

  // N35: replace atomico dei criteri di una fase in una singola transazione
  // (delete + insert). Prima il client faceva N delete + N post separati: un
  // fallimento a metà lasciava i criteri vecchi cancellati e i nuovi parziali.
  // N34: i pesi vengono NORMALIZZATI a somma 100 (relative weights preservati)
  // così lo scoring usa sempre la scala piena anche se l'admin inserisce pesi
  // che non sommano a 100.
  app.put('/fase/:faseId', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { faseId } = z.object({ faseId: uuid }).parse(req.params);
    const parsed = replaceBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    const items = parsed.data.criteri;
    // R15 (M208): rifiuta nomi che generano la STESSA chiave di scoring → eviterebbe
    // che pesi/voti di due criteri si fondano silenziosamente.
    const keys = items.map((c) => slugifyKey(c.nome));
    if (new Set(keys).size !== keys.length) {
      return reply.badRequest('due o più criteri generano la stessa chiave (nomi troppo simili): rinominane uno');
    }
    const sum = items.reduce((s, c) => s + c.peso, 0);
    // N58: normalizzazione a 100 con metodo largest-remainder (Hamilton):
    // Math.round() su ogni peso non garantisce somma 100 (es. 3×33.33→99).
    // Assegniamo il floor a tutti, poi distribuiamo il resto (100 - Σfloor) ai
    // criteri con la parte frazionaria più alta. Risultato: somma sempre 100.
    const n = items.length;
    const exact = items.map((c) => (sum > 0 ? (c.peso / sum) * 100 : 100 / n));
    const floors = exact.map((x) => Math.floor(x));
    let remainder = 100 - floors.reduce((s, x) => s + x, 0);
    // indici ordinati per parte frazionaria decrescente
    const order = exact
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    const pesi = [...floors];
    for (let k = 0; k < order.length && remainder > 0; k++) {
      pesi[order[k]!.i]! += 1;
      remainder--;
    }
    const normalized = items.map((c, i) => ({
      ...c,
      peso: Math.max(0, Math.min(100, pesi[i]!)),
      ordine: c.ordine ?? i,
    }));

    return req.dbTx(async (tx) => {
      // N140: la fase deve appartenere al tenant (FK non soggetta a RLS).
      // Sotto RLS questa SELECT ritorna 0 righe se la fase è di un altro tenant.
      const faseOk = await tx
        .select({ id: fasi.id })
        .from(fasi)
        .where(eq(fasi.id, faseId))
        .limit(1);
      if (faseOk.length === 0) return reply.notFound();
      await tx.delete(criteri).where(eq(criteri.faseId, faseId));
      const rows = await tx
        .insert(criteri)
        .values(
          normalized.map((c) => ({
            tenantId: req.tenant!.id,
            faseId,
            nome: c.nome,
            descrizione: c.descrizione,
            peso: c.peso,
            ordine: c.ordine,
          })),
        )
        .returning();
      await writeAudit(tx, req, 'criterio.replace', {
        targetType: 'fase',
        targetId: faseId,
        payload: { count: rows.length },
      });
      return rows;
    });
  });
};
