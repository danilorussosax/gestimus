import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, commissari, concorsi } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { join } from 'node:path';
import { deleteFile, saveFile, tenantUploadDir, type ResourceKind } from '../services/storage.js';
import { env } from '../env.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();

// L222: admin/superadmin gestiscono tutti gli upload; un commissario può gestire
// SOLO la propria foto (resource 'commissario' con id === proprio commissarioId).
function canManageUpload(req: FastifyRequest, resource: string, id: string): boolean {
  const role = req.account?.role;
  if (role === 'admin' || role === 'superadmin') return true;
  return role === 'commissario' && resource === 'commissario' && id === req.account?.commissarioId;
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

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
    if (!params.success) return replyValidationError(reply, req, params.error);
    const { resource, id } = params.data;

    // N98: rimosso il guard `!ALLOWED_RESOURCES.includes(resource)` —
    // irraggiungibile, lo z.enum sopra ammette già solo questi tre valori.
    if (!canManageUpload(req, resource, id)) {
      return reply.code(403).send({ error: 'permesso negato per questo upload' });
    }

    const file = await req.file();
    if (!file) return reply.badRequest('file mancante (field "file")');
    // N99: @fastify/multipart è registrato con limits.fileSize (app.ts) → la RAM
    // è già protetta (toBuffer aborta oltre il limite). Qui mappiamo solo
    // l'errore di superamento a un 413 pulito invece di un 500 generico.
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: `file troppo grande (max ${env.UPLOADS_MAX_FILE_SIZE_MB} MB)` });
      }
      throw err;
    }

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
      if (e.code === 'INVALID_IMAGE') return reply.code(415).send({ error: e.message });
      if (e.code === 'FILE_TOO_LARGE') return reply.code(413).send({ error: e.message });
      throw err;
    }

    // N49: il file è già su disco. Se l'update DB fallisce (risorsa non
    // trovata, RLS, eccezione), va rimosso per non lasciare un orfano che
    // consuma storage. Cleanup best-effort su entrambi i percorsi di errore.
    // #10: cattura l'URL del file PRECEDENTE per cancellarlo dopo il commit
    // (re-upload). Senza, il vecchio file resta orfano sul disco: saveFile genera
    // sempre un nome random nuovo nella stessa dir → i file si accumulano.
    // Holder (non `let`): la CFA esterna restringerebbe un `let` assegnato solo
    // nella callback al tipo dell'inizializzatore; una proprietà d'oggetto viene
    // invece letta al suo tipo dichiarato.
    const prev: { url: string | null } = { url: null };
    try {
      const sent = await req.dbTx(async (tx) => {
        // Leggi l'URL corrente PRIMA dell'update (RETURNING su UPDATE darebbe il
        // valore NUOVO), poi sovrascrivi con il nuovo file.
        let updated;
        switch (resource) {
          case 'concorso': {
            const sel = await tx.select({ url: concorsi.logo }).from(concorsi).where(eq(concorsi.id, id)).limit(1);
            prev.url = sel[0]?.url ?? null;
            const rows = await tx
              .update(concorsi)
              .set({ logo: stored.publicUrl, updatedAt: new Date() })
              .where(eq(concorsi.id, id))
              .returning({ id: concorsi.id });
            updated = rows[0];
            break;
          }
          case 'commissario': {
            const sel = await tx.select({ url: commissari.foto }).from(commissari).where(eq(commissari.id, id)).limit(1);
            prev.url = sel[0]?.url ?? null;
            const rows = await tx
              .update(commissari)
              .set({ foto: stored.publicUrl, updatedAt: new Date() })
              .where(eq(commissari.id, id))
              .returning({ id: commissari.id });
            updated = rows[0];
            break;
          }
          case 'candidato': {
            const sel = await tx.select({ url: candidati.foto }).from(candidati).where(eq(candidati.id, id)).limit(1);
            prev.url = sel[0]?.url ?? null;
            const rows = await tx
              .update(candidati)
              .set({ foto: stored.publicUrl, updatedAt: new Date() })
              .where(eq(candidati.id, id))
              .returning({ id: candidati.id });
            updated = rows[0];
            break;
          }
        }
        if (!updated) {
          prev.url = null; // risorsa inesistente: nessun vecchio file da rimuovere
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
      // #10: dopo il commit, elimina il file precedente se era un upload gestito
      // (path sotto /uploads/) e diverso dal nuovo. Best-effort.
      const previousUrl = prev.url;
      if (previousUrl && previousUrl !== stored.publicUrl && previousUrl.startsWith('/uploads/')) {
        const fn = previousUrl.split('/').pop();
        if (fn) {
          const dir = tenantUploadDir(req.tenant!.slug, resource as ResourceKind, id);
          await deleteFile(join(dir, fn)).catch(() => {});
        }
      }
      return sent;
    } catch (err) {
      await deleteFile(stored.path).catch(() => {});
      throw err;
    }
  });

  /**
   * DELETE /:resource/:id — rimuove il file associato alla risorsa: legge l'URL
   * corrente, azzera la colonna (logo/foto) e cancella il file dal filesystem
   * (N61, anti file orfani). Idempotente: se non c'è file ritorna comunque 200.
   */
  app.delete('/:resource/:id', async (req, reply) => {
    const params = z
      .object({ resource: z.enum(['concorso', 'commissario', 'candidato']), id: uuid })
      .safeParse(req.params);
    if (!params.success) return replyValidationError(reply, req, params.error);
    const { resource, id } = params.data;
    if (!canManageUpload(req, resource, id)) {
      return reply.code(403).send({ error: 'permesso negato per questo upload' });
    }

    const currentUrl = await req.dbTx(async (tx) => {
      if (resource === 'concorso') {
        const sel = await tx.select({ url: concorsi.logo }).from(concorsi).where(eq(concorsi.id, id)).limit(1);
        if (sel.length === 0) return reply.notFound();
        await tx.update(concorsi).set({ logo: null, updatedAt: new Date() }).where(eq(concorsi.id, id));
        return sel[0]!.url;
      }
      if (resource === 'commissario') {
        const sel = await tx.select({ url: commissari.foto }).from(commissari).where(eq(commissari.id, id)).limit(1);
        if (sel.length === 0) return reply.notFound();
        await tx.update(commissari).set({ foto: null, updatedAt: new Date() }).where(eq(commissari.id, id));
        return sel[0]!.url;
      }
      const sel = await tx.select({ url: candidati.foto }).from(candidati).where(eq(candidati.id, id)).limit(1);
      if (sel.length === 0) return reply.notFound();
      await tx.update(candidati).set({ foto: null, updatedAt: new Date() }).where(eq(candidati.id, id));
      return sel[0]!.url;
    });
    if (reply.sent) return reply;

    // Cancella il file: l'URL è /uploads/<slug>/<resource>/<id>/<filename>.
    if (typeof currentUrl === 'string' && currentUrl) {
      const filename = currentUrl.split('/').pop();
      if (filename) {
        const dir = tenantUploadDir(req.tenant!.slug, resource as ResourceKind, id);
        await deleteFile(join(dir, filename)).catch(() => {});
      }
    }
    await req.dbTx(async (tx) => {
      await writeAudit(tx, req, 'upload.delete', { targetType: resource, targetId: id });
    });
    return reply.code(200).send({ ok: true });
  });
};
