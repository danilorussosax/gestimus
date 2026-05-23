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
  app.post('/export', async (req, reply) => {
    // A2: streaming. Prima un Promise.all caricava TUTTE e 5 le tabelle in
    // memoria contemporaneamente (rischio OOM su tenant grandi). Ora scriviamo
    // la risposta JSON in modo incrementale, interrogando una tabella per
    // volta: il picco di memoria è la singola tabella più grande, non la somma.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gestimus-export.json"',
    });
    raw.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())}`);
    raw.write(`,"tenant":${JSON.stringify({ id: req.tenant!.id, slug: req.tenant!.slug, nome: req.tenant!.nome })}`);
    try {
      await req.dbTx(async (tx) => {
        const accountsList = await tx.select().from(accounts);
        raw.write(`,"accounts":${JSON.stringify(accountsList.map((a) => ({
          ...a,
          passwordHash: '[REDACTED]',
          totpSecret: a.totpSecret ? '[REDACTED]' : null,
          totpRecoveryCodes: a.totpRecoveryCodes ? '[REDACTED]' : null,
        })))}`);

        const commissariList = await tx.select().from(commissari);
        raw.write(`,"commissari":${JSON.stringify(commissariList)}`);

        const candidatiList = await tx.select().from(candidati);
        raw.write(`,"candidati":${JSON.stringify(candidatiList)}`);

        const membriList = await tx.select().from(candidatiMembri);
        raw.write(`,"candidatiMembri":${JSON.stringify(membriList)}`);

        // N4: emailVerificationToken redatto (segreto operativo).
        const iscrizioniList = await tx.select().from(iscrizioni);
        raw.write(`,"iscrizioni":${JSON.stringify(iscrizioniList.map((i) => ({
          ...i,
          emailVerificationToken: i.emailVerificationToken ? '[REDACTED]' : null,
        })))}`);

        await writeAudit(tx, req, 'privacy.export', {
          payload: {
            accounts: accountsList.length,
            commissari: commissariList.length,
            candidati: candidatiList.length,
            iscrizioni: iscrizioniList.length,
          },
        });
      });
      raw.write('}');
      raw.end();
    } catch (err) {
      req.log.error({ err }, 'privacy.export: errore durante lo streaming');
      // N104: header già inviati, non possiamo cambiare status. Se la
      // connessione è ancora aperta proviamo a chiudere con un marcatore
      // d'errore (il client rileva l'export incompleto); se la write fallisce
      // (client disconnesso) distruggiamo il socket invece di lasciar propagare
      // un'eccezione non catchata.
      if (!raw.writableEnded) {
        try {
          raw.write(',"_error":"export interrotto"}');
          raw.end();
        } catch {
          raw.destroy();
        }
      }
    }
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
    const touched = { commissari: 0, candidati: 0, candidatiMembri: 0, iscrizioni: 0, accounts: 0 };

    // N9: redaction COMPLETA di tutti i campi PII (prima ne restavano molti).
    const commissarioRedaction = {
      nome: REDACTED, cognome: REDACTED, email: null, telefono: null,
      dataNascita: null, nazionalita: null, foto: null, bio: null,
      stato: 'INATTIVO', updatedAt: new Date(),
    };
    const candidatoRedaction = {
      nome: REDACTED, cognome: REDACTED, email: null, telefono: null,
      sesso: null, dataNascita: null, nazionalita: null, luogoNascita: null,
      codiceFiscale: null, indirizzo: null, citta: null, cap: null,
      provincia: null, paese: null, anniStudio: null, scuolaProvenienza: null,
      strumento: REDACTED, foto: null, docentiPreparatori: null, programma: null,
      tutore: null, noteLibere: null, gruppoNome: null, updatedAt: new Date(),
    };
    // L'email NON è nell'oggetto: la settiamo per-riga con un valore univoco
    // (erased+<id>@erased.local) per non violare uniq_iscrizioni_concorso_email
    // quando si erasano più iscrizioni dello stesso concorso.
    const iscrizioneRedaction = {
      nome: REDACTED, cognome: REDACTED,
      telefono: null, dataNascita: null, nazionalita: null, luogoNascita: null,
      sesso: null, codiceFiscale: null, indirizzo: null, citta: null, cap: null,
      provincia: null, paese: null, strumento: null, anniStudio: null,
      scuolaProvenienza: null, programma: null, docentiPreparatori: null,
      membri: null, tutore: null, consensiGdpr: null, noteLibere: null,
      emailVerificationToken: null, gruppoNome: null, ipAddress: null,
      userAgent: null, updatedAt: new Date(),
    };
    const erasedEmail = (tbl: { id: unknown }) =>
      sql`'erased+' || ${tbl.id}::text || '@erased.local'`;

    return req.dbTx(async (tx) => {
      if (parsed.data.commissarioId) {
        const res = await tx
          .update(commissari)
          .set(commissarioRedaction)
          .where(eq(commissari.id, parsed.data.commissarioId))
          .returning();
        touched.commissari += res.length;
      }

      if (parsed.data.candidatoId) {
        const res = await tx
          .update(candidati)
          .set(candidatoRedaction)
          .where(eq(candidati.id, parsed.data.candidatoId))
          .returning();
        touched.candidati += res.length;
        const mem = await tx
          .update(candidatiMembri)
          .set({ nome: REDACTED, cognome: REDACTED, dataNascita: null, nazionalita: null })
          .where(eq(candidatiMembri.candidatoId, parsed.data.candidatoId))
          .returning();
        touched.candidatiMembri += mem.length;
      }

      if (parsed.data.iscrizioneId) {
        const res = await tx
          .update(iscrizioni)
          .set({ ...iscrizioneRedaction, email: erasedEmail(iscrizioni) })
          .where(eq(iscrizioni.id, parsed.data.iscrizioneId))
          .returning();
        touched.iscrizioni += res.length;
      }

      if (parsed.data.email) {
        const email = parsed.data.email.toLowerCase();
        const isc = await tx
          .update(iscrizioni)
          .set({ ...iscrizioneRedaction, email: erasedEmail(iscrizioni) })
          .where(sql`lower(${iscrizioni.email}) = ${email}`)
          .returning();
        touched.iscrizioni += isc.length;

        const com = await tx
          .update(commissari)
          .set(commissarioRedaction)
          .where(sql`lower(${commissari.email}) = ${email}`)
          .returning();
        touched.commissari += com.length;

        // N16: l'erase via email deve purgare anche i record `candidati` con
        // email corrispondente (un candidato può aver fornito PII sia via
        // iscrizione pubblica sia via creazione admin). Redact + membri gruppo.
        const cand = await tx
          .update(candidati)
          .set(candidatoRedaction)
          .where(sql`lower(${candidati.email}) = ${email}`)
          .returning();
        touched.candidati += cand.length;
        for (const c of cand) {
          const mem = await tx
            .update(candidatiMembri)
            .set({ nome: REDACTED, cognome: REDACTED, dataNascita: null, nazionalita: null })
            .where(eq(candidatiMembri.candidatoId, c.id))
            .returning();
          touched.candidatiMembri += mem.length;
        }

        // N29: l'erase via email deve anonimizzare anche l'account con quella
        // email (prima restava in chiaro → violazione del diritto all'oblio).
        // email → valore univoco per riga (vincolo unique tenant+email), account
        // disattivato, segreti TOTP azzerati.
        const acc = await tx
          .update(accounts)
          .set({
            email: erasedEmail(accounts),
            attivo: false,
            totpSecret: null,
            totpEnabled: false,
            totpRecoveryCodes: null,
            updatedAt: new Date(),
          })
          .where(sql`lower(${accounts.email}) = ${email}`)
          .returning();
        touched.accounts += acc.length;
      }

      // N137 (GDPR Art. 17): NON loggare i selettori nel payload (email,
      // commissarioId, candidatoId, iscrizioneId) — manterrebbero l'identità
      // della persona nell'audit dopo l'oblio. Logghiamo solo i conteggi.
      await writeAudit(tx, req, 'privacy.erase', {
        payload: { touched },
      });

      return { ok: true, touched };
    });
  });
};
