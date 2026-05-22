import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, max, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { candidati, categorie, concorsi, iscrizioni, sezioni } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const uuid = z.string().uuid();

const iscrizioneCreateBody = z.object({
  concorsoId: uuid,
  // Anti-spam
  honeypot: z.string().max(0).optional(), // se valorizzato → bot
  startedAt: z.number().int().optional(), // ms timestamp client al primo render
  // Anagrafica
  nome: z.string().min(1).max(255),
  cognome: z.string().max(255).optional(),
  email: z.string().email(),
  telefono: z.string().max(50).optional(),
  dataNascita: z.string().date().optional(),
  nazionalita: z.string().max(100).optional(),
  strumento: z.string().max(255).optional(),
  programma: z.unknown().optional(),
  docentiPreparatori: z.array(z.string()).optional(),
  sezioneId: uuid.optional(),
  categoriaId: uuid.optional(),
  isGruppo: z.boolean().optional(),
  membri: z.array(z.unknown()).optional(),
  tutore: z.unknown().optional(),
  consensiGdpr: z.unknown(),
});

const MIN_TIME_ON_PAGE_MS = 3000;
const GDPR_MIN_AGE_TUTORE = 16;

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

// =====================================================================
// Plugin PUBBLICO: niente auth, niente requireTenant — ma tenant è risolto
// dal subdomain (middleware globale). Rate-limit applicato per-route.
// =====================================================================
export const iscrizioniPublicRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /public/concorsi → concorsi del tenant con iscrizioni aperte e non scadute.
   * Niente auth, ma serve tenant context (subdomain).
   */
  app.get('/concorsi', async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    return req.dbTx(async (tx) => {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await tx
        .select({
          id: concorsi.id,
          nome: concorsi.nome,
          anno: concorsi.anno,
          dataInizio: concorsi.dataInizio,
          logo: concorsi.logo,
          iscrizioniScadenza: concorsi.iscrizioniScadenza,
          stato: concorsi.stato,
        })
        .from(concorsi)
        .where(eq(concorsi.iscrizioniAperte, true));
      // Filtro applicativo per scadenza (date confronto in SQL date-only)
      return rows.filter((r) => !r.iscrizioniScadenza || String(r.iscrizioniScadenza) >= today);
    });
  });

  /**
   * GET /public/concorsi/:id → dettagli + sezioni + categorie (per popolare il form).
   */
  app.get('/concorsi/:id', async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const c = await tx.select().from(concorsi).where(eq(concorsi.id, id)).limit(1);
      if (c.length === 0 || !c[0]!.iscrizioniAperte) return reply.notFound();
      const sez = await tx.select().from(sezioni).where(eq(sezioni.concorsoId, id));
      const sezIds = sez.map((s) => s.id);
      const cats = sezIds.length
        ? await tx.select().from(categorie).where(
            sql`${categorie.sezioneId} = ANY (${sql.raw(`ARRAY[${sezIds.map((id) => `'${id}'::uuid`).join(',')}]`)})`,
          )
        : [];
      return {
        id: c[0]!.id,
        nome: c[0]!.nome,
        anno: c[0]!.anno,
        dataInizio: c[0]!.dataInizio,
        logo: c[0]!.logo,
        iscrizioniScadenza: c[0]!.iscrizioniScadenza,
        sezioni: sez.map((s) => ({ id: s.id, nome: s.nome, descrizione: s.descrizione })),
        categorie: cats.map((cat) => ({
          id: cat.id,
          sezioneId: cat.sezioneId,
          nome: cat.nome,
          etaMin: cat.etaMin,
          etaMax: cat.etaMax,
        })),
      };
    });
  });

  /**
   * POST /public/iscrizioni — submit iscrizione (no auth).
   * Anti-spam: honeypot vuoto, min-time-on-page, rate-limit per IP.
   * Genera token email verification.
   */
  app.post(
    '/iscrizioni',
    {
      config: {
        rateLimit: { max: 3, timeWindow: '1 hour', errorResponseBuilder: () => ({ error: 'troppe iscrizioni dallo stesso IP, riprova più tardi' }) },
      },
    },
    async (req, reply) => {
      if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });

      const parsed = iscrizioneCreateBody.safeParse(req.body);
      if (!parsed.success) return reply.badRequest(parsed.error.message);
      const data = parsed.data;

      // Honeypot
      if (data.honeypot && data.honeypot.length > 0) {
        // Risponde 200 senza fare nulla → bot non insiste
        return { ok: true, queued: true };
      }
      // Min time on page (anti-bot rapido)
      if (data.startedAt && Date.now() - data.startedAt < MIN_TIME_ON_PAGE_MS) {
        return reply.code(400).send({ error: 'invio troppo rapido' });
      }

      // Verifica concorso esistente + aperto
      const concorsoCheck = await req.dbTx(async (tx) => {
        const rows = await tx.select().from(concorsi).where(eq(concorsi.id, data.concorsoId)).limit(1);
        if (rows.length === 0) return null;
        const c = rows[0]!;
        if (!c.iscrizioniAperte) return 'CHIUSE';
        if (c.iscrizioniScadenza && String(c.iscrizioniScadenza) < new Date().toISOString().slice(0, 10)) return 'SCADUTE';
        return 'OK';
      });
      if (!concorsoCheck) return reply.notFound();
      if (concorsoCheck !== 'OK') return reply.code(403).send({ error: `iscrizioni ${concorsoCheck}` });

      // GDPR: se candidato minorenne, tutore obbligatorio
      if (data.dataNascita) {
        const dob = new Date(data.dataNascita);
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear() -
          (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
        if (age < GDPR_MIN_AGE_TUTORE && !data.tutore) {
          return reply.code(400).send({ error: 'candidato minorenne: dati tutore richiesti' });
        }
      }
      if (!data.consensiGdpr) {
        return reply.code(400).send({ error: 'consensi GDPR mancanti' });
      }

      const emailToken = generateToken();
      return req.dbTx(async (tx) => {
        const [created] = await tx
          .insert(iscrizioni)
          .values({
            tenantId: req.tenant!.id,
            concorsoId: data.concorsoId,
            stato: 'INVIATA',
            nome: data.nome,
            cognome: data.cognome,
            email: data.email.toLowerCase(),
            telefono: data.telefono,
            dataNascita: data.dataNascita,
            nazionalita: data.nazionalita,
            strumento: data.strumento,
            programma: data.programma as object | undefined,
            docentiPreparatori: data.docentiPreparatori,
            sezioneId: data.sezioneId,
            categoriaId: data.categoriaId,
            isGruppo: data.isGruppo ?? false,
            membri: data.membri as object | undefined,
            tutore: data.tutore as object | undefined,
            consensiGdpr: data.consensiGdpr as object,
            emailVerificationToken: emailToken,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          })
          .returning();

        await writeAudit(tx, req, 'iscrizione.create_public', {
          targetType: 'iscrizione',
          targetId: created!.id,
          payload: { email: created!.email },
        });

        // TODO: inviare email di conferma con link /verify?token=...
        // (sendMail({ tenantId, to: data.email, subject: ..., text: link }))
        // Per ora ritorniamo il token in dev (in prod va via email).
        return reply.code(201).send({
          ok: true,
          iscrizioneId: created!.id,
          emailVerificationToken:
            process.env.NODE_ENV === 'development' ? emailToken : undefined,
        });
      });
    },
  );

  /**
   * GET /public/iscrizioni/:token/verify — verifica email tramite link.
   */
  app.get('/iscrizioni/:token/verify', async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    const { token } = z.object({ token: z.string().min(8).max(128) }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx
        .select()
        .from(iscrizioni)
        .where(eq(iscrizioni.emailVerificationToken, token))
        .limit(1);
      if (rows.length === 0) return reply.notFound();
      const isc = rows[0]!;
      if (isc.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      const [updated] = await tx
        .update(iscrizioni)
        .set({
          stato: isc.stato === 'INVIATA' ? 'EMAIL_VERIFICATA' : isc.stato,
          emailVerifiedAt: new Date(),
          emailVerificationToken: null,
          updatedAt: new Date(),
        })
        .where(eq(iscrizioni.id, isc.id))
        .returning();
      await writeAudit(tx, req, 'iscrizione.email_verified', {
        targetType: 'iscrizione',
        targetId: isc.id,
      });
      return { ok: true, iscrizione: updated };
    });
  });
};

