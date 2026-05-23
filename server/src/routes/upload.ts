import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, commissari, concorsi } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { deleteFile, saveFile, type ResourceKind } from '../services/storage.js';

const uuid = z.string().uuid();
const ALLOWED_RESOURCES: ResourceKind[] = ['concorso', 'commissario', 'candidato'];

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('admin'));

  /**
   * POST /upload/:resource/:id (multipart/form-data, field "file")
   * Carica un file e aggiorna la risorsa target con il path pubblico:
   *   - concorso → concorsi.logo
   *   - commissario → commissari.foto
   *   - candidato → candidati.foto
   */
  app.post('/:resource/:id', async (req, reply) => {
    const params = z
      .object({
        resource: z.enum(['concorso', 'commissario', 'candidato']),
        id: uuid,
      })
      .safeParse(req.params);
    if (!params.success) return reply.badRequest(params.error.message);
    const { resource, id } = params.data;

    if (!ALLOWED_RESOURCES.includes(resource as ResourceKind)) {
      return reply.badRequest(`resource non supportata: ${resource}`);
    }

    const file = await req.file();
    if (!file) return reply.badRequest('file mancante (field "file")');
    const buffer = await file.toBuffer();

    let stored;
    try {
      stored = await saveFile({
        tenantSlug: req.tenant!.slug,
        resource: resource as ResourceKind,
        id,
        buffer,
        mimeType: file.mimetype,
        originalFilename: file.filename,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'UNSUPPORTED_MIME') return reply.code(415).send({ error: e.message });
      if (e.code === 'FILE_TOO_LARGE') return reply.code(413).send({ error: e.message });
      throw err;
    }

    // N49: il file è già su disco. Se l'update DB fallisce (risorsa non
    // trovata, RLS, eccezione), va rimosso per non lasciare un orfano che
    // consuma storage. Cleanup best-effort su entrambi i percorsi di errore.
    try {
      return await req.dbTx(async (tx) => {
        let updated;
        switch (resource) {
          case 'concorso': {
            const rows = await tx
              .update(concorsi)
              .set({ logo: stored.publicUrl, updatedAt: new Date() })
              .where(eq(concorsi.id, id))
              .returning();
            updated = rows[0];
            break;
          }
          case 'commissario': {
            const rows = await tx
              .update(commissari)
              .set({ foto: stored.publicUrl, updatedAt: new Date() })
              .where(eq(commissari.id, id))
              .returning();
            updated = rows[0];
            break;
          }
          case 'candidato': {
            const rows = await tx
              .update(candidati)
              .set({ foto: stored.publicUrl, updatedAt: new Date() })
              .where(eq(candidati.id, id))
              .returning();
            updated = rows[0];
            break;
          }
        }
        if (!updated) {
          await deleteFile(stored.path).catch(() => {});
          return reply.notFound();
        }

        await writeAudit(tx, req, 'upload.create', {
          targetType: resource,
          targetId: id,
          payload: { filename: stored.filename, size: stored.sizeBytes, mime: stored.mimeType },
        });

        return reply.code(201).send({
          url: stored.publicUrl,
          filename: stored.filename,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        });
      });
    } catch (err) {
      await deleteFile(stored.path).catch(() => {});
      throw err;
    }
  });
};
