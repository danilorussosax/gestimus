import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { criteri } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();
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
    return req.dbTx(async (tx) => {
      return q.faseId
        ? tx.select().from(criteri).where(eq(criteri.faseId, q.faseId))
        : tx.select().from(criteri);
    });
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    return req.dbTx(async (tx) => {
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
    const sum = items.reduce((s, c) => s + c.peso, 0);
    // Normalizza a 100 (interi). Se sum è 0 (tutti pesi 0), distribuisci equo.
    const normalized = items.map((c, i) => {
      const pesoNorm = sum > 0 ? Math.round((c.peso / sum) * 100) : Math.round(100 / items.length);
      return { ...c, peso: Math.max(0, Math.min(100, pesoNorm)), ordine: c.ordine ?? i };
    });

    return req.dbTx(async (tx) => {
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
