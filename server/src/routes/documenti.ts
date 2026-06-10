import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { uuid } from '../lib/zod-helpers.js';
import { documentiEnte } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { assertInsideUploads, deleteFile, saveFile } from '../services/storage.js';
import { env } from '../env.js';
import { replyValidationError } from '../lib/validation.js';

// =====================================================================
// Plugin ADMIN: CRUD dei documenti dell'ente (regolamenti/moduli/template).
// Richiede auth + role=admin. Prefix /api/documenti (vedi app.ts).
// =====================================================================
export const documentiAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('admin'));

  // GET / → lista TUTTI i documenti del tenant (anche i non pubblicati).
  // Niente storage_key nel payload (path filesystem interno).
  app.get('/', async (req) => {
    return req.dbTx(async (tx) =>
      tx
        .select({
          id: documentiEnte.id,
          titolo: documentiEnte.titolo,
          descrizione: documentiEnte.descrizione,
          nomeFile: documentiEnte.nomeFile,
          publicUrl: documentiEnte.publicUrl,
          mimeType: documentiEnte.mimeType,
          sizeBytes: documentiEnte.sizeBytes,
          versione: documentiEnte.versione,
          pubblicato: documentiEnte.pubblicato,
          createdAt: documentiEnte.createdAt,
          updatedAt: documentiEnte.updatedAt,
        })
        .from(documentiEnte)
        .orderBy(asc(documentiEnte.titolo)),
    );
  });

  // POST /?titolo=...&descrizione=...&pubblicato=... (multipart, field "file")
  // → upload di un nuovo documento. I metadati viaggiano in query string (come la
  // route allegati iscrizioni: ordine-indipendente vs i field multipart). Il file
  // è salvato da services/storage.ts sotto uploads/<tenant>/documento/<id>/<random>;
  // publicUrl serve il file come statico (pubblico, come i loghi concorso).
  app.post('/', async (req, reply) => {
    // I metadati sono validati PRIMA di consumare lo stream del file.
    const meta = z
      .object({
        titolo: z.string().min(1).max(255),
        descrizione: z.string().max(2000).optional(),
        // query: assente → true (default), 'false' → false, qualsiasi altro → true.
        pubblicato: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v !== 'false'),
      })
      .safeParse(req.query);
    if (!meta.success) return replyValidationError(reply, req, meta.error);

    // Pre-genero l'id del documento così posso usarlo come "id" del path di
    // storage PRIMA dell'insert (saveFile vuole un id stabile per la sottocartella).
    const docId = randomUUID();

    const file = await req.file();
    if (!file) return reply.badRequest('file mancante (field "file")');

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
        resource: 'documento',
        id: docId,
        buffer,
        mimeType: file.mimetype,
        originalFilename: file.filename,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'UNSUPPORTED_MIME') return reply.code(415).send({ error: e.message });
      if (e.code === 'MIME_MISMATCH') return reply.code(415).send({ error: e.message });
      if (e.code === 'INVALID_IMAGE') return reply.code(415).send({ error: e.message });
      if (e.code === 'FILE_TOO_LARGE') return reply.code(413).send({ error: e.message });
      throw err;
    }

    // N49: il file è già su disco. Se l'insert DB fallisce, va rimosso per non
    // lasciare un orfano. Cleanup best-effort.
    try {
      return await req.dbTx(async (tx) => {
        const [created] = await tx
          .insert(documentiEnte)
          .values({
            id: docId,
            tenantId: req.tenant!.id,
            titolo: meta.data.titolo.trim(),
            descrizione: meta.data.descrizione?.trim() || null,
            nomeFile: file.filename,
            storageKey: stored.path,
            publicUrl: stored.publicUrl,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            pubblicato: meta.data.pubblicato,
          })
          .returning();
        await writeAudit(tx, req, 'documento.create', {
          targetType: 'documento_ente',
          targetId: created!.id,
          payload: { titolo: created!.titolo, size: stored.sizeBytes, mime: stored.mimeType },
        });
        return reply.code(201).send({
          id: created!.id,
          titolo: created!.titolo,
          descrizione: created!.descrizione,
          nomeFile: created!.nomeFile,
          publicUrl: created!.publicUrl,
          mimeType: created!.mimeType,
          sizeBytes: created!.sizeBytes,
          versione: created!.versione,
          pubblicato: created!.pubblicato,
          createdAt: created!.createdAt,
          updatedAt: created!.updatedAt,
        });
      });
    } catch (err) {
      await deleteFile(stored.path).catch(() => {});
      throw err;
    }
  });

  // PATCH /:id → aggiorna i metadati (titolo/descrizione/pubblicato). Niente
  // sostituzione del file qui (per quella si ricarica con POST e si elimina il vecchio).
  app.patch('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const parsed = z
      .object({
        titolo: z.string().min(1).max(255).optional(),
        descrizione: z.string().max(2000).nullable().optional(),
        pubblicato: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    return req.dbTx(async (tx) => {
      const [updated] = await tx
        .update(documentiEnte)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(documentiEnte.id, id))
        .returning();
      if (!updated) return reply.notFound();
      await writeAudit(tx, req, 'documento.update', {
        targetType: 'documento_ente',
        targetId: id,
        payload: parsed.data,
      });
      // Coerente con GET/POST: niente storageKey nel payload (path FS interno).
      return {
        id: updated.id,
        titolo: updated.titolo,
        descrizione: updated.descrizione,
        nomeFile: updated.nomeFile,
        publicUrl: updated.publicUrl,
        mimeType: updated.mimeType,
        sizeBytes: updated.sizeBytes,
        versione: updated.versione,
        pubblicato: updated.pubblicato,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    });
  });

  // DELETE /:id → rimuove il record e il file dal filesystem (anti-orfani).
  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const storageKey = await req.dbTx(async (tx) => {
      const rows = await tx
        .select({ storageKey: documentiEnte.storageKey, titolo: documentiEnte.titolo })
        .from(documentiEnte)
        .where(eq(documentiEnte.id, id))
        .limit(1);
      if (rows.length === 0) return reply.notFound();
      await tx.delete(documentiEnte).where(eq(documentiEnte.id, id));
      await writeAudit(tx, req, 'documento.delete', {
        targetType: 'documento_ente',
        targetId: id,
        payload: { titolo: rows[0]!.titolo },
      });
      return rows[0]!.storageKey;
    });
    if (reply.sent) return reply;
    // Cancella il file dal disco (best-effort: il record è già rimosso).
    if (typeof storageKey === 'string' && storageKey) {
      await deleteFile(storageKey).catch(() => {});
    }
    return reply.code(204).send();
  });
};

