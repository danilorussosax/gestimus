import type { FastifyPluginAsync } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '../lib/zod-helpers.js';
import {
  candidati,
  categorie,
  commissari,
  commissioni,
  commissioniCategorie,
  commissioniSezioni,
  concorsi,
  criteri,
  fasi,
  fasiSezioni,
  iscrizioni,
  sezioni,
} from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { parsePagination } from '../lib/pagination.js';
import { checkConcorsiLimit, planExpiredError } from '../lib/plan-limits.js';
import { expectedVersionField, versionFresh, STALE_VERSION_BODY } from '../lib/optimistic.js';
import { replyValidationError } from '../lib/validation.js';

const createBody = z.object({
  nome: z.string().min(1).max(255),
  anno: z.number().int().min(1900).max(2200),
  dataInizio: z.string().date().optional(),
  stato: z.enum(['ATTIVO', 'CONCLUSO']).optional(),
  logo: z.string().optional(),
  anonimo: z.boolean().optional(),
  iscrizioniAperte: z.boolean().optional(),
  iscrizioniScadenza: z.string().date().optional(),
  // Cascata tiebreak di default del concorso (array [{key,enabled}]) — nullable
  // per poterla azzerare. jsonb passthrough.
  defaultTiebreakStrategy: z
    .array(z.object({ key: z.string(), enabled: z.boolean() }))
    .nullable()
    .optional(),
});
const updateBody = createBody.partial();

