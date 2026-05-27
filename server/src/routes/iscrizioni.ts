import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { candidati, categorie, concorsi, iscrizioni, iscrizioniAllegati, sezioni } from '../db/schema.js';
import { saveFile } from '../services/storage.js';
import { readFile } from 'node:fs/promises';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { sendMail } from '../services/email.js';
import { env } from '../env.js';
import { parsePagination } from '../lib/pagination.js';
import { todayISODate, ageYears } from '../lib/date.js';
import { checkCandidatiLimit } from '../lib/plan-limits.js';
import { generateToken } from '../lib/token.js';
import { replyValidationError } from '../lib/validation.js';

const uuid = z.string().uuid();

const iscrizioneCreateBody = z.object({
  concorsoId: uuid,
  // Anti-spam — STESSI nomi del form pubblico (js/views/iscrizione.js) per
  // evitare mismatch silenziosi: `website` è l'honeypot (nome innocuo che i bot
  // tendono a compilare; se valorizzato → bot), `startedAt` è il timestamp di
  // apertura del form (min-time-on-page).
  // N85: l'honeypot NON deve usare .max(0). Una stringa non vuota va accettata
  // da Zod e gestita dal check silenzioso (200) più sotto; con .max(0) il bot
  // riceve un 400 rumoroso e capisce di essere stato scoperto, vanificando la
  // trappola. Bound a 255 per evitare input non limitato.
  website: z.string().max(255).optional(),
  startedAt: z.coerce.number().int().optional(),
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
  // Programma musicale: input pubblico anonimo → schema delimitato (era
  // z.unknown(): accettava JSON arbitrario, vettore di abuso storage/DoS).
  // Rispecchia il contratto del form (programmaRow) ma lenient: z.object
  // scarta i campi extra, coerce sulla durata. Bound: 200 brani.
  programma: z
    .array(
      z.object({
        titolo: z.string().max(500),
        autore: z.string().max(300).optional(),
        durata_min: z.coerce.number().min(0).max(600).optional(),
      }),
    )
    .max(200)
    .optional(),
  docentiPreparatori: z.array(z.string()).optional(),
  sezioneId: uuid.optional(),
  categoriaId: uuid.optional(),
  isGruppo: z.boolean().optional(),
  gruppoNome: z.string().max(255).optional(),
  tipoGruppo: z.enum(['ensemble', 'orchestra']).optional(),
  membri: z.array(z.unknown()).optional(),
  // N86: oggetto tipizzato (era z.unknown()). La presenza di contenuto reale
  // per i minori è verificata nel business logic (un {} vuoto è truthy e
  // bypassava `!data.tutore`).
  tutore: z
    .object({
      nome: z.string().max(255).optional(),
      cognome: z.string().max(255).optional(),
      email: z.string().email().optional(),
      telefono: z.string().max(50).optional(),
    })
    .optional(),
  // N40: i consensi obbligatori (privacy + regolamento) DEVONO essere true.
  // Prima era z.unknown() + check `if (!data.consensiGdpr)` → un payload
  // { consensiGdpr: { privacy: false } } passava, bypassando il consenso GDPR.
  // `immagini` resta opzionale (consenso facoltativo all'uso immagini).
  consensiGdpr: z.object({
    privacy: z.literal(true),
    regolamento: z.literal(true),
    immagini: z.boolean().optional(),
  }).passthrough(),
  noteLibere: z.string().max(2000).optional(),
});

// #11: email di verifica bilingue. Il form pubblico è localizzato (it/en) ma il
// server non aveva modo di sapere la lingua dell'utente → l'email era hardcoded
// in italiano. Selezioniamo la lingua dall'header Accept-Language inviato dal
// browser: 'en*' → inglese, qualsiasi altro → italiano (mercato primario).
type EmailLang = 'it' | 'en';

function pickEmailLang(acceptLanguage: string | undefined): EmailLang {
  return acceptLanguage && /^\s*en\b/i.test(acceptLanguage) ? 'en' : 'it';
}

// Costruisce l'URL di verifica (frontend hash-route che esegue la POST /verify).
// N27: base URL da env (non spoofabile) se configurata; altrimenti dagli header.
function buildVerifyUrl(req: FastifyRequest, token: string): string {
  let baseUrl: string;
  if (env.PUBLIC_BASE_URL) {
    baseUrl = env.PUBLIC_BASE_URL.replace(/\{tenant\}/g, req.tenant!.slug).replace(/\/$/, '');
  } else {
    const host = req.headers.host ?? '';
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    baseUrl = `${proto}://${host}`;
  }
  return `${baseUrl}/#/iscrizione/verify?t=${encodeURIComponent(token)}`;
}

