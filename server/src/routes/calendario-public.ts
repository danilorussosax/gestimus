import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  calendarioPubblicazioni,
  candidati,
  candidatiFase,
  categorie,
  commissari,
  commissioniCommissari,
  concorsi,
  eventiCalendario,
  fasi,
  sale,
  sezioni,
} from '../db/schema.js';

// =====================================================================
// Plugin PUBBLICO: niente auth. Il tenant è risolto dal subdomain
// (middleware globale); la SELECT del token gira sotto RLS → un token di
// un altro tenant semplicemente non viene trovato (404). Rate-limit per IP.
// =====================================================================
export const calendarioPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/calendario/:token',
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
      const { token } = z.object({ token: z.string().min(8).max(128) }).parse(req.params);

      return req.dbTx(async (tx) => {
        const [pub] = await tx
          .select()
          .from(calendarioPubblicazioni)
          .where(and(eq(calendarioPubblicazioni.token, token), eq(calendarioPubblicazioni.attivo, true)))
          .limit(1);
        if (!pub) return reply.notFound();

        const [conc] = await tx
          .select({ id: concorsi.id, nome: concorsi.nome, anno: concorsi.anno, logo: concorsi.logo })
          .from(concorsi)
          .where(eq(concorsi.id, pub.concorsoId))
          .limit(1);
        if (!conc) return reply.notFound();

        // Eventi filtrati per scopo.
        const eventConds = [eq(eventiCalendario.concorsoId, pub.concorsoId)];
        if (pub.scopo === 'SEZIONE' && pub.sezioneId) eventConds.push(eq(eventiCalendario.sezioneId, pub.sezioneId));
        if (pub.scopo === 'GIORNO' && pub.giorno) eventConds.push(eq(eventiCalendario.data, pub.giorno));
        const eventi = await tx
          .select()
          .from(eventiCalendario)
          .where(and(...eventConds))
          .orderBy(asc(eventiCalendario.data), asc(eventiCalendario.oraInizio), asc(eventiCalendario.ordine));

        // Mappe di lookup (nomi sala/sezione/categoria/fase).
        const [saleRows, sezRows, catRows, faseRows] = await Promise.all([
          tx.select({ id: sale.id, nome: sale.nome, indirizzo: sale.indirizzo }).from(sale).where(eq(sale.concorsoId, pub.concorsoId)),
          tx.select({ id: sezioni.id, nome: sezioni.nome }).from(sezioni).where(eq(sezioni.concorsoId, pub.concorsoId)),
          tx.select({ id: categorie.id, nome: categorie.nome }).from(categorie),
          tx.select({ id: fasi.id, nome: fasi.nome, commissioneId: fasi.commissioneId }).from(fasi).where(eq(fasi.concorsoId, pub.concorsoId)),
        ]);
        const salaById = new Map(saleRows.map((r) => [r.id, r]));
        const sezById = new Map(sezRows.map((r) => [r.id, r]));
        const catById = new Map(catRows.map((r) => [r.id, r]));
        const faseById = new Map(faseRows.map((r) => [r.id, r]));

        const eventoIds = eventi.map((e) => e.id);

        // Slot dei candidati per i blocchi (un'unica query).
        const slotRows = eventoIds.length
          ? await tx
              .select({
                eventoId: candidatiFase.eventoId,
                posizione: candidatiFase.posizione,
                oraPrevista: candidatiFase.oraPrevista,
                numero: candidati.numeroCandidato,
                nome: candidati.nome,
                cognome: candidati.cognome,
              })
              .from(candidatiFase)
              .innerJoin(candidati, eq(candidati.id, candidatiFase.candidatoId))
              .where(inArray(candidatiFase.eventoId, eventoIds))
              .orderBy(asc(candidatiFase.oraPrevista), asc(candidatiFase.posizione), asc(candidati.numeroCandidato))
          : [];
        const slotsByEvento = new Map<string, typeof slotRows>();
        for (const s of slotRows) {
          if (!s.eventoId) continue;
          const list = slotsByEvento.get(s.eventoId) ?? [];
          list.push(s);
          slotsByEvento.set(s.eventoId, list);
        }

        // Commissione per fase (solo se il link la mostra).
        const membriByCommissione = new Map<string, Array<{ nome: string; cognome: string | null; specialita: string | null }>>();
        if (pub.mostraCommissione) {
          const commIds = [...new Set(faseRows.map((f) => f.commissioneId).filter((x): x is string => !!x))];
          if (commIds.length) {
            const membri = await tx
              .select({
                commissioneId: commissioniCommissari.commissioneId,
                nome: commissari.nome,
                cognome: commissari.cognome,
                specialita: commissari.specialita,
              })
              .from(commissioniCommissari)
              .innerJoin(commissari, eq(commissari.id, commissioniCommissari.commissarioId))
              .where(inArray(commissioniCommissari.commissioneId, commIds));
            for (const m of membri) {
              const list = membriByCommissione.get(m.commissioneId) ?? [];
              list.push({ nome: m.nome, cognome: m.cognome, specialita: m.specialita });
              membriByCommissione.set(m.commissioneId, list);
            }
          }
        }

        const pad = (n: number) => String(n).padStart(3, '0');

        // Raggruppa blocchi per giorno.
        const giorniMap = new Map<string, Array<Record<string, unknown>>>();
        for (const e of eventi) {
          const fase = e.faseId ? faseById.get(e.faseId) : null;
          const commissione =
            pub.mostraCommissione && fase?.commissioneId ? membriByCommissione.get(fase.commissioneId) ?? [] : null;
          const slot = (slotsByEvento.get(e.id) ?? []).map((s) => ({
            oraPrevista: s.oraPrevista,
            numero: s.numero,
            // Privacy: niente nomi se il link non li mostra → solo numero.
            etichetta: pub.mostraNomi ? [s.nome, s.cognome].filter(Boolean).join(' ').trim() : `N. ${pad(s.numero)}`,
          }));
          const blocco = {
            id: e.id,
            tipo: e.tipo,
            titolo: e.titolo,
            oraInizio: e.oraInizio,
            oraFine: e.oraFine,
            sala: e.salaId ? salaById.get(e.salaId) ?? null : null,
            sezione: e.sezioneId ? sezById.get(e.sezioneId) ?? null : null,
            categoria: e.categoriaId ? catById.get(e.categoriaId) ?? null : null,
            fase: fase ? { nome: fase.nome } : null,
            commissione,
            slot,
          };
          const list = giorniMap.get(e.data) ?? [];
          list.push(blocco);
          giorniMap.set(e.data, list);
        }
        const giorni = [...giorniMap.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([data, blocchi]) => ({ data, blocchi }));

        return {
          concorso: conc,
          pubblicazione: {
            scopo: pub.scopo,
            etichetta: pub.etichetta,
            mostraNomi: pub.mostraNomi,
            mostraCommissione: pub.mostraCommissione,
            sezioneId: pub.sezioneId,
            giorno: pub.giorno,
          },
          giorni,
        };
      });
    },
  );
};
