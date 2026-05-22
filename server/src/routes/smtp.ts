import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { encryptSmtp, isEncryptedSmtp } from '../services/crypto-smtp.js';
import { invalidateTransporter, sendMail, verifyTenantSmtp } from '../services/email.js';

const smtpBody = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean().optional(),
  user: z.string().min(1).max(255),
  password: z.string().min(1).max(500),
  from: z.string().min(1).max(255),
});

export const smtpRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('admin'));

  /**
   * GET /tenant/smtp
   * Ritorna la config SMTP del tenant SENZA la password (mascherata).
   */
  app.get('/', async (req) => {
    const rows = await dbSuper
      .select({ smtpConfig: tenants.smtpConfig })
      .from(tenants)
      .where(eq(tenants.id, req.tenant!.id))
      .limit(1);
    const raw = rows[0]?.smtpConfig;
    if (!raw) return { configured: false };
    if (isEncryptedSmtp(raw)) {
      // Ritorniamo solo metadati (la password resta cifrata)
      return { configured: true, encrypted: true };
    }
    return { configured: true, encrypted: false };
  });

  /**
   * PUT /tenant/smtp
   * Salva o aggiorna la configurazione SMTP. La password viene cifrata at-rest.
   */
  app.put('/', async (req, reply) => {
    const parsed = smtpBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    const encrypted = encryptSmtp(parsed.data);

    await dbSuper
      .update(tenants)
      .set({ smtpConfig: encrypted, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));

    invalidateTransporter(req.tenant!.id);

    await req.dbTx(async (tx) => {
      await writeAudit(tx, req, 'smtp.update', {
        targetType: 'tenant',
        targetId: req.tenant!.id,
        payload: { host: parsed.data.host, port: parsed.data.port, user: parsed.data.user },
      });
    });

    return { ok: true };
  });

  /**
   * POST /tenant/smtp/test
   * Verifica connessione SMTP (verify) e opzionalmente invia email di test.
   */
  app.post('/test', async (req, reply) => {
    const body = z
      .object({
        sendTo: z.string().email().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.badRequest(body.error.message);

    const verify = await verifyTenantSmtp(req.tenant!.id);
    if (!verify.ok) {
      return reply.code(400).send({ ok: false, step: 'verify', error: verify.error });
    }

    if (body.data.sendTo) {
      try {
        const sent = await sendMail({
          tenantId: req.tenant!.id,
          to: body.data.sendTo,
          subject: `[Gestimus] Test SMTP per ${req.tenant!.nome}`,
          text: 'Questa è una email di test della configurazione SMTP del tenant.',
        });
        await req.dbTx(async (tx) => {
          await writeAudit(tx, req, 'smtp.test_send', {
            payload: { sendTo: body.data.sendTo, messageId: sent.messageId },
          });
        });
        return { ok: true, verified: true, sent: true, messageId: sent.messageId };
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          step: 'send',
          error: (err as Error).message,
        });
      }
    }

    return { ok: true, verified: true };
  });

  /**
   * DELETE /tenant/smtp
   * Rimuove la configurazione SMTP. Il tenant userà il fallback platform (se configurato).
   */
  app.delete('/', async (req) => {
    await dbSuper
      .update(tenants)
      .set({ smtpConfig: null, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    invalidateTransporter(req.tenant!.id);
    await req.dbTx(async (tx) => {
      await writeAudit(tx, req, 'smtp.delete', {
        targetType: 'tenant',
        targetId: req.tenant!.id,
      });
    });
    return { ok: true };
  });
};