// =====================================================================
// Plugin PUBBLICO: niente auth. Il tenant è risolto dal subdomain (middleware
// globale); la SELECT gira sotto RLS → i documenti di un altro tenant non sono
// visibili. Espone SOLO i documenti `pubblicato`. Prefix /api/public (vedi app.ts).
// Rate-limit per IP.
// =====================================================================
export const documentiPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/documenti',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({ statusCode: 429, error: 'troppe richieste, riprova più tardi' }),
        },
      },
    },
    async (req, reply) => {
      if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
      return req.dbTx(async (tx) =>
        tx
          .select({
            id: documentiEnte.id,
            titolo: documentiEnte.titolo,
            descrizione: documentiEnte.descrizione,
            nomeFile: documentiEnte.nomeFile,
            publicUrl: documentiEnte.publicUrl,
            mimeType: documentiEnte.mimeType,
            sizeBytes: documentiEnte.sizeBytes,
            versione: documentiEnte.versione,
            createdAt: documentiEnte.createdAt,
          })
          .from(documentiEnte)
          .where(eq(documentiEnte.pubblicato, true))
          .orderBy(asc(documentiEnte.titolo)),
      );
    },
  );

  // Download diretto (no-auth) di un singolo documento PUBBLICATO. Streaming via
  // colonna storage_key (i file sono cappati a UPLOADS_MAX_FILE_SIZE_MB). In
  // alternativa il client può seguire publicUrl (servito staticamente).
  app.get(
    '/documenti/:id/download',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({ statusCode: 429, error: 'troppe richieste, riprova più tardi' }),
        },
      },
    },
    async (req, reply) => {
      if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
      const { id } = z.object({ id: uuid }).parse(req.params);
      return req.dbTx(async (tx) => {
        const rows = await tx
          .select()
          .from(documentiEnte)
          .where(and(eq(documentiEnte.id, id), eq(documentiEnte.pubblicato, true)))
          .limit(1);
        if (rows.length === 0) return reply.notFound();
        const doc = rows[0]!;
        // Endpoint PUBBLICO (no auth): storageKey arriva dal DB. Difesa-in-profondità
        // contro path-traversal nel caso il valore non fosse stato prodotto da
        // saveFile() (import/migrazione/manomissione): leggiamo solo dentro uploads.
        let safePath: string;
        try {
          safePath = assertInsideUploads(doc.storageKey);
        } catch {
          return reply.notFound();
        }
        const buf = await readFile(safePath).catch(() => null);
        if (!buf) return reply.notFound();
        const safeName = (doc.nomeFile || 'documento').replace(/[^\w.\-]+/g, '_');
        reply.header('Content-Type', doc.mimeType || 'application/octet-stream');
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
        return reply.send(buf);
      });
    },
  );
};
