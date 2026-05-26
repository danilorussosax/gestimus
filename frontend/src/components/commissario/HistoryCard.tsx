// =============================================================================
// HistoryCard — compact previously-evaluated candidate card in scoring sidebar
// Pure display component. Extracted from Commissario.tsx.
// =============================================================================

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { displayName } from '@/pages/commissario-utils';
import type { CandidatoFase, Candidato, Valutazione, Fase } from '@/types';

export interface HistoryCardProps {
  cf: CandidatoFase;
  candidati: Candidato[];
  valutazioni: Valutazione[];
  commissarioId: string;
  anonimo: boolean;
  fase: Fase;
  fmtVotoFn: (v: number, scala: number) => string;
  getCriteriFn: (f: Fase) => { key: string; label: string; peso: number }[];
  pesatoFn: (voti: Record<string, number>, f: Fase) => number;
  getScalaFn: (f: Fase) => number;
}

export function HistoryCard({
  cf,
  candidati,
  valutazioni,
  commissarioId,
  anonimo,
  fase,
  fmtVotoFn,
  getCriteriFn,
  pesatoFn,
  getScalaFn,
}: HistoryCardProps) {
  const { t } = useTranslation();
  const cand = candidati.find((c) => c.id === cf.candidatoId);
  const myVotes = valutazioni.filter(
    (v) => v.candidatoFaseId === cf.id && v.commissarioId === commissarioId,
  );
  const voti: Record<string, number> = {};
  myVotes.forEach((v) => { voti[v.criterio] = v.voto; });
  const scala = getScalaFn(fase);
  const totale = pesatoFn(voti, fase);
  const norm = scala ? totale / scala : 0;
  const ammesso = cf.ammessoProssimaFase;

  return (
    <div
      className={cn(
        'bg-white border rounded-xl p-3',
        ammesso ? 'border-emerald-200' : 'border-rose-200',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {!anonimo && (
            <div className="w-7 h-7 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-sm text-slate-400 shrink-0">
              {cand?.fotoUrl ? (
                <img src={cand.fotoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                '👤'
              )}
            </div>
          )}
          <div className="font-mono text-xs text-slate-500">
            #{String(cand?.numeroCandidato ?? '').padStart(3, '0')}
          </div>
        </div>
        <span
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full',
            ammesso ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800',
          )}
        >
          {ammesso ? t('com.confirm.approved') : t('com.confirm.rejected')}
        </span>
      </div>
      {!anonimo && (
        <div className="font-medium text-sm text-slate-900 truncate mt-1">
          {displayName(cand)}
        </div>
      )}
      <div className="text-xs text-slate-500 truncate">{cand?.strumento ?? ''}</div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
        {getCriteriFn(fase).map((c) => (
          <div
            key={c.key}
            className="flex justify-between bg-slate-50 px-1.5 py-0.5 rounded"
            title={c.label}
          >
            <span className="text-slate-500">{(c.label || '?').charAt(0).toUpperCase()}</span>
            <span className="font-mono font-medium">{fmtVotoFn(voti[c.key] ?? 0, scala)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right">
        <span className="text-[10px] text-slate-400">{t('com.tot_short')} </span>
        <span className={cn('text-sm font-bold', norm >= 0.65 ? 'text-slate-900' : 'text-rose-600')}>
          {fmtVotoFn(totale, scala)}
          <span className="text-[10px] text-slate-400">/{scala}</span>
        </span>
      </div>
    </div>
  );
}