export const concorsiRoutes: FastifyPluginAsync = async (app) => {
  // GET pubblico-ish ma richiede comunque sessione (admin/commissario)
  app.get('/concorsi', { preHandler: [requireAuth] }, async (req) => {
    const { limit, offset } = parsePagination(req.query);
    return req.dbTx(async (tx) => tx.select().from(concorsi).limit(limit).offset(offset));
  });

  app.get('/concorsi/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      const rows = await tx.select().from(concorsi).where(eq(concorsi.id, id)).limit(1);
      if (rows.length === 0) return reply.notFound();
      return rows[0];
    });
  });

  // Conteggi sintetici del concorso per badge/header del workspace admin: query
  // aggregate dedicate invece di scaricare 5 liste intere lato client.
  // audit #4: i 5 count erano 5 SELECT sequenziali (il pool pg espone UNA
  // connessione per tx → non parallelizzabili con Promise.all). Collassati in
  // UNA sola query con subquery scalari → un solo round-trip. Le subquery
  // girano sotto RLS (solo righe del tenant corrente). Resta una SELECT di
  // esistenza separata per distinguere "concorso assente/altrui" (404) da
  // "concorso esistente con 0 figli".
  app.get('/concorsi/:id/summary', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return req.dbTx(async (tx) => {
      // Esistenza + isolamento tenant (RLS): concorso assente/altrui → 404.
      const [exists] = await tx.select({ id: concorsi.id }).from(concorsi).where(eq(concorsi.id, id)).limit(1);
      if (!exists) return reply.notFound();
      const res = await tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM ${candidati}   WHERE ${candidati.concorsoId}   = ${id}) AS candidati,
          (SELECT count(*)::int FROM ${commissari}  WHERE ${commissari.concorsoId}  = ${id}) AS commissari,
          (SELECT count(*)::int FROM ${commissioni} WHERE ${commissioni.concorsoId} = ${id}) AS commissioni,
          (SELECT count(*)::int FROM ${fasi}        WHERE ${fasi.concorsoId}        = ${id}) AS fasi,
          (SELECT count(*)::int FROM ${sezioni}     WHERE ${sezioni.concorsoId}     = ${id}) AS sezioni
      `);
      const r = (res.rows[0] ?? {}) as Record<string, number | null>;
      return {
        concorsoId: id,
        candidati:   Number(r.candidati ?? 0),
        commissari:  Number(r.commissari ?? 0),
        commissioni: Number(r.commissioni ?? 0),
        fasi:        Number(r.fasi ?? 0),
        sezioni:     Number(r.sezioni ?? 0),
      };
    });
  });

  app.post(
    '/concorsi',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, req, parsed.error);
      return req.dbTx(async (tx) => {
        // Durata piano: scaduto → niente nuove creazioni.
        const expErr = planExpiredError(req.tenant);
        if (expErr) return reply.code(403).send({ error: expErr });
        // N57: enforce limite di piano sul numero di concorsi.
        const limitErr = await checkConcorsiLimit(tx, req.tenant!.id);
        if (limitErr) return reply.code(403).send({ error: limitErr });
        const [created] = await tx
          .insert(concorsi)
          .values({ tenantId: req.tenant!.id, ...parsed.data })
          .returning();
        await writeAudit(tx, req, 'concorso.create', {
          targetType: 'concorso',
          targetId: created!.id,
          payload: { nome: created!.nome, anno: created!.anno },
        });
        return reply.code(201).send(created);
      });
    },
  );

  // Feature #5 — Duplica concorso: copia la STRUTTURA di un concorso esistente
  // (sezioni, categorie, commissioni, fasi, criteri + tutte le configurazioni)
  // ESCLUDENDO i dati runtime (candidati, candidati_fase, valutazioni,
  // iscrizioni, commissari e i join verso i commissari).
  //
  // Gli ID sono UUID generati dal DB: dobbiamo RIMAPPARE le foreign key interne.
  // L'ordine di inserimento rispetta le dipendenze e ad ogni passo costruiamo
  // una mappa vecchioId→nuovoId usata per tradurre i FK dei livelli successivi.
  // Tutte le insert settano il tenantId corrente (richiesto dalla RLS).
  app.post(
    '/concorsi/:id/duplica',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const tenantId = req.tenant!.id;
      return req.dbTx(async (tx) => {
        // Durata piano: scaduto → niente duplica (è una nuova creazione).
        const expErr = planExpiredError(req.tenant);
        if (expErr) return reply.code(403).send({ error: expErr });
        // N57: il duplicato è un nuovo concorso → vale il limite di piano.
        const limitErr = await checkConcorsiLimit(tx, tenantId);
        if (limitErr) return reply.code(403).send({ error: limitErr });

        // Source: 404 se assente o di un altro tenant (RLS).
        const [src] = await tx.select().from(concorsi).where(eq(concorsi.id, id)).limit(1);
        if (!src) return reply.notFound();

        // 1) Concorso (nuovo id, nome "<nome> (copia)", stessa config). Non
        // copiamo created/updatedAt (default DB) né l'id (rigenerato).
        const nome = `${src.nome} (copia)`;
        const [nuovoConcorso] = await tx
          .insert(concorsi)
          .values({
            tenantId,
            nome,
            anno: src.anno,
            dataInizio: src.dataInizio,
            stato: src.stato,
            logo: src.logo,
            anonimo: src.anonimo,
            iscrizioniAperte: src.iscrizioniAperte,
            iscrizioniScadenza: src.iscrizioniScadenza,
            defaultTiebreakStrategy: src.defaultTiebreakStrategy,
          })
          .returning();
        const nuovoConcorsoId = nuovoConcorso!.id;

        // 2) Sezioni (FK concorsoId). Mappa vecchioId→nuovoId.
        const sezioniMap = new Map<string, string>();
        const srcSezioni = await tx.select().from(sezioni).where(eq(sezioni.concorsoId, id));
        for (const s of srcSezioni) {
          const [ns] = await tx
            .insert(sezioni)
            .values({
              tenantId,
              concorsoId: nuovoConcorsoId,
              nome: s.nome,
              descrizione: s.descrizione,
              ordine: s.ordine,
            })
            .returning({ id: sezioni.id });
          sezioniMap.set(s.id, ns!.id);
        }

        // 3) Categorie (FK sezioneId → mappa sezioni). Mappa vecchioId→nuovoId.
        const categorieMap = new Map<string, string>();
        if (sezioniMap.size > 0) {
          const srcCategorie = await tx
            .select()
            .from(categorie)
            .where(inArray(categorie.sezioneId, [...sezioniMap.keys()]));
          for (const c of srcCategorie) {
            const nuovaSezioneId = sezioniMap.get(c.sezioneId);
            if (!nuovaSezioneId) continue; // sezione non mappata: skip difensivo
            const [nc] = await tx
              .insert(categorie)
              .values({
                tenantId,
                sezioneId: nuovaSezioneId,
                nome: c.nome,
                descrizione: c.descrizione,
                etaMin: c.etaMin,
                etaMax: c.etaMax,
                ordine: c.ordine,
              })
              .returning({ id: categorie.id });
            categorieMap.set(c.id, nc!.id);
          }
        }

        // 4) Commissioni (FK concorsoId). NON copiamo presidenteCommissarioId né
        // i join verso i commissari (commissioni_commissari): i commissari sono
        // dati runtime e non vengono duplicati. Mappa vecchioId→nuovoId.
        const commissioniMap = new Map<string, string>();
        const srcCommissioni = await tx
          .select()
          .from(commissioni)
          .where(eq(commissioni.concorsoId, id));
        for (const cm of srcCommissioni) {
          const [ncm] = await tx
            .insert(commissioni)
            .values({
              tenantId,
              concorsoId: nuovoConcorsoId,
              nome: cm.nome,
              // presidenteCommissarioId omesso: i commissari non sono copiati.
            })
            .returning({ id: commissioni.id });
          commissioniMap.set(cm.id, ncm!.id);
        }

        // 4b) Join commissioni↔sezioni (rimappa entrambe le FK).
        if (commissioniMap.size > 0) {
          const srcCommSez = await tx
            .select()
            .from(commissioniSezioni)
            .where(inArray(commissioniSezioni.commissioneId, [...commissioniMap.keys()]));
          for (const r of srcCommSez) {
            const nuovaCommissioneId = commissioniMap.get(r.commissioneId);
            const nuovaSezioneId = sezioniMap.get(r.sezioneId);
            if (!nuovaCommissioneId || !nuovaSezioneId) continue;
            await tx.insert(commissioniSezioni).values({
              tenantId,
              commissioneId: nuovaCommissioneId,
              sezioneId: nuovaSezioneId,
            });
          }

          // 4c) Join commissioni↔categorie (rimappa entrambe le FK).
          const srcCommCat = await tx
            .select()
            .from(commissioniCategorie)
            .where(inArray(commissioniCategorie.commissioneId, [...commissioniMap.keys()]));
          for (const r of srcCommCat) {
            const nuovaCommissioneId = commissioniMap.get(r.commissioneId);
            const nuovaCategoriaId = categorieMap.get(r.categoriaId);
            if (!nuovaCommissioneId || !nuovaCategoriaId) continue;
            await tx.insert(commissioniCategorie).values({
              tenantId,
              commissioneId: nuovaCommissioneId,
              categoriaId: nuovaCategoriaId,
            });
          }
        }

        // 5) Fasi (FK concorsoId, commissioneId→mappa commissioni). Copiamo
        // tutta la config (scala, pesi, metodoMedia, tiebreak, modoValutazione,
        // tempoMinuti, label esito, ammessi, ordine, dataPrevista) ma NON lo
        // stato runtime del timer/avanzamento → la fase nasce PIANIFICATA
        // (default DB). Mappa vecchioId→nuovoId.
        const fasiMap = new Map<string, string>();
        const srcFasi = await tx.select().from(fasi).where(eq(fasi.concorsoId, id));
        for (const f of srcFasi) {
          const nuovaCommissioneId = f.commissioneId
            ? (commissioniMap.get(f.commissioneId) ?? null)
            : null;
          const [nf] = await tx
            .insert(fasi)
            .values({
              tenantId,
              concorsoId: nuovoConcorsoId,
              commissioneId: nuovaCommissioneId,
              ordine: f.ordine,
              nome: f.nome,
              ammessi: f.ammessi,
              dataPrevista: f.dataPrevista,
              scala: f.scala,
              modoValutazione: f.modoValutazione,
              pesi: f.pesi,
              metodoMedia: f.metodoMedia,
              tempoMinuti: f.tempoMinuti,
              tiebreakStrategy: f.tiebreakStrategy,
              testoEsitoPromosso: f.testoEsitoPromosso,
              testoEsitoEliminato: f.testoEsitoEliminato,
              // stato/timer* omessi → default DB (PIANIFICATA, timer azzerato).
            })
            .returning({ id: fasi.id });
          fasiMap.set(f.id, nf!.id);
        }

        // 5b) Join fasi↔sezioni (rimappa entrambe le FK).
        if (fasiMap.size > 0) {
          const srcFasiSez = await tx
            .select()
            .from(fasiSezioni)
            .where(inArray(fasiSezioni.faseId, [...fasiMap.keys()]));
          for (const r of srcFasiSez) {
            const nuovaFaseId = fasiMap.get(r.faseId);
            const nuovaSezioneId = sezioniMap.get(r.sezioneId);
            if (!nuovaFaseId || !nuovaSezioneId) continue;
            await tx.insert(fasiSezioni).values({
              tenantId,
              faseId: nuovaFaseId,
              sezioneId: nuovaSezioneId,
            });
          }
        }

        // 6) Criteri (FK faseId→mappa fasi).
        if (fasiMap.size > 0) {
          const srcCriteri = await tx
            .select()
            .from(criteri)
            .where(inArray(criteri.faseId, [...fasiMap.keys()]));
          for (const cr of srcCriteri) {
            const nuovaFaseId = fasiMap.get(cr.faseId);
            if (!nuovaFaseId) continue;
            await tx.insert(criteri).values({
              tenantId,
              faseId: nuovaFaseId,
              nome: cr.nome,
              descrizione: cr.descrizione,
              peso: cr.peso,
              ordine: cr.ordine,
            });
          }
        }

        await writeAudit(tx, req, 'concorso.duplicate', {
          targetType: 'concorso',
          targetId: nuovoConcorsoId,
          payload: { sourceId: id, nome },
        });
        return reply.code(201).send(nuovoConcorso);
      });
    },
  );

  app.patch(
    '/concorsi/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const parsed = updateBody.extend(expectedVersionField).safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, req, parsed.error);
      const { expectedUpdatedAt, ...patch } = parsed.data;
      return req.dbTx(async (tx) => {
        // #4: controllo ottimistico opt-in sotto lock (evita la TOCTOU sul check).
        if (expectedUpdatedAt !== undefined) {
          const [cur] = await tx.select({ updatedAt: concorsi.updatedAt }).from(concorsi).where(eq(concorsi.id, id)).limit(1).for('update');
          if (!cur) return reply.notFound();
          if (!versionFresh(cur.updatedAt, expectedUpdatedAt)) return reply.code(409).send(STALE_VERSION_BODY);
        }
        const [updated] = await tx
          .update(concorsi)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(concorsi.id, id))
          .returning();
        if (!updated) return reply.notFound();
        await writeAudit(tx, req, 'concorso.update', {
          targetType: 'concorso',
          targetId: id,
          payload: patch,
        });
        return updated;
      });
    },
  );

  app.delete(
    '/concorsi/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const force = z.object({ force: z.coerce.boolean().optional() }).parse(req.query).force === true;
      return req.dbTx(async (tx) => {
        // M193: il DELETE concorso fa CASCADE su TUTTI i dati collegati
        // (candidati, iscrizioni, fasi, valutazioni, …). Senza ?force=true
        // rifiutiamo la cancellazione di un concorso con dati reali → niente
        // perdita accidentale; il client la ripete con force dopo conferma.
        if (!force) {
          const [cand] = await tx.select({ n: sql<number>`count(*)::int` }).from(candidati).where(eq(candidati.concorsoId, id));
          const [isc] = await tx.select({ n: sql<number>`count(*)::int` }).from(iscrizioni).where(eq(iscrizioni.concorsoId, id));
          if ((cand?.n ?? 0) > 0 || (isc?.n ?? 0) > 0) {
            return reply.code(409).send({
              error: 'concorso con dati collegati: ripeti con ?force=true per eliminare tutto',
              candidati: cand?.n ?? 0,
              iscrizioni: isc?.n ?? 0,
            });
          }
        }
        const [deleted] = await tx.delete(concorsi).where(eq(concorsi.id, id)).returning();
        if (!deleted) return reply.notFound();
        await writeAudit(tx, req, 'concorso.delete', {
          targetType: 'concorso',
          targetId: id,
          payload: { nome: deleted.nome, anno: deleted.anno },
        });
        return reply.code(204).send();
      });
    },
  );
};
