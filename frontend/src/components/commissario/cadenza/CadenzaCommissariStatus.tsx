/**
 * CadenzaCommissariStatus.tsx — sidebar card "Stato commissari".
 *
 * Per ogni membro della commissione della fase, calcola da `valutazioni`:
 *   - completi: # cf con voto in TUTTI i criteri della fase
 *   - parziali: # cf con almeno un voto ma non completo
 *   - in attesa: il resto
 */

import { useMemo } from 'react';
import { displayName } from '@/pages/commissario-utils';
import type { Fase, Commissione, CandidatoFase, Valutazione, Commissario } from '@/types';

interface Props {
  fase: Fase;
  commissione: Commissione | null;
  allCfs: CandidatoFase[];
  valutazioni: Valutazione[];
  /** Opzionale: passa la lista commissari per mostrare i nomi (altrimenti solo conteggi). */
  commissari?: Commissario[];
}

export function CadenzaCommissariStatus({ fase, commissione, allCfs, valutazioni, commissari }: Props) {
  const commIds = useMemo(() => commissione?.commissari ?? [], [commissione]);
  const criteriKeys = useMemo(
    () => (Array.isArray(fase.criteri) ? fase.criteri.map((c) => c.key) : []),
    [fase.criteri],
  );

  const stats = useMemo(() => commIds.map((cid) => {
    let completi = 0, parziali = 0;
    for (const cf of allCfs) {
      const myVotes = valutazioni.filter((v) => v.candidatoFaseId === cf.id && v.commissarioId === cid);
      if (myVotes.length === 0) continue;
      const hasAll = criteriKeys.length > 0 && criteriKeys.every((k) => myVotes.some((v) => v.criterio === k));
      if (hasAll) completi++; else parziali++;
    }
    return { cid, completi, parziali, totale: allCfs.length };
  }), [commIds, allCfs, valutazioni, criteriKeys]);

  const nameOf = (cid: string): string => {
    const c = commissari?.find((x) => x.id === cid);
    return c ? displayName(c) : `…${cid.slice(-4)}`;
  };

  const iniz = (cid: string): string => {
    const c = commissari?.find((x) => x.id === cid);
    if (!c) return '??';
    const parts = [c.cognome, c.nome].filter(Boolean).join(' ');
    return parts.split(/\s+/).slice(0, 2).map((s) => s[0] ?? '').join('').toUpperCase() || '??';
  };

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-xs p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
          Stato commissari
        </span>
        <span className="text-[10.5px] text-muted-foreground font-mono">
          {commIds.length} attivi
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {stats.map(({ cid, completi, parziali, totale }) => {
          const completiPct = totale ? (completi / totale) * 100 : 0;
          const parzialiPct = totale ? (parziali / totale) * 100 : 0;
          const isPresidente = commissione?.presidenteCommissarioId === cid;
          return (
            <li key={cid} className="flex items-center gap-2.5">
              <div className={`w-7 h-7 rounded-full grid place-items-center text-[10px] font-semibold tabular-nums ${
                isPresidente ? 'bg-amber-400 text-amber-950' : 'bg-primary text-primary-foreground'
              }`}>
                {iniz(cid)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate flex items-center gap-1.5">
                  {nameOf(cid)}
                  {isPresidente && (
                    <span className="font-mono text-[9px] text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                      Pres.
                    </span>
                  )}
                </div>
                <div className="h-1 mt-1 bg-secondary rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-600" style={{ width: completiPct + '%' }} />
                  <div className="h-full bg-amber-500" style={{ width: parzialiPct + '%' }} />
                </div>
              </div>
              <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums shrink-0">
                {completi + parziali}/{totale}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />Completi</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Parziali</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />In attesa</span>
      </div>
    </div>
  );
}
