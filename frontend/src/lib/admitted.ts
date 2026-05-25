/**
 * resolveAdmittedIds — calcola gli ID dei candidatiFase ammessi alla fase
 * successiva (top-N con risoluzione pareggi), pronti da inviare a
 * `concludiFase(id, ids)`. Usa lo STESSO motore della classifica mostrata in
 * RisultatiTab (rankWithTieBreak), incluso lo step "voto del Presidente" e lo
 * step "età" (gruppi via membri).
 *
 * Ritorna `null` se la fase non ha una soglia `ammessi` valida → il server
 * mantiene l'ammissione esistente (semantica vanilla computeAdmittedIds).
 *
 * È un'azione rara (conclusione fase) → fa fetch diretti via le API invece di
 * dipendere dalla cache di React Query, così è invocabile da qualunque punto
 * (Commissario presidente, FasiTab admin) senza che i dati siano già montati.
 */
import { candidatiApi } from '@/api/candidati';
import { fetchValutazioniByFase } from '@/api/valutazioni';
import { listCriteri } from '@/api/criteri';
import { commissariApi } from '@/api/commissari';
import { commissioniApi } from '@/api/commissioni';
import { getConcorso } from '@/api/concorsi';
import { getPresidenteForFase } from '@/lib/presidenti';
import { mediaCandidato, criteriFromRecords } from '@/lib/scoring';
import { rankWithTieBreak, effectiveStrategy, computeAdmittedIds } from '@/lib/tiebreak';
import type { FaseRecord } from '@/api/fasi';
import type { Concorso } from '@/types';

export async function resolveAdmittedIds(
  fase: FaseRecord,
  concorso?: Concorso | null,
): Promise<string[] | null> {
  // Nessuna soglia top-N → niente da calcolare (il server mantiene lo stato).
  const ammessi = Number((fase as { ammessi?: number | null }).ammessi);
  if (!Number.isFinite(ammessi) || ammessi <= 0) return null;

  const concorsoId = fase.concorsoId;
  const [cfs, criteriRecs, commissari, commissioni, candidati, conc] = await Promise.all([
    candidatiApi.candidatiFase(fase.id),
    listCriteri(fase.id),
    commissariApi.list(concorsoId),
    commissioniApi.list(concorsoId),
    candidatiApi.list(concorsoId),
    concorso ? Promise.resolve(concorso) : getConcorso(concorsoId).catch(() => null),
  ]);
  if (cfs.length === 0) return [];

  const vals = await fetchValutazioniByFase(cfs.map((cf) => cf.id));

  // Membri dei candidati-gruppo (per lo step di spareggio "età").
  const groupIds = candidati
    .filter((c) => (c as { isGruppo?: boolean }).isGruppo)
    .map((c) => c.id);
  const membriEntries = await Promise.all(
    groupIds.map(
      async (id) => [id, await candidatiApi.membri(id).catch(() => [])] as const,
    ),
  );
  const membriMap = new Map(membriEntries);

  const faseWithCriteri = { ...fase, criteri: criteriFromRecords(criteriRecs) };
  const rows = cfs.map((cf) => {
    const cand = candidati.find((c) => c.id === cf.candidatoId);
    const vs = vals
      .filter((v) => v.candidatoFaseId === cf.id)
      .map((v) => ({ commissario_id: v.commissarioId, criterio: v.criterio, voto: v.voto }));
    return { cf, cand, media: mediaCandidato(vs, faseWithCriteri), valutazioni: vs };
  });

  const presidente = getPresidenteForFase(
    fase as Parameters<typeof getPresidenteForFase>[0],
    commissioni as Parameters<typeof getPresidenteForFase>[1],
    commissari as Parameters<typeof getPresidenteForFase>[2],
  );

  const ranked = rankWithTieBreak(
    rows as Parameters<typeof rankWithTieBreak>[0],
    faseWithCriteri,
    {
      strategy: effectiveStrategy(faseWithCriteri, conc),
      presidenteId: presidente?.id ?? null,
      allCandidati: candidati,
      getMembri: (id: string) => membriMap.get(id) ?? [],
    },
  );

  return computeAdmittedIds(ranked, ammessi);
}
