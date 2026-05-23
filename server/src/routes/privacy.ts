import type { FastifyPluginAsync } from 'fastify';
import { eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  accounts,
  auditLog,
  candidati,
  candidatiMembri,
  commissari,
  iscrizioni,
} from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const erasureBody = z.object({
  email: z.string().email().optional(),
  commissarioId: z.string().uuid().optional(),
  candidatoId: z.string().uuid().optional(),
  iscrizioneId: z.string().uuid().optional(),
  motivo: z.string().min(1).max(500),
}).refine(
  (b) => b.email || b.commissarioId || b.candidatoId || b.iscrizioneId,
  { message: 'fornisci almeno uno tra: email, commissarioId, candidatoId, iscrizioneId' },
);

export const privacyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('admin'));

  /**
   * POST /privacy/export
   * Esporta tutti i dati del tenant in JSON (right to data portability, GDPR art. 20).
   * L'admin del tenant può scaricare per i propri utenti finali.
   */
  app.post('/export', async (req) => {
    return req.dbTx(async (tx) => {
      const [accountsList, commissariList, candidatiList, membriList, iscrizioniList] =
        await Promise.all([
          tx.select().from(accounts),
          tx.select().from(commissari),
          tx.select().from(candidati),
          tx.select().from(candidatiMembri),
          tx.select().from(iscrizioni),
        ]);

      await writeAudit(tx, req, 'privacy.export', {
        payload: {
          accounts: accountsList.length,
          commissari: commissariList.length,
          candidati: candidatiList.length,
          iscrizioni: iscrizioniList.length,
        },
      });

      return {
        exportedAt: new Date().toISOString(),
        tenant: { id: req.tenant!.id, slug: req.tenant!.slug, nome: req.tenant!.nome },
        accounts: accountsList.map((a) => ({
          ...a,
          passwordHash: '[REDACTED]',
          totpSecret: a.totpSecret ? '[REDACTED]' : null,
          totpRecoveryCodes: a.totpRecoveryCodes ? '[REDACTED]' : null,
        })),
        commissari: commissariList,
        candidati: candidatiList,
        candidatiMembri: membriList,
        // N4: il token di verifica email è un segreto operativo (consente di
        // confermare l'iscrizione). Va redatto dall'export GDPR come gli altri
        // secret (passwordHash/totp), coerente col fix H10 che lo aveva già
        // rimosso dalle response API.
        iscrizioni: iscrizioniList.map((i) => ({
          ...i,
          emailVerificationToken: i.emailVerificationToken ? '[REDACTED]' : null,
        })),
      };
    });
  });

  /**
   * POST /privacy/erase
   * Right to be forgotten (GDPR art. 17). Pseudonimizza i dati personali
   * di un soggetto identificato per email/commissarioId/candidatoId/iscrizioneId.
   * Non cancella record per non rompere integrità referenziale (valutazioni, audit, …).
   */
  app.post('/erase', async (req, reply) => {
    const parsed = erasureBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);

    const REDACTED = '[ERASED]';
    let touched = { commissari: 0, candidati: 0, candidatiMembri: 0, iscrizioni: 0 };

    return req.dbTx(async (tx) => {
      if (parsed.data.commissarioId) {
        const res = await tx
          .update(commissari)
          .set({
            nome: REDACTED,
            cognome: REDACTED,
            email: null,
            telefono: null,
            dataNascita: null,
            nazionalita: null,
            foto: null,
            bio: null,
            stato: 'INATTIVO',
            updatedAt: new Date(),
          })
          .where(eq(commissari.id, parsed.data.commissarioId))
          .returning();
        touched.commissari = res.length;
      }

      if (parsed.data.candidatoId) {
        const res = await tx
          .update(candidati)
          .set({
            nome: REDACTED,
            cognome: REDACTED,
            dataNascita: null,
            nazionalita: null,
            foto: null,
            docentiPreparatori: null,
            updatedAt: new Date(),
          })
          .where(eq(candidati.id, parsed.data.candidatoId))
          .returning();
        touched.candidati = res.length;
        const mem = await tx
          .update(candidatiMembri)
          .set({
            nome: REDACTED,
            cognome: REDACTED,
            dataNascita: null,
            nazionalita: null,
          })
          .where(eq(candidatiMembri.candidatoId, parsed.data.candidatoId))
          .returning();
        touched.candidatiMembri = mem.length;
      }

      if (parsed.data.iscrizioneId) {
        const res = await tx
          .update(iscrizioni)
          .set({
            nome: REDACTED,
            cognome: REDACTED,
            email: 'erased@erased.local',
            telefono: null,
            dataNascita: null,
            nazionalita: null,
            programma: null,
            docentiPreparatori: null,
            membri: null,
            tutore: null,
            ipAddress: null,
            userAgent: null,
            updatedAt: new Date(),
          })
          .where(eq(iscrizioni.id, parsed.data.iscrizioneId))
          .returning();
        touched.iscrizioni = res.length;
      }

      if (parsed.data.email) {
        const email = parsed.data.email.toLowerCase();
        const isc = await tx
          .update(iscrizioni)
          .set({
            nome: REDACTED,
            cognome: REDACTED,
            email: 'erased@erased.local',
            telefono: null,
            dataNascita: null,
            nazionalita: null,
            programma: null,
            docentiPreparatori: null,
            membri: null,
            tutore: null,
            ipAddress: null,
            userAgent: null,
            updatedAt: new Date(),
          })
          .where(sql`lower(${iscrizioni.email}) = ${email}`)
          .returning();
        touched.iscrizioni += isc.length;

        const com = await tx
          .update(commissari)
          .set({
            nome: REDACTED,
            cognome: REDACTED,
            email: null,
            telefono: null,
            dataNascita: null,
            nazionalita: null,
            foto: null,
            bio: null,
            stato: 'INATTIVO',
            updatedAt: new Date(),
          })
          .where(sql`lower(${commissari.email}) = ${email}`)
          .returning();
        touched.commissari += com.length;
      }

      await writeAudit(tx, req, 'privacy.erase', {
        payload: { ...parsed.data, touched },
      });

      return { ok: true, touched };
    });
  });
};
