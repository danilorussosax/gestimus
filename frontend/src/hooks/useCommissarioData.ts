// =============================================================================
// useCommissarioData — data-query hook for the Commissario page
//
// Wraps all 8 useQuery calls + criteriQ + invalidateAll into a single hook so
// Commissario.tsx can be reduced to a single hook call for data fetching.
// Lift-and-move only: no logic changes.
// =============================================================================

import { useQueryClient, useQuery } from '@tanstack/react-query';

import { http } from '@/lib/api';
import type {
  Fase,
  Commissario,
  Commissione,
  CandidatoFase,
  Candidato,
  Valutazione,
  Concorso,
} from '@/types';
import { normalizeCandidato } from '@/api/candidati';
import { listCriteri } from '@/api/criteri';
import { criteriFromRecords } from '@/lib/scoring';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CriterioRecord } from '@/api/criteri';

export interface CommissarioDataResult {
  concorsiList: Concorso[] | undefined;
  commissario: Commissario | undefined;
  fasi: Fase[] | undefined;
  commissioni: Commissione[] | undefined;
  commissariList: Commissario[] | undefined;
  candidatiFaseList: CandidatoFase[] | undefined;
  candidati: Candidato[] | undefined;
  valutazioni: Valutazione[] | undefined;
  criteriQ: UseQueryResult<CriterioRecord[]>;
  faseWithCriteri: (fase: Fase) => Fase;
  isLoading: boolean;
  commissarioConcorsoId: string | null;
  invalidateAll: () => void;
}

export function useCommissarioData(commissarioId: string | null): CommissarioDataResult {
  const qc = useQueryClient();

  const { data: concorsiList, isLoading: loadingConcorsi } = useQuery({
    queryKey: ['concorsi'],
    queryFn: () => http.get<Concorso[]>('concorsi', { limit: 1000 }),
  });

  const { data: commissario, isLoading: loadingCommissario } = useQuery({
    queryKey: ['commissario', commissarioId],
    queryFn: () => http.get<Commissario>(`commissari/${commissarioId ?? ''}`),
    enabled: !!commissarioId,
  });

  // Derive the active concorso from the commissario record.
  const commissarioConcorsoId: string | null = commissario?.concorsoId ?? null;
  const concorso = concorsiList?.find((c) => c.id === commissarioConcorsoId) ?? null;
  const concorsoId = concorso?.id ?? null;

  const { data: fasi, isLoading: loadingFasi } = useQuery({
    queryKey: ['fasi', concorsoId],
    queryFn: () => http.get<Fase[]>('fasi', { concorsoId: concorsoId ?? '', limit: 1000 }),
    enabled: !!concorsoId,
  });

  const { data: commissioni, isLoading: loadingCommissioni } = useQuery({
    queryKey: ['commissioni', concorsoId],
    queryFn: () => http.get<Commissione[]>('commissioni', { concorsoId: concorsoId ?? '', limit: 1000 }),
    enabled: !!concorsoId,
  });

  // Lista commissari del concorso → per mostrare nome/foto (non l'id troncato)
  // nello stato d'attesa in modalità sincrona.
  const { data: commissariList } = useQuery({
    queryKey: ['commissari', concorsoId],
    queryFn: () => http.get<Commissario[]>('commissari', { concorsoId: concorsoId ?? '', limit: 1000 }),
    enabled: !!concorsoId,
  });

  const { data: candidatiFaseList, isLoading: loadingCfs } = useQuery({
    queryKey: ['candidati-fase', concorsoId],
    queryFn: async () => {
      // Load for all fasi in this concorso
      const allFasi = await http.get<Fase[]>('fasi', { concorsoId: concorsoId ?? '', limit: 1000 });
      const results = await Promise.all(
        allFasi.map((f) =>
          http.get<CandidatoFase[]>('candidati-fase', { faseId: f.id, limit: 2000 }),
        ),
      );
      return results.flat();
    },
    enabled: !!concorsoId,
  });

  const { data: candidati, isLoading: loadingCandidati } = useQuery({
    queryKey: ['candidati', concorsoId],
    queryFn: () =>
      http
        .get<Candidato[]>('candidati', { concorsoId: concorsoId ?? '', limit: 2000 })
        .then((rows) => rows.map(normalizeCandidato)),
    enabled: !!concorsoId,
  });

  const { data: valutazioni, isLoading: loadingVals } = useQuery({
    queryKey: ['valutazioni', concorsoId],
    queryFn: () => http.get<Valutazione[]>('valutazioni', { concorsoId: concorsoId ?? '', limit: 10000 }),
    enabled: !!concorsoId,
  });

  // ── Criteri configurati della fase attiva ──────────────────────────────────
  // GET /api/fasi non porta i `criteri`, quindi scoring.getCriteri(fase) ripiega
  // sui 4 criteri di default. Recuperiamo i criteri CONFIGURATI della fase IN_CORSO
  // e li attacchiamo alla fase (faseWithCriteri) prima di ogni chiamata di scoring.
  // L'hook va chiamato INCONDIZIONATAMENTE per rispettare le regole degli hook React.
  const faseId = fasi?.find((f) => f.stato === 'IN_CORSO')?.id ?? null;
  const criteriQ = useQuery({
    queryKey: ['criteri', faseId],
    queryFn: () => listCriteri(faseId ?? ''),
    enabled: !!faseId,
    staleTime: 60_000,
  });

  // criteriQ DEVE essere nel gate: lo scoring (initDraft, faseCriteriKeys per la
  // risoluzione sincrona) usa i criteri CONFIGURATI. Se la pagina rende prima che
  // criteriQ risolva, ScoringSheet monta coi 4 criteri di default e il draft resta
  // su quelle chiavi → la POST /valutazioni salverebbe i voti sotto criteri sbagliati.
  // criteriQ.isLoading è true solo quando sta davvero fetchando (enabled+isFetching);
  // se non c'è una fase IN_CORSO la query è disabled → isLoading false, nessun hang.
  const isLoading =
    loadingConcorsi || loadingCommissario || loadingFasi ||
    loadingCommissioni || loadingCfs || loadingCandidati || loadingVals ||
    criteriQ.isLoading;

  function invalidateAll() {
    void qc.invalidateQueries({ queryKey: ['fasi', concorsoId] });
    void qc.invalidateQueries({ queryKey: ['candidati-fase', concorsoId] });
    void qc.invalidateQueries({ queryKey: ['valutazioni', concorsoId] });
    void qc.invalidateQueries({ queryKey: ['commissioni', concorsoId] });
  }

  // Convenience: build faseWithCriteri from a given fase
  function faseWithCriteriBuilder(fase: Fase): Fase {
    return { ...fase, criteri: criteriFromRecords(criteriQ.data) };
  }

  return {
    concorsiList,
    commissario,
    fasi,
    commissioni,
    commissariList,
    candidatiFaseList,
    candidati,
    valutazioni,
    criteriQ,
    faseWithCriteri: faseWithCriteriBuilder,
    isLoading,
    commissarioConcorsoId,
    invalidateAll,
  };
}
