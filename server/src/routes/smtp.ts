import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { encryptSmtp, isEncryptedSmtp } from '../services/crypto-smtp.js';
import { invalidateTransporter, sendMail, verifyTenantSmtp } from '../services/email.js';
import { replyValidationError } from '../lib/validation.js';

const smtpBody = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean().optional(),
  user: z.string().min(1).max(255),
  password: z.string().min(1).max(500),
  from: z.string().min(1).max(255),
});

/**
 * Sanifica i messaggi d'errore SMTP per il client.
 *
 * L'admin del tenant ha bisogno di un hint per il troubleshooting (categoria
 * dell'errore + eventuale codice numerico) ma non vogliamo esporre dettagli
 * implementativi (stack trace, nome di librerie, percorsi). Il messaggio
 * originale è già loggato server-side via req.log.warn.
 */
function sanitizeSmtpError(raw: string | undefined): string {
  const msg = String(raw ?? '').trim();
  if (!msg) return 'connessione SMTP fallita';

  // Mantieni codici SMTP standard (es. "421 4.7.0 Try later")
  const codeMatch = msg.match(/\b([245]\d{2})\b/);
  const code = codeMatch ? codeMatch[1] : null;

  // Categorie comuni — restituisci messaggio semantico
  if (/timeout|ETIMEDOUT/i.test(msg)) return code ? `timeout (${code})` : 'timeout di connessione';
  if (/ECONNREFUSED/i.test(msg)) return 'connessione rifiutata (host/porta errati?)';
  if (/EAI_AGAIN|ENOTFOUND/i.test(msg)) return 'host SMTP non risolvibile (DNS)';
  if (/self.signed|self-signed|certificate/i.test(msg)) return 'certificato TLS non valido o self-signed';
  if (/auth|login|535|454/i.test(msg)) return code ? `autenticazione rifiutata (${code})` : 'autenticazione rifiutata';
  if (/relay|550|553/i.test(msg)) return code ? `relay/mittente rifiutato (${code})` : 'relay/mittente rifiutato';

  return code ? `errore SMTP ${code}` : 'errore SMTP — controlla host, porta, credenziali';
}

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
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);

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
    if (!body.success) return replyValidationError(reply, req, body.error);

    const verify = await verifyTenantSmtp(req.tenant!.id);
    if (!verify.ok) {
      // Log strutturato lato server per troubleshooting; messaggio sanificato al client
      req.log.warn({ smtpVerifyError: verify.error }, 'smtp verify failed');
      return reply.code(400).send({
        ok: false,
        step: 'verify',
        error: sanitizeSmtpError(verify.error),
      });
    }

    if (body.data.sendTo) {
      try {
        // N44: il nome tenant è user-controlled. Rimuovi CR/LF (e altri control
        // char) prima di interpolarlo nella subject, altrimenti un nome con
        // \r\n inietterebbe header SMTP arbitrari (es. BCC spam).
        const safeNome = (req.tenant!.nome ?? '').replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, 120);
        const sent = await sendMail({
          tenantId: req.tenant!.id,
          to: body.data.sendTo,
          subject: `[Gestimus] Test SMTP per ${safeNome}`,
          text: 'Questa è una email di test della configurazione SMTP del tenant.',
        });
        await req.dbTx(async (tx) => {
          await writeAudit(tx, req, 'smtp.test_send', {
            payload: { sendTo: body.data.sendTo, messageId: sent.messageId },
          });
        });
        return { ok: true, verified: true, sent: true, messageId: sent.messageId };
      } catch (err) {
        req.log.warn({ err }, 'smtp test send failed');
        return reply.code(400).send({
          ok: false,
          step: 'send',
          error: sanitizeSmtpError((err as Error).message),
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
