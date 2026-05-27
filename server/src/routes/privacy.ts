import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  accounts,
  auditLog,
  candidati,
  candidatiMembri,
  commissari,
  iscrizioni,
  iscrizioniAllegati,
} from '../db/schema.js';
import { deleteFile } from '../services/storage.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { TxClient } from '../middleware/tenant.js';
import { writeAudit, computeAuditLogSig } from '../services/audit.js';
import { dbSuper } from '../db/client.js';
import { replyValidationError } from '../lib/validation.js';

// R15: scrub ricorsivo dell'email dell'interessato da un payload audit. Rimuove
// qualunque CHIAVE il cui valore è l'email (a qualsiasi profondità, non solo la
// top-level `email`) e reda le occorrenze dell'email dentro gli array. Le email
// possono finire annidate o sotto chiavi diverse (es. `to`, `adminEmail`).
function scrubEmailDeep(value: unknown, email: string): unknown {
  if (typeof value === 'string') {
    return value.toLowerCase() === email ? '[redacted]' : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubEmailDeep(v, email));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.toLowerCase() === email) continue; // droppa la chiave
      out[k] = scrubEmailDeep(v, email);
    }
    return out;
  }
  return value;
}

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
          uploadToken: i.uploadToken ? '[REDACTED]' : null,
        })))}`);

        // Allegati (metadata, no path filesystem): elenco dei file forniti.
        const allegatiList = await tx
          .select({
            id: iscrizioniAllegati.id,
            iscrizioneId: iscrizioniAllegati.iscrizioneId,
            tipo: iscrizioniAllegati.tipo,
            nomeFile: iscrizioniAllegati.nomeFile,
            sizeBytes: iscrizioniAllegati.sizeBytes,
            mimeType: iscrizioniAllegati.mimeType,
            createdAt: iscrizioniAllegati.createdAt,
          })
          .from(iscrizioniAllegati);
        raw.write(`,"iscrizioniAllegati":${JSON.stringify(allegatiList)}`);

        // R15 (GDPR Art.15): include anche le registrazioni di trattamento
        // (audit_log) del tenant — diritto di accesso completo. Gira sotto RLS
        // → solo le righe del tenant corrente. `sig` (HMAC tamper-evidence) e
        // ip/userAgent fanno parte del record di trattamento.
        //
        // A2/Perf: audit_log è la tabella potenzialmente più grande. Prima un
        // SELECT * la caricava INTERA in un array (rischio OOM). Ora iteriamo in
        // chunk con keyset pagination su `id` (uuidv7 = monotòno crescente,
        // ordine stabile, niente OFFSET costoso) e scriviamo ogni chunk
        // incrementalmente nell'array JSON. L'export resta COMPLETO: il loop
        // continua finché un chunk torna pieno, quindi non si tronca nulla; il
        // picco di memoria è un solo chunk, non l'intera tabella.
        const AUDIT_CHUNK = 1000;
        raw.write(',"auditLog":[');
        let auditCount = 0;
        let cursor: string | null = null;
        for (;;) {
          const where = cursor ? gt(auditLog.id, cursor) : undefined;
          const chunk: Array<typeof auditLog.$inferSelect> = await tx
            .select()
            .from(auditLog)
            .where(where)
            .orderBy(asc(auditLog.id))
            .limit(AUDIT_CHUNK);
          if (chunk.length === 0) break;
          for (const row of chunk) {
            raw.write(`${auditCount === 0 ? '' : ','}${JSON.stringify(row)}`);
            auditCount += 1;
          }
          if (chunk.length < AUDIT_CHUNK) break;
          cursor = chunk[chunk.length - 1]!.id;
        }
        raw.write(']');

        await writeAudit(tx, req, 'privacy.export', {
          payload: {
            accounts: accountsList.length,
            commissari: commissariList.length,
            candidati: candidatiList.length,
            iscrizioni: iscrizioniList.length,
            auditLog: auditCount,
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
    if (!req.tenant) return reply.code(400).send({ error: 'tenant context richiesto' });
    const parsed = erasureBody.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, req, parsed.error);

    const REDACTED = '[ERASED]';
    const touched = { commissari: 0, candidati: 0, candidatiMembri: 0, iscrizioni: 0, accounts: 0, allegati: 0 };

    // GDPR: l'erase di un'iscrizione deve cancellare anche i file allegati
    // (documenti sensibili) dal disco + le righe. Best-effort sul filesystem.
    const purgeAllegati = async (tx: TxClient, iscrizioneIds: string[]) => {
      if (iscrizioneIds.length === 0) return;
      const rows = await tx
        .select({ id: iscrizioniAllegati.id, path: iscrizioniAllegati.path })
        .from(iscrizioniAllegati)
        .where(inArray(iscrizioniAllegati.iscrizioneId, iscrizioneIds));
      for (const r of rows) {
        try { await deleteFile(r.path); } catch { /* file già assente: ok */ }
      }
      if (rows.length > 0) {
        await tx.delete(iscrizioniAllegati).where(inArray(iscrizioniAllegati.iscrizioneId, iscrizioneIds));
        touched.allegati += rows.length;
      }
    };

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

    const result = await req.dbTx(async (tx) => {
      // N183: account della persona (per scrubbare ip/userAgent dalle sue azioni
      // nell'audit). Popolato dai path commissarioId/email.
      const erasedAccountIds: string[] = [];
      if (parsed.data.commissarioId) {
        const res = await tx
          .update(commissari)
          .set(commissarioRedaction)
          .where(eq(commissari.id, parsed.data.commissarioId))
          .returning();
        touched.commissari += res.length;
        const linked = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.commissarioId, parsed.data.commissarioId));
        erasedAccountIds.push(...linked.map((a) => a.id));
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
        await purgeAllegati(tx, [parsed.data.iscrizioneId]);
      }

      if (parsed.data.email) {
        const email = parsed.data.email.toLowerCase();
        const isc = await tx
          .update(iscrizioni)
          .set({ ...iscrizioneRedaction, email: erasedEmail(iscrizioni) })
          .where(sql`lower(${iscrizioni.email}) = ${email}`)
          .returning();
        touched.iscrizioni += isc.length;
        await purgeAllegati(tx, isc.map((i) => i.id));

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
        // Perf: N+1 → singolo UPDATE batch. Il valore di redaction è IDENTICO
        // per ogni membro (nessuna dipendenza per-riga: niente email univoca,
        // niente firma), quindi un'unica `WHERE candidatoId IN (...)` è
        // semanticamente equivalente al loop precedente. Dentro la stessa tx.
        const candIds = cand.map((c) => c.id);
        if (candIds.length > 0) {
          const mem = await tx
            .update(candidatiMembri)
            .set({ nome: REDACTED, cognome: REDACTED, dataNascita: null, nazionalita: null })
            .where(inArray(candidatiMembri.candidatoId, candIds))
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
        erasedAccountIds.push(...acc.map((a) => a.id));
      }

      // N137 (GDPR Art. 17): NON loggare i selettori nel payload (email,
      // commissarioId, candidatoId, iscrizioneId) — manterrebbero l'identità
      // della persona nell'audit dopo l'oblio. Logghiamo solo i conteggi.
      await writeAudit(tx, req, 'privacy.erase', {
        payload: { touched },
      });

      return { ok: true, touched, accountIds: erasedAccountIds };
    });

    // N183 (GDPR Art. 17): scrub delle PII residue dall'audit_log STORICO della
    // persona. audit_log è append-only per il ruolo app → si passa da dbSuper.
    //  - rimuove la chiave `email` dai payload che la contengono o che
    //    referenziano (target_id) un'entità erasa;
    //  - azzera ip/userAgent SOLO sulle azioni compiute dalla persona stessa
    //    (actor = suo account), non sulle azioni di un admin che la riguardano.
    // Ogni riga toccata viene RI-FIRMATA (M196) per non risultare manomessa.
    // Best-effort: un fallimento non annulla l'erasure già committata.
    try {
      const email = parsed.data.email?.toLowerCase() ?? null;
      const targetIds = [parsed.data.commissarioId, parsed.data.candidatoId, parsed.data.iscrizioneId]
        .filter((x): x is string => !!x);
      const accountIds = result.accountIds;
      const orConds = [];
      if (email) {
        // Cattura l'email sia top-level sia annidata/altre chiavi: match sul testo
        // del payload (le wildcard LIKE nell'email sono escapate; gli scrub veri
        // avvengono ricorsivamente sotto, qui serve solo a SELEZIONARE le righe).
        const likeEmail = '%' + email.replace(/[%_\\]/g, '\\$&') + '%';
        orConds.push(sql`${auditLog.payload}::text ILIKE ${likeEmail}`);
      }
      if (targetIds.length) orConds.push(inArray(auditLog.targetId, targetIds));
      if (accountIds.length) orConds.push(inArray(auditLog.actorAccountId, accountIds));
      if (orConds.length > 0) {
        // Fetch UNICO di tutte le righe bersaglio (un solo round-trip in lettura).
        const rows = await dbSuper
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.tenantId, req.tenant.id), or(...orConds)));

        // Calcoliamo la nuova firma di OGNI riga in app code, PRIMA di scrivere.
        // L'HMAC dipende dal contenuto specifico della riga (payload scrubato,
        // ip/userAgent condizionati a isOwnAction): un singolo UPDATE "uguale per
        // tutti" sarebbe SCORRETTO. Restiamo quindi per-riga, ma:
        //  - una sola SELECT (sopra) invece di letture ridondanti;
        //  - tutti gli UPDATE in UNA transazione (un BEGIN/COMMIT, niente
        //    autocommit per statement) → meno round-trip e atomicità.
        // Lo schema di firma è invariato: stessa chiave, stessi campi nello
        // stesso ordine di computeAuditLogSig — solo i valori in input cambiano.
        const updates = rows.map((r) => {
          const isOwnAction = !!r.actorAccountId && accountIds.includes(r.actorAccountId);
          let payload = r.payload as Record<string, unknown> | null;
          if (email && payload && typeof payload === 'object') {
            payload = scrubEmailDeep(payload, email) as Record<string, unknown>;
          }
          const ip = isOwnAction ? null : r.ip;
          const userAgent = isOwnAction ? null : r.userAgent;
          // #8: ri-firma includendo createdAt (invariato) → la riga scrubata
          // resta protetta v2 sul timestamp originale.
          const sig = computeAuditLogSig({
            tenantId: r.tenantId,
            actorAccountId: r.actorAccountId,
            action: r.action,
            targetType: r.targetType,
            targetId: r.targetId,
            payload,
            ip,
            userAgent,
          }, r.createdAt);
          return { id: r.id, payload, ip, userAgent, sig };
        });
        if (updates.length > 0) {
          await dbSuper.transaction(async (tx) => {
            for (const u of updates) {
              await tx
                .update(auditLog)
                .set({ payload: u.payload, ip: u.ip, userAgent: u.userAgent, sig: u.sig })
                .where(eq(auditLog.id, u.id));
            }
          });
        }
      }
    } catch (err) {
      req.log.warn({ err }, 'N183: scrub PII dall audit fallito (best-effort)');
    }

    return result;
  });
};