// =====================================================================
// Plugin ADMIN: lista, approve, reject. Richiede auth + role=admin.
// =====================================================================
export const iscrizioniAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const q = z
      .object({ concorsoId: uuid.optional(), stato: z.string().optional() })
      .parse(req.query);
    return req.dbTx(async (tx) => {
      const conditions = [];
      if (q.concorsoId) conditions.push(eq(iscrizioni.concorsoId, q.concorsoId));
      if (q.stato) conditions.push(eq(iscrizioni.stato, q.stato));
      const where = conditions.length ? and(...conditions) : undefined;
      return where
        ? await tx.select().from(iscrizioni).where(where).orderBy(desc(iscrizioni.createdAt))
        : await tx.select().from(iscrizioni).orderBy(desc(iscrizioni.createdAt));
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(iscrizioni).where(eq(iscrizioni.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  app.post(
    '/:id/approve',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const body = z.object({ note: z.string().optional() }).safeParse(req.body ?? {});
      if (!body.success) return reply.badRequest(body.error.message);

      return req.dbTx(async (tx) => {
        const rows = await tx.select().from(iscrizioni).where(eq(iscrizioni.id, id)).limit(1);
        if (rows.length === 0) return reply.notFound();
        const isc = rows[0]!;
        if (isc.stato === 'APPROVATA' && isc.candidatoId) {
          return { ok: true, alreadyApproved: true, candidatoId: isc.candidatoId };
        }

        // Calcola numero candidato successivo per il concorso
        const next = await tx
          .select({ m: max(candidati.numeroCandidato) })
          .from(candidati)
          .where(eq(candidati.concorsoId, isc.concorsoId));
        const numero = (next[0]?.m ?? 0) + 1;

        const [candidato] = await tx
          .insert(candidati)
          .values({
            tenantId: req.tenant!.id,
            concorsoId: isc.concorsoId,
            numeroCandidato: numero,
            nome: isc.nome,
            cognome: isc.cognome,
            strumento: isc.strumento || 'N/D',
            dataNascita: isc.dataNascita,
            nazionalita: isc.nazionalita,
            docentiPreparatori: isc.docentiPreparatori as string[] | undefined,
            sezioneId: isc.sezioneId,
            categoriaId: isc.categoriaId,
            isGruppo: isc.isGruppo,
            dataIscrizione: new Date().toISOString().slice(0, 10),
          })
          .returning();

        const [updated] = await tx
          .update(iscrizioni)
          .set({
            stato: 'APPROVATA',
            candidatoId: candidato!.id,
            note: body.data.note,
            approvataAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(iscrizioni.id, id))
          .returning();

        await writeAudit(tx, req, 'iscrizione.approve', {
          targetType: 'iscrizione',
          targetId: id,
          payload: { candidatoId: candidato!.id, numero },
        });

        return { ok: true, iscrizione: updated, candidato };
      });
    },
  );

  app.post(
    '/:id/reject',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const body = z.object({ reason: z.string().max(500).optional() }).safeParse(req.body ?? {});
      if (!body.success) return reply.badRequest(body.error.message);
      return req.dbTx(async (tx) => {
        const [updated] = await tx
          .update(iscrizioni)
          .set({
            stato: 'RIFIUTATA',
            note: body.data.reason,
            updatedAt: new Date(),
          })
          .where(eq(iscrizioni.id, id))
          .returning();
        if (!updated) return reply.notFound();
        await writeAudit(tx, req, 'iscrizione.reject', {
          targetType: 'iscrizione',
          targetId: id,
          payload: { reason: body.data.reason },
        });
        return { ok: true, iscrizione: updated };
      });
    },
  );
};
