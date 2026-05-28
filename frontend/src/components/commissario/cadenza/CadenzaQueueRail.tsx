/**
 * CadenzaQueueRail.tsx — card "Coda / Storico" (rail sinistro).
 *
 * Coda: tutti i CandidatoFase della fase corrente, ordinati per posizione,
 *       con highlight sul cf attivo (`currentCfId`) e check su quelli già
 *       valutati da QUESTO commissario.
 * Storico: i miei voti precedenti (mostra peso totale).
 */

import { Check } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { displayName } from '@/pages/commissario-utils';
import type { CandidatoFase, Candidato, Valutazione, Fase } from '@/types';

interface Props {
  allCfs: CandidatoFase[];
  candidati: Candidato[];
  myEvaluated: CandidatoFase[];
  myValutazioni: Valutazione[];
  currentCfId: string | null;
  fase: Fase;
  anonimo: boolean;
  scoring: {
    pesato: (voti: Record<string, number>, fase: Fase) => number;
    fmtVoto: (n: number, scala: number) => string;
    getScala: (fase: Fase) => number;
  };
  /** True quando il commissario può navigare (cambiando cf). Falso in sincrona. */
  canNavigate?: boolean;
  onPick?: (cfId: string) => void;
}

export function CadenzaQueueRail({
  allCfs, candidati, myEvaluated, myValutazioni, currentCfId, fase, anonimo,
  scoring, canNavigate = false, onPick,
}: Props) {
  const sortedQueue = [...allCfs].sort((a, b) => (a.posizione ?? 0) - (b.posizione ?? 0));
  const evaluatedIds = new Set(myEvaluated.map((cf) => cf.id));
  const scala = scoring.getScala(fase);

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-xs">
      <Tabs defaultValue="queue" className="w-full">
        <div className="px-3 pt-3 pb-2">
          <TabsList className="grid grid-cols-2 h-8">
            <TabsTrigger value="queue" className="text-[12px]">Coda</TabsTrigger>
            <TabsTrigger value="storico" className="text-[12px]">Storico</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="queue" className="m-0">
          <ul className="px-2 pb-2 max-h-[min(46vh,360px)] overflow-y-auto">
            {sortedQueue.map((cf) => {
              const cand = candidati.find((c) => c.id === cf.candidatoId);
              const isCurrent = cf.id === currentCfId;
              const done = evaluatedIds.has(cf.id);
              const label = anonimo
                ? `#${cf.posizione ?? '—'}`
                : (cand ? displayName(cand) : '—');
              const numTag = cf.posizione != null ? String(cf.posizione).padStart(3, '0') : '---';

              const Inner = (
                <>
                  <span className={cn(
                    'font-mono text-[11px] tabular-nums',
                    isCurrent ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}>{numTag}</span>
                  <span className="min-w-0 truncate text-[12.5px]">{label}</span>
                  {done && <Check size={12} className={cn(isCurrent ? 'text-primary-foreground/80' : 'text-emerald-600')} />}
                  {isCurrent && !done && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80 animate-pulse" />}
                </>
              );

              return (
                <li key={cf.id}>
                  {canNavigate ? (
                    <button
                      onClick={() => onPick?.(cf.id)}
                      className={cn(
                        'w-full text-left grid grid-cols-[32px_1fr_auto] gap-2 items-center px-2 py-1.5 rounded-md transition-colors',
                        isCurrent ? 'bg-primary text-primary-foreground'
                                  : done ? 'text-muted-foreground hover:bg-accent'
                                         : 'hover:bg-accent',
                      )}
                    >
                      {Inner}
                    </button>
                  ) : (
                    <div
                      className={cn(
                        'grid grid-cols-[32px_1fr_auto] gap-2 items-center px-2 py-1.5 rounded-md',
                        isCurrent ? 'bg-primary text-primary-foreground'
                                  : done ? 'text-muted-foreground'
                                         : 'text-foreground',
                      )}
                    >
                      {Inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <footer className="px-3 pt-2 pb-2.5 border-t border-border text-[10.5px] text-muted-foreground flex items-center justify-between">
            <span>
              Posizione <span className="text-foreground font-semibold tabular-nums">
                {(sortedQueue.findIndex((cf) => cf.id === currentCfId) + 1) || '—'}
              </span>/{sortedQueue.length}
            </span>
            <span className="opacity-60">{evaluatedIds.size} valutati</span>
          </footer>
        </TabsContent>

        <TabsContent value="storico" className="m-0">
          <ul className="px-2 pb-2 max-h-[min(46vh,360px)] overflow-y-auto">
            {myEvaluated.length === 0 ? (
              <li className="px-2 py-4 text-center text-[12px] text-muted-foreground italic">
                Nessuna valutazione precedente.
              </li>
            ) : myEvaluated.map((cf) => {
              const cand = candidati.find((c) => c.id === cf.candidatoId);
              // Reconstruct voti map for this cf from myValutazioni
              const voti: Record<string, number> = {};
              myValutazioni
                .filter((v) => v.candidatoFaseId === cf.id)
                .forEach((v) => { voti[v.criterio] = Number(v.voto); });
              const totale = scoring.pesato(voti, fase);
              const numTag = cf.posizione != null ? String(cf.posizione).padStart(3, '0') : '---';
              return (
                <li key={cf.id} className="grid grid-cols-[32px_1fr_auto] gap-2 items-center px-2 py-1.5 hover:bg-accent rounded-md">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{numTag}</span>
                  <span className="text-[12.5px] truncate">
                    {anonimo ? `#${cf.posizione ?? '—'}` : (cand ? displayName(cand) : '—')}
                  </span>
                  <span className="font-bold text-[13px] tabular-nums tracking-tight">
                    {scoring.fmtVoto(totale, scala)}<span className="text-muted-foreground font-normal">/{scala}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