function verifyEmailContent(lang: EmailLang, verifyUrl: string): { subject: string; text: string; html: string } {
  if (lang === 'en') {
    return {
      subject: 'Confirm your registration',
      text: `Thank you for registering.\n\nConfirm your email address by opening this link:\n${verifyUrl}\n\nIf you did not request this registration, please ignore this message.`,
      html: `<p>Thank you for registering.</p><p>Confirm your email address by clicking the link below:</p><p><a href="${verifyUrl}">Confirm registration</a></p><p style="color:#888;font-size:12px">If you did not request this registration, please ignore this message.</p>`,
    };
  }
  return {
    subject: 'Conferma la tua iscrizione',
    text: `Grazie per la tua iscrizione.\n\nConferma il tuo indirizzo email aprendo questo link:\n${verifyUrl}\n\nSe non hai richiesto questa iscrizione, ignora questo messaggio.`,
    html: `<p>Grazie per la tua iscrizione.</p><p>Conferma il tuo indirizzo email cliccando il link qui sotto:</p><p><a href="${verifyUrl}">Conferma iscrizione</a></p><p style="color:#888;font-size:12px">Se non hai richiesto questa iscrizione, ignora questo messaggio.</p>`,
  };
}

// Invia (best-effort) l'email di verifica. Usata sia alla creazione sia dal
// resend. H10: il token non è MAI restituito nella risposta HTTP, solo via email.
async function sendVerificationEmail(req: FastifyRequest, to: string, token: string): Promise<void> {
  const c = verifyEmailContent(pickEmailLang(req.headers['accept-language']), buildVerifyUrl(req, token));
  await sendMail({ tenantId: req.tenant!.id, to, subject: c.subject, text: c.text, html: c.html });
}

const MIN_TIME_ON_PAGE_MS = 3000;
// R15: tutore obbligatorio per TUTTI i minori (< 18). In Italia la partecipazione
// a un concorso e il relativo trattamento dati di un minore richiedono il consenso
// di chi esercita la responsabilità genitoriale fino ai 18 anni (non solo i 16
// dell'età di consenso digitale GDPR Art. 8).
const GDPR_MIN_AGE_TUTORE = 18;

