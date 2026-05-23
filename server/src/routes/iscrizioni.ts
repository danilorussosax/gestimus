import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';
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
  dataNascita: z
    .string()
    .date()
    .refine((d) => new Date(d) <= new Date(), {
      message: 'data di nascita futura non valida',
    })
    .refine((d) => new Date(d) >= new Date('1900-01-01'), {
      message: 'data di nascita troppo lontana nel passato',
    })
    .optional(),
  nazionalita: z.string().max(100).optional(),
  // Anagrafica estesa (opzionali — il form pubblico li raccoglie se presenti)
  luogoNascita: z.string().max(255).optional(),
  sesso: z.string().max(20).optional(),
  codiceFiscale: z.string().max(32).optional(),
  // Residenza
  indirizzo: z.string().max(255).optional(),
  citta: z.string().max(120).optional(),
  cap: z.string().max(16).optional(),
  provincia: z.string().max(64).optional(),
  paese: z.string().max(100).optional(),
  // Dati artistici extra
  strumento: z.string().max(255).optional(),
  anniStudio: z.number().int().min(0).max(99).optional(),
  scuolaProvenienza: z.string().max(255).optional(),
  programma: z.unknown().optional(),
  docentiPreparatori: z.array(z.string()).optional(),
  sezioneId: uuid.optional(),
  categoriaId: uuid.optional(),
  isGruppo: z.boolean().optional(),
  gruppoNome: z.string().max(255).optional(),
  tipoGruppo: z.enum(['ensemble', 'orchestra']).optional(),
  membri: z.array(z.unknown()).optional(),
  tutore: z.unknown().optional(),
  consensiGdpr: z.unknown(),
  noteLibere: z.string().max(2000).optional(),
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
        ? await tx.select().from(categorie).where(inArray(categorie.sezioneId, sezIds))
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

      // Gerarchia categoria→sezione + cross-concorso check anche per il form
      // pubblico: il backend è l'ultimo guardiano (il client può manomettere il
      // payload). Se viene scelta una categoria di un'altra sezione/concorso
      // → 400. Se manca la sezione ma c'è la categoria → la deriviamo.
      let sezioneId = data.sezioneId;
      const categoriaId = data.categoriaId;
      if (sezioneId) {
        const checkSez = await req.dbTx(async (tx) =>
          tx.select({ concorsoId: sezioni.concorsoId }).from(sezioni).where(eq(sezioni.id, sezioneId!)).limit(1),
        );
        if (checkSez.length === 0 || checkSez[0]!.concorsoId !== data.concorsoId) {
          return reply.code(400).send({ error: 'sezione non appartenente al concorso' });
        }
      }
      if (categoriaId) {
        const checkCat = await req.dbTx(async (tx) =>
          tx.select({ sezioneId: categorie.sezioneId }).from(categorie).where(eq(categorie.id, categoriaId)).limit(1),
        );
        if (checkCat.length === 0) {
          return reply.code(400).send({ error: 'categoria non trovata' });
        }
        const catSezId = checkCat[0]!.sezioneId;
        if (sezioneId && catSezId !== sezioneId) {
          return reply.code(400).send({ error: 'la categoria non appartiene alla sezione scelta' });
        }
        if (!sezioneId) {
          // Auto-derive: l'utente ha scelto solo la categoria — propaga sezione
          sezioneId = catSezId;
          const checkCatConcorso = await req.dbTx(async (tx) =>
            tx.select({ concorsoId: sezioni.concorsoId }).from(sezioni).where(eq(sezioni.id, catSezId)).limit(1),
          );
          if (checkCatConcorso.length === 0 || checkCatConcorso[0]!.concorsoId !== data.concorsoId) {
            return reply.code(400).send({ error: 'la categoria non appartiene al concorso' });
          }
        }
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
            luogoNascita: data.luogoNascita,
            sesso: data.sesso,
            codiceFiscale: data.codiceFiscale,
            indirizzo: data.indirizzo,
            citta: data.citta,
            cap: data.cap,
            provincia: data.provincia,
            paese: data.paese,
            strumento: data.strumento,
            anniStudio: data.anniStudio,
            scuolaProvenienza: data.scuolaProvenienza,
            programma: data.programma as object | undefined,
            docentiPreparatori: data.docentiPreparatori,
            sezioneId,
            categoriaId,
            isGruppo: data.isGruppo ?? false,
            gruppoNome: data.gruppoNome,
            tipoGruppo: data.tipoGruppo,
            membri: data.membri as object | undefined,
            tutore: data.tutore as object | undefined,
            consensiGdpr: data.consensiGdpr as object,
            noteLibere: data.noteLibere,
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
        // Lock pessimistico sulla riga iscrizione → previene doppia approvazione
        // concorrente; lock advisory transazionale sul concorso → serializza il
        // calcolo del prossimo numeroCandidato evitando duplicate-key clash.
        const rows = await tx
          .select()
          .from(iscrizioni)
          .where(eq(iscrizioni.id, id))
          .limit(1)
          .for('update');
        if (rows.length === 0) return reply.notFound();
        const isc = rows[0]!;
        if (isc.stato === 'APPROVATA' && isc.candidatoId) {
          return { ok: true, alreadyApproved: true, candidatoId: isc.candidatoId };
        }

        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${isc.concorsoId}::text))`,
        );

        // Calcola numero candidato successivo per il concorso (sotto lock)
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
            // Anagrafica/residenza/artistici estesi: propaghiamo tutto al
            // candidato così l'admin può vedere/modificare gli stessi dati
            // raccolti dal form pubblico, senza dover aprire l'iscrizione.
            email: isc.email,
            telefono: isc.telefono,
            sesso: isc.sesso,
            luogoNascita: isc.luogoNascita,
            codiceFiscale: isc.codiceFiscale,
            indirizzo: isc.indirizzo,
            citta: isc.citta,
            cap: isc.cap,
            provincia: isc.provincia,
            paese: isc.paese,
            anniStudio: isc.anniStudio,
            scuolaProvenienza: isc.scuolaProvenienza,
            docentiPreparatori: isc.docentiPreparatori as string[] | undefined,
            programma: isc.programma as object | undefined,
            tutore: isc.tutore as object | undefined,
            noteLibere: isc.noteLibere,
            sezioneId: isc.sezioneId,
            categoriaId: isc.categoriaId,
            isGruppo: isc.isGruppo,
            gruppoNome: isc.gruppoNome,
            tipoGruppo: isc.tipoGruppo,
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
