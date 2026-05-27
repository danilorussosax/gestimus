// #1 — Ricalcolo server-side degli ammessi di una fase, dal DB, per VERIFICARE
// la lista `admitted` inviata dal client in /fasi/:id/conclude. Replica fedele
// di frontend/src/lib/admitted.ts:resolveAdmittedIds usando i port server di
// scoring/tiebreak. Gira dentro la transazione del conclude (RLS già scoped).

import { eq, inArray } from 'drizzle-orm';
import type { TxClient } from '../middleware/tenant.js';
import {
  candidati, candidatiFase, candidatiMembri, commissioni, concorsi, criteri, valutazioni,
} from '../db/schema.js';
// #2: scoring/tiebreak ora dal package condiviso @gestimus/scoring (single
// source of truth con il frontend) — niente più port duplicato lato server.
import { criteriFromRecords, mediaCandidato } from '@gestimus/scoring/scoring';
import { rankWithTieBreak, effectiveStrategy, computeAdmittedIds } from '@gestimus/scoring/tiebreak';

/** Riga fase con i campi letti dal ricalcolo (subset di `fasi`). */
export interface FaseForScoring {
  id: string;
  concorsoId: string;
  commissioneId: string | null;
  ammessi: number | null;
  metodoMedia: string | null;
  scala: number | null;
  ordine: number;
  tiebreakStrategy: unknown;
  pesi: unknown;
  dataPrevista: string | null;
}

/**
 * Calcola gli ID dei candidatiFase ammessi (top-N con risoluzione pareggi) dalla
 * sola fonte DB. Ritorna `null` se la fase non ha una soglia `ammessi` valida
 * (> 0): in quel caso non c'è un top-N da verificare e il conclude mantiene lo
 * stato (semantica computeAdmittedIds). Ritorna `[]` se non ci sono candidati.
 */
export async function computeAdmittedFromTx(tx: TxClient, fase: FaseForScoring): Promise<string[] | null> {
  const cfs = await tx
    .select({ id: candidatiFase.id, candidatoId: candidatiFase.candidatoId })
    .from(candidatiFase)
    .where(eq(candidatiFase.faseId, fase.id));
  if (cfs.length === 0) return [];

  const cfIds = cfs.map((c) => c.id);
  const [criteriRecs, vals, cands, conc, comm] = await Promise.all([
    tx.select({ nome: criteri.nome, peso: criteri.peso, ordine: criteri.ordine })
      .from(criteri).where(eq(criteri.faseId, fase.id)).orderBy(criteri.ordine),
    tx.select({ candidatoFaseId: valutazioni.candidatoFaseId, commissarioId: valutazioni.commissarioId, criterio: valutazioni.criterio, voto: valutazioni.voto })
      .from(valutazioni).where(inArray(valutazioni.candidatoFaseId, cfIds)),
    tx.select({ id: candidati.id, numeroCandidato: candidati.numeroCandidato, dataNascita: candidati.dataNascita, isGruppo: candidati.isGruppo, tipoGruppo: candidati.tipoGruppo })
      .from(candidati).where(eq(candidati.concorsoId, fase.concorsoId)),
    tx.select({ defaultTiebreakStrategy: concorsi.defaultTiebreakStrategy })
      .from(concorsi).where(eq(concorsi.id, fase.concorsoId)).limit(1),
    fase.commissioneId
      ? tx.select({ presidenteCommissarioId: commissioni.presidenteCommissarioId })
          .from(commissioni).where(eq(commissioni.id, fase.commissioneId)).limit(1)
      : Promise.resolve([] as { presidenteCommissarioId: string | null }[]),
  ]);

  // Membri dei candidati-gruppo (step di spareggio "età").
  const groupIds = cands.filter((c) => c.isGruppo).map((c) => c.id);
  const membri = groupIds.length
    ? await tx.select({ candidatoId: candidatiMembri.candidatoId, dataNascita: candidatiMembri.dataNascita })
        .from(candidatiMembri).where(inArray(candidatiMembri.candidatoId, groupIds))
    : [];
  const membriMap = new Map<string, { dataNascita: string | null }[]>();
  for (const m of membri) {
    const arr = membriMap.get(m.candidatoId) ?? [];
    arr.push({ dataNascita: m.dataNascita });
    membriMap.set(m.candidatoId, arr);
  }

  const valByCf = new Map<string, { commissario_id: string; criterio: string; voto: number }[]>();
  for (const v of vals) {
    const arr = valByCf.get(v.candidatoFaseId) ?? [];
    arr.push({ commissario_id: v.commissarioId, criterio: v.criterio, voto: Number(v.voto) });
    valByCf.set(v.candidatoFaseId, arr);
  }
  const candById = new Map(cands.map((c) => [c.id, c]));

  const faseWithCriteri = { ...fase, criteri: criteriFromRecords(criteriRecs) };
  const rows = cfs.map((cf) => {
    const cand = candById.get(cf.candidatoId) ?? null;
    const vs = valByCf.get(cf.id) ?? [];
    return { cf, cand, media: mediaCandidato(vs, faseWithCriteri), valutazioni: vs };
  });

  const presidenteId = comm[0]?.presidenteCommissarioId ?? null;
  const ranked = rankWithTieBreak(rows, faseWithCriteri, {
    strategy: effectiveStrategy(faseWithCriteri, conc[0] ?? null),
    presidenteId,
    refDate: fase.dataPrevista ?? null,
    allCandidati: cands,
    getMembri: (id: string) => membriMap.get(id) ?? [],
  });

  return computeAdmittedIds(ranked, fase.ammessi);
}

/** Confronto insiemistico di due liste di id (ordine-indipendente). */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}