// =====================================================================
// Plugin PUBBLICO: niente auth, niente requireTenant — ma tenant è risolto
// dal subdomain (middleware globale). Rate-limit applicato per-route.
// =====================================================================
export const iscrizioniPublicRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /public/concorsi → concorsi del tenant con iscrizioni aperte e non scadute.
   * Niente auth, ma serve tenant context (subdomain).
   */
  app.get('/concorsi', {
    // R15: endpoint pubblico (no auth) → rate-limit per-IP contro scraping/enumerazione.
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    return req.dbTx(async (tx) => {
      const today = todayISODate();
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
  app.get('/concorsi/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
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
        rateLimit: { max: 3, timeWindow: '1 hour', errorResponseBuilder: () => ({ statusCode: 429, error: 'troppe iscrizioni dallo stesso IP, riprova più tardi' }) },
      },
    },
    async (req, reply) => {
      if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });

      const parsed = iscrizioneCreateBody.safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, req, parsed.error);
      const data = parsed.data;

      // Honeypot (campo `website`, vedi schema): se compilato → bot.
      if (data.website && data.website.length > 0) {
        // Risponde 200 senza fare nulla → bot non insiste
        return { ok: true, queued: true };
      }
      // Min time on page (anti-bot rapido). N92: è "troppo rapido" solo un
      // elapsed in [0, MIN). Un elapsed negativo = orologio del client avanti
      // rispetto al server (clock skew) → non bloccare l'utente legittimo.
      if (data.startedAt) {
        const elapsed = Date.now() - data.startedAt;
        if (elapsed >= 0 && elapsed < MIN_TIME_ON_PAGE_MS) {
          return reply.code(400).send({ error: 'invio troppo rapido' });
        }
      }

      // GDPR: se candidato minorenne, tutore obbligatorio (check puro, no DB).
      if (data.dataNascita) {
        // M191: età calcolata sul fuso della piattaforma (helper TZ-safe), non
        // con `new Date()` del processo — il confronto a cavallo di mezzanotte
        // poteva sfasare di un anno il giorno del compleanno.
        const age = ageYears(data.dataNascita);
        // N86: {} è truthy → `!data.tutore` non bastava. Per i minori il tutore
        // deve avere almeno nome ed email (contattabilità GDPR del genitore).
        const tutoreOk =
          !!data.tutore &&
          (data.tutore.nome?.trim().length ?? 0) > 0 &&
          (data.tutore.email?.trim().length ?? 0) > 0;
        if (age < GDPR_MIN_AGE_TUTORE && !tutoreOk) {
          return reply.code(400).send({ error: 'candidato minorenne: dati tutore (nome ed email) richiesti' });
        }
      }
      // N91: nessun check `if (!data.consensiGdpr)` — irraggiungibile, lo schema
      // Zod richiede già consensiGdpr.privacy/regolamento === true.

      // N102 + N95: TUTTI i check su DB e l'INSERT in UNA sola transazione, con
      // SELECT … FOR UPDATE sulla riga del concorso:
      //  - chiude la TOCTOU (N102): il concorso non può essere chiuso/archiviato
      //    tra il check di apertura e l'INSERT (un UPDATE concorrente sul
      //    concorso attende il nostro commit);
      //  - serializza le iscrizioni con stessa email sullo stesso concorso (N95):
      //    due richieste concorrenti contendono lo stesso row-lock, la seconda
      //    vede l'iscrizione della prima → 409 deterministico (l'indice unique
      //    parziale uniq_iscrizioni_concorso_email_active resta la rete finale).
      const emailToken = generateToken();
      // Token capability per l'upload allegati: torna nella risposta 201 e
      // autorizza SOLO il caricamento di file su questa iscrizione.
      const uploadToken = generateToken();
      // #6: il token di upload scade dopo 72h → un token leakato non dà accesso
      // permanente. Verificata nell'endpoint di upload (now > expiry → 404).
      const uploadTokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const todayStr = todayISODate();
      const outcome = await req.dbTx(async (tx) => {
        const crows = await tx
          .select({
            iscrizioniAperte: concorsi.iscrizioniAperte,
            iscrizioniScadenza: concorsi.iscrizioniScadenza,
          })
          .from(concorsi)
          .where(eq(concorsi.id, data.concorsoId))
          .limit(1)
          .for('update');
        if (crows.length === 0) return { kind: 'notfound' as const };
        const c = crows[0]!;
        if (!c.iscrizioniAperte) return { kind: 'closed' as const, stato: 'CHIUSE' };
        if (c.iscrizioniScadenza && String(c.iscrizioniScadenza) < todayStr) {
          return { kind: 'closed' as const, stato: 'SCADUTE' };
        }

        // N26/N32: duplicato email (escluse le RIFIUTATA) — sotto il lock del
        // concorso, quindi senza più la race tra check e INSERT.
        const dupe = await tx
          .select({ id: iscrizioni.id })
          .from(iscrizioni)
          .where(
            and(
              eq(iscrizioni.concorsoId, data.concorsoId),
              sql`lower(${iscrizioni.email}) = ${data.email.toLowerCase()}`,
              sql`${iscrizioni.stato} <> 'RIFIUTATA'`,
            ),
          )
          .limit(1);
        if (dupe.length > 0) return { kind: 'dupe' as const };

        // Gerarchia categoria→sezione + cross-concorso: il backend è l'ultimo
        // guardiano (il client può manomettere il payload). Se manca la sezione
        // ma c'è la categoria → la deriviamo.
        let sezioneId = data.sezioneId;
        const categoriaId = data.categoriaId;
        if (sezioneId) {
          const checkSez = await tx
            .select({ concorsoId: sezioni.concorsoId })
            .from(sezioni).where(eq(sezioni.id, sezioneId)).limit(1);
          if (checkSez.length === 0 || checkSez[0]!.concorsoId !== data.concorsoId) {
            return { kind: 'badreq' as const, msg: 'sezione non appartenente al concorso' };
          }
        }
        if (categoriaId) {
          const checkCat = await tx
            .select({ sezioneId: categorie.sezioneId })
            .from(categorie).where(eq(categorie.id, categoriaId)).limit(1);
          if (checkCat.length === 0) return { kind: 'badreq' as const, msg: 'categoria non trovata' };
          const catSezId = checkCat[0]!.sezioneId;
          if (sezioneId && catSezId !== sezioneId) {
            return { kind: 'badreq' as const, msg: 'la categoria non appartiene alla sezione scelta' };
          }
          if (!sezioneId) {
            sezioneId = catSezId;
            const checkCatConcorso = await tx
              .select({ concorsoId: sezioni.concorsoId })
              .from(sezioni).where(eq(sezioni.id, catSezId!)).limit(1);
            if (checkCatConcorso.length === 0 || checkCatConcorso[0]!.concorsoId !== data.concorsoId) {
              return { kind: 'badreq' as const, msg: 'la categoria non appartiene al concorso' };
            }
          }
        }

        const [row] = await tx
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
            uploadToken,
            uploadTokenExpiresAt,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          })
          .returning();

        await writeAudit(tx, req, 'iscrizione.create_public', {
          targetType: 'iscrizione',
          targetId: row!.id,
          payload: { email: row!.email },
        });
        return { kind: 'ok' as const, row: row! };
      });

      if (outcome.kind === 'notfound') return reply.notFound();
      if (outcome.kind === 'closed') return reply.code(403).send({ error: `iscrizioni ${outcome.stato}` });
      if (outcome.kind === 'badreq') return reply.code(400).send({ error: outcome.msg });
      if (outcome.kind === 'dupe') {
        return reply.code(409).send({ error: 'esiste già un\'iscrizione con questa email per il concorso' });
      }
      const created = outcome.row;

      // H11: invia email di verifica DOPO il commit (niente SMTP I/O dentro la
      // transazione). Best-effort: un fallimento SMTP non annulla l'iscrizione,
      // il record è salvato e l'utente può richiedere il re-invio via
      // POST /public/iscrizioni/resend-verify (#2). H10: il token NON viene mai
      // restituito nella risposta HTTP, in nessun ambiente.
      try {
        await sendVerificationEmail(req, created.email, emailToken);
      } catch (e) {
        req.log.warn({ err: e, iscrizioneId: created.id }, 'email send failed (iscrizione verify)');
      }

      // uploadToken capability → il client carica gli allegati subito dopo.
      return reply.code(201).send({ ok: true, iscrizioneId: created.id, uploadToken });
    },
  );

  /**
   * POST /public/iscrizioni/resend-verify — re-invia l'email di verifica.
   * #2: prima l'email di verifica era fire-and-forget — un fallimento SMTP
   * (provider down, greylisting, ecc.) rendeva l'iscrizione irrecuperabile per
   * l'utente, senza modo di rigenerare il link. Qui l'utente la richiede di
   * nuovo identificandosi con i dati che conosce (concorso + email); il token
   * viene rigenerato e re-inviato, mai esposto nella risposta. Anti-enumeration:
   * risponde sempre 200 { ok:true }, anche se l'iscrizione non esiste o è già
   * verificata. Rate-limit per IP contro abuso/scraping.
   */
  app.post('/iscrizioni/resend-verify', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
        errorResponseBuilder: () => ({ statusCode: 429, error: 'troppe richieste, riprova più tardi' }),
      },
    },
  }, async (req, reply) => {
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    const parsed = z.object({ concorsoId: uuid, email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);
    const emailLower = parsed.data.email.toLowerCase();

    // Rigenera il token SOLO se esiste un'iscrizione non-RIFIUTATA e non ancora
    // verificata per (concorso, email). FOR UPDATE serializza re-invii concorrenti.
    const newToken = generateToken();
    const target = await req.dbTx(async (tx) => {
      const rows = await tx
        .select({ id: iscrizioni.id, emailVerifiedAt: iscrizioni.emailVerifiedAt })
        .from(iscrizioni)
        .where(
          and(
            eq(iscrizioni.concorsoId, parsed.data.concorsoId),
            sql`lower(${iscrizioni.email}) = ${emailLower}`,
            sql`${iscrizioni.stato} <> 'RIFIUTATA'`,
          ),
        )
        .limit(1)
        .for('update');
      if (rows.length === 0) return null;
      const isc = rows[0]!;
      if (isc.emailVerifiedAt) return null; // già verificata: niente da re-inviare
      await tx
        .update(iscrizioni)
        .set({ emailVerificationToken: newToken, updatedAt: new Date() })
        .where(eq(iscrizioni.id, isc.id));
      return { id: isc.id };
    });

    // Invio fuori transazione (best-effort). Se non c'è target NON inviamo, ma
    // rispondiamo comunque 200 (anti-enumeration). Il rate-limit (5/h) smorza
    // qualsiasi side-channel di timing sull'esistenza dell'iscrizione.
    if (target) {
      try {
        await sendVerificationEmail(req, emailLower, newToken);
      } catch (e) {
        req.log.warn({ err: e, iscrizioneId: target.id }, 'email send failed (resend verify)');
      }
    }
    return { ok: true };
  });

  /**
   * POST /public/iscrizioni/:uploadToken/allegati — upload allegato (no-auth).
   * Capability: il token autorizza SOLO questa iscrizione. Difese: rate-limit,
   * cap 6 allegati/iscrizione, validazione mime+magic-byte+size in saveFile.
   * I file finiscono sotto uploads/<tenant>/iscrizione/<id>/ → NON serviti come
   * statici (BLOCKED_STATIC): scaricabili solo via endpoint admin.
   */
  app.post(
    '/iscrizioni/:uploadToken/allegati',
    {
      config: {
        rateLimit: { max: 20, timeWindow: '1 hour', errorResponseBuilder: () => ({ statusCode: 429, error: 'troppi upload, riprova più tardi' }) },
      },
    },
    async (req, reply) => {
      const { uploadToken } = z.object({ uploadToken: z.string().min(10).max(200) }).parse(req.params);
      const { tipo } = z.object({ tipo: z.enum(['foto', 'documento', 'ricevuta', 'altro']) }).parse(req.query);
      return req.dbTx(async (tx) => {
        const isc = await tx
          .select({ id: iscrizioni.id, uploadTokenExpiresAt: iscrizioni.uploadTokenExpiresAt })
          .from(iscrizioni)
          .where(eq(iscrizioni.uploadToken, uploadToken))
          .limit(1);
        if (isc.length === 0) return reply.notFound();
        // #6: rifiuta token scaduto o senza scadenza registrata (now > expiry).
        // 404 (non 401): non riveliamo l'esistenza dell'iscrizione a chi presenta
        // un token non più valido — stesso comportamento del token inesistente.
        const expiresAt = isc[0]!.uploadTokenExpiresAt;
        if (!expiresAt || Date.now() > expiresAt.getTime()) return reply.notFound();
        const iscId = isc[0]!.id;
        const existing = await tx
          .select({ id: iscrizioniAllegati.id })
          .from(iscrizioniAllegati)
          .where(eq(iscrizioniAllegati.iscrizioneId, iscId));
        if (existing.length >= 6) return reply.code(409).send({ error: 'numero massimo di allegati raggiunto' });

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
            resource: 'iscrizione',
            id: iscId,
            buffer,
            mimeType: file.mimetype,
            originalFilename: file.filename,
          });
        } catch (err) {
          const e = err as { code?: string; message?: string };
          if (e.code === 'UNSUPPORTED_MIME') return reply.code(415).send({ error: e.message });
          if (e.code === 'MIME_MISMATCH') return reply.code(415).send({ error: e.message });
          if (e.code === 'FILE_TOO_LARGE') return reply.code(413).send({ error: e.message });
          throw err;
        }
        await tx.insert(iscrizioniAllegati).values({
          tenantId: req.tenant!.id,
          iscrizioneId: iscId,
          tipo,
          nomeFile: file.filename,
          path: stored.path,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        });
        return reply.code(201).send({ ok: true });
      });
    },
  );

  /**
   * POST /public/iscrizioni/:token/verify — verifica email.
   * M194: POST (non GET) → cambia stato DB, non deve essere attivabile da una
   * GET passiva (prefetch/scanner di posta, tag <img>). Il link email punta al
   * frontend (#/iscrizione/verify?t=…) che esegue la POST via JS.
   */
  app.post('/iscrizioni/:token/verify', {
    // H2: rate limit brute-force token (20 tentativi/15 min/IP). Token a 40 hex
    // sono già praticamente immuni, il limite ne smorza solo la pesantezza in
    // caso di scan automatico.
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({ statusCode: 429, error: 'troppi tentativi, riprova più tardi' }),
      },
    },
  }, async (req, reply) => {
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
      // N17: endpoint pubblico (non autenticato). Ritorna solo conferma minimale
      // invece dell'intero record (che contiene email/telefono/indirizzo/...).
      // Minimo privilegio: chi ha il token non deve ricevere tutti i PII.
      return { ok: true, iscrizioneId: updated!.id };
    });
  });
};

