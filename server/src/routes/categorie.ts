import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, categorie, sezioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();
const baseBody = z.object({
  sezioneId: uuid,
  nome: z.string().min(1).max(255),
  descrizione: z.string().optional(),
  etaMin: z.number().int().min(0).max(120).optional(),
  etaMax: z.number().int().min(0).max(120).optional(),
  ordine: z.number().int().optional(),
});
// N97: etaMin non può superare etaMax (intervallo impossibile, es. 50–20).
// Refine applicato sia su create che su update; il CHECK in schema.ts è la
// rete di sicurezza a livello DB (copre anche il PATCH parziale su valori già
// esistenti, che il refine sul solo body non vedrebbe).
const etaOk = (d: { etaMin?: number; etaMax?: number }) =>
  d.etaMin == null || d.etaMax == null || d.etaMin <= d.etaMax;
const etaErr = { message: 'etaMin non può superare etaMax', path: ['etaMin'] };
const createBody = baseBody.refine(etaOk, etaErr);
const updateBody = baseBody.partial().omit({ sezioneId: true }).refine(etaOk, etaErr);

export const categorieRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z.object({ sezioneId: uuid.optional() }).parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const base = tx.select().from(categorie).$dynamic();
      const filtered = q.sezioneId ? base.where(eq(categorie.sezioneId, q.sezioneId)) : base;
      return filtered.limit(limit).offset(offset);
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(categorie).where(eq(categorie.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      // N140: la sezioneId deve appartenere al tenant (FK non soggetta a RLS).
      const sezOk = await tx
        .select({ id: sezioni.id })
        .from(sezioni)
        .where(eq(sezioni.id, parsed.data.sezioneId))
        .limit(1);
      if (sezOk.length === 0) return reply.badRequest('sezione non trovata');
      const [created] = await tx
        .insert(categorie)
        .values({ tenantId: req.tenant!.id, ...parsed.data })
        .returning();
      await writeAudit(tx, req, 'categoria.create', {
        targetType: 'categoria',
        targetId: created!.id,
        payload: { nome: created!.nome },
      });
      return reply.code(201).send(created);
    });
  });

  app.patch('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(categorie)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(categorie.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'categoria.update', {
        targetType: 'categoria',
        targetId: id,
        payload: parsed.data,
      });
      return updated;
    });
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      // Pre-check: candidati che hanno scelto questa categoria. Senza FK lato
      // DB diventerebbero orfani (categoria_id punta a un record che non esiste
      // più). Blocchiamo finché l'admin non li riassegna.
      const candCount = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(candidati)
        .where(eq(candidati.categoriaId, id));
      const nCand = candCount[0]?.n ?? 0;
      if (nCand > 0) {
        return reply.code(409).send({
          error: `Categoria in uso: ${nCand} candidati la referenziano. Rimuovi prima i riferimenti.`,
          candidati: nCand,
        });
      }
      const [deleted] = await tx.delete(categorie).where(eq(categorie.id, id)).returning();
      if (!deleted) return reply.notFound();
      await writeAudit(tx, req, 'categoria.delete', {
        targetType: 'categoria',
        targetId: id,
        payload: { nome: deleted.nome },
      });
      return reply.code(204).send();
    });
  });
};
