/**
 * Programma.tsx — sezione "Programma in esecuzione" del ScoringSheet.
 *
 * Risale dal candidato attivo all'iscrizione che lo ha generato (campo
 * `iscrizione.candidatoId`) e mostra il programma nello stesso formato in cui
 * è stato compilato dal candidato (`{ titolo, autore?, durata_min? }`).
 *
 * Implementation note: la API admin `iscrizioniApi.list(concorsoId)` filtra per
 * concorso; non c'è ancora un endpoint per "lookup by candidatoId", per cui
 * recuperiamo la lista e filtriamo client-side. Cache via React Query.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Music2 } from 'lucide-react';
import { iscrizioniApi, ISCRIZIONI_KEY } from '@/api/iscrizioni';

interface Brano {
  titolo: string;
  autore?: string;
  durata_min?: number;
}

interface Props {
  concorsoId: string;
  candidatoId: string | null;
  /** Per i gruppi: nascondi/mostra anche se nessun candidato singolo. */
  hideIfMissing?: boolean;
}

function isBranoArray(x: unknown): x is Brano[] {
  return Array.isArray(x) && x.every((b) => b && typeof b === 'object' && typeof (b as Brano).titolo === 'string');
}

export function Programma({ concorsoId, candidatoId, hideIfMissing = false }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ISCRIZIONI_KEY(concorsoId),
    queryFn: () => iscrizioniApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });

  const programma = useMemo<Brano[]>(() => {
    if (!data || !candidatoId) return [];
    const iscr = data.find((i) => i.candidatoId === candidatoId);
    return isBranoArray(iscr?.programma) ? (iscr!.programma as Brano[]) : [];
  }, [data, candidatoId]);

  if (isLoading) {
    return (
      <div className="px-5 py-3 border-b border-border bg-muted/40 text-[12px] text-muted-foreground">
        <span className="font-mono uppercase tracking-[0.14em] text-[10.5px]">Caricamento programma…</span>
      </div>
    );
  }

  if (programma.length === 0) {
    if (hideIfMissing) return null;
    return (
      <div className="px-5 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2.5">
          <Music2 className="text-amber-500" size={13} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
            Programma · non disponibile
          </span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground italic">
          Nessun programma registrato per questo candidato in fase d'iscrizione.
        </p>
      </div>
    );
  }

  const totDurata = programma.reduce((s, p) => s + (Number(p.durata_min) || 0), 0);

  return (
    <div className="px-5 py-3 border-b border-border bg-muted/40">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2.5">
          <Music2 className="text-amber-500" size={13} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
            Programma · da iscrizione
          </span>
        </div>
        {totDurata > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">≈ {totDurata}′ totali</span>
        )}
      </div>
      <ol className="flex flex-col gap-0.5">
        {programma.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
            <span className="font-mono text-[10.5px] text-amber-700 italic shrink-0 mt-[3px] w-4 text-right">
              {i + 1}.
            </span>
            <span className="flex-1 min-w-0">
              {p.autore && <span className="font-semibold">{p.autore}</span>}
              {p.autore && <span className="text-muted-foreground"> — </span>}
              <span>{p.titolo}</span>
            </span>
            {p.durata_min != null && (
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums mt-[3px]">
                {p.durata_min}′
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