// =====================================================================
// Plugin ADMIN: lista, approve, reject. Richiede auth + role=admin.
// =====================================================================
export const iscrizioniAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  // N115: l'intero gruppo (lista/dettaglio inclusi) espone PII dei candidati
  // (email, telefono, indirizzo, data nascita) → solo admin. Prima GET / e
  // GET /:id richiedevano solo auth, quindi un commissario leggeva tutte le PII.
  app.addHook('preHandler', requireRole('admin'));

  // Allegati di un'iscrizione: metadata (no path filesystem nel payload).
  app.get('/:id/allegati', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) =>
      tx
        .select({
          id: iscrizioniAllegati.id,
          tipo: iscrizioniAllegati.tipo,
          nomeFile: iscrizioniAllegati.nomeFile,
          sizeBytes: iscrizioniAllegati.sizeBytes,
          mimeType: iscrizioniAllegati.mimeType,
          createdAt: iscrizioniAllegati.createdAt,
        })
        .from(iscrizioniAllegati)
        .where(eq(iscrizioniAllegati.iscrizioneId, id))
        .orderBy(iscrizioniAllegati.createdAt),
    );
  });

  // Download di un allegato: SOLO admin (i documenti sono privati, non statici).
  // Lo streaming via buffer va bene: i file sono cappati a UPLOADS_MAX_FILE_SIZE_MB.
  app.get('/allegati/:id/download', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx
        .select()
        .from(iscrizioniAllegati)
        .where(eq(iscrizioniAllegati.id, id))
        .limit(1);
      if (rows.length === 0) return reply.notFound();
      const a = rows[0]!;
      const buf = await readFile(a.path).catch(() => null);
      if (!buf) return reply.notFound();
      const safeName = (a.nomeFile || 'allegato').replace(/[^\w.\-]+/g, '_');
      reply.header('Content-Type', a.mimeType || 'application/octet-stream');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
      return reply.send(buf);
    });
  });

  app.get('/', async (req) => {
    const q = z
      .object({ concorsoId: uuid.optional(), stato: z.string().optional() })
      .parse(req.query);
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => {
      const conditions = [];
      if (q.concorsoId) conditions.push(eq(iscrizioni.concorsoId, q.concorsoId));
      if (q.stato) conditions.push(eq(iscrizioni.stato, q.stato));
      const where = conditions.length ? and(...conditions) : undefined;
      const base = tx.select().from(iscrizioni).$dynamic();
      const withWhere = where ? base.where(where) : base;
      return withWhere.orderBy(desc(iscrizioni.createdAt)).limit(limit).offset(offset);
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
      if (!body.success) return replyValidationError(reply, req, body.error);

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

        // #5 TOCTOU + N112: il lock advisory per-concorso DEVE precedere il check
        // del limite di piano. Altrimenti due approve (o un approve + un create
        // diretto) leggono entrambi count<limit prima dell'INSERT e sforano il
        // tetto. hashtextextended (64-bit) — DEVE restare identico a candidati.ts
        // (stesso lock condiviso: serializza sia numeroCandidato sia il
        // conteggio→insert tra create diretto e approve sul concorso).
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${isc.concorsoId}::text, 0))`,
        );

        // R15: approvare un'iscrizione CREA un candidato → deve rispettare il
        // limite di piano per concorso, esattamente come il create diretto
        // (candidati.ts). Il check gira ORA sotto il lock → il conteggio non può
        // essere superato da una create/approve concorrente.
        const limitErr = await checkCandidatiLimit(tx, req.tenant!.id, isc.concorsoId);
        if (limitErr) return reply.code(403).send({ error: limitErr });

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
            dataIscrizione: todayISODate(),
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
      if (!body.success) return replyValidationError(reply, req, body.error);
      return req.dbTx(async (tx) => {
        // N111: non si rifiuta un'iscrizione già APPROVATA — l'approvazione ha
        // creato il candidato collegato; un reject lo lascerebbe orfano con stato
        // incoerente. Lock pessimistico per evitare la race con un approve
        // concorrente.
        const existing = await tx
          .select({ stato: iscrizioni.stato })
          .from(iscrizioni)
          .where(eq(iscrizioni.id, id))
          .limit(1)
          .for('update');
        if (existing.length === 0) return reply.notFound();
        if (existing[0]!.stato === 'APPROVATA') {
          return reply.code(409).send({ error: 'iscrizione già approvata: revocare l\'approvazione prima di rifiutare' });
        }
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
