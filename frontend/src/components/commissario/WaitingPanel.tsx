// =============================================================================
// WaitingPanel — sincrona mode "waiting for other commissari" state
//
// Pure display — all data passed as props. The refresh button calls
// invalidateAll (passed as prop). presidentePanelSlot renders the
// PresidentePanel above the card when the current user is also presidente.
// Extracted from Commissario.tsx.
// =============================================================================

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { displayName } from '@/pages/commissario-utils';
import type { Candidato, Commissario, Fase, Concorso } from '@/types';

export interface WaitingPanelProps {
  fase: Fase;
  concorso: Concorso;
  isPresidenteFase: boolean;
  wCand: Candidato | undefined;
  commInFase: string[];
  votedSet: Set<string>;
  votedCount: number;
  totalCount: number;
  eta: number | null;
  commissarioId: string;
  commById: Map<string, Commissario>;
  invalidateAll: () => void;
  presidentePanelSlot?: ReactNode;
}

export function WaitingPanel({
  fase,
  concorso,
  isPresidenteFase,
  wCand,
  commInFase,
  votedSet,
  votedCount,
  totalCount,
  eta,
  commissarioId,
  commById,
  invalidateAll,
  presidentePanelSlot,
}: WaitingPanelProps) {
  const { t } = useTranslation();

  return (
    <section className={cn('view-fade', isPresidenteFase ? 'c-page max-w-7xl mx-auto py-8' : 'max-w-2xl mx-auto py-8')}>
      {isPresidenteFase && presidentePanelSlot}
      <div className={cn('bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-soft', isPresidenteFase && 'max-w-2xl mx-auto')}>
        <div className="text-center">
          <div className="text-5xl mb-3">⏳</div>
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
            {fase.nome}
            <span className="inline-flex items-center gap-1 ml-1 text-[10px] font-medium px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded normal-case">
              {t('com.sincrona_tag')}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">{t('com.waiting.title')}</h2>
          <p className="text-sm text-slate-600 mt-2">{t('com.waiting.subtitle')}</p>
        </div>

        <div className="mt-6 flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="text-3xl font-black tabular-nums text-brand-700 leading-none">
            {String(wCand?.numeroCandidato ?? '').padStart(3, '0')}
          </div>
          {!concorso.anonimo && (
            <div className="w-12 h-12 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-2xl text-slate-400 shrink-0 ring-2 ring-white">
              {wCand?.fotoUrl ? <img src={wCand.fotoUrl} alt="" className="w-full h-full object-cover" /> : '👤'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {concorso.anonimo ? (
              <>
                <div className="font-semibold text-slate-900 truncate">{t('com.candidate_anonymous')}</div>
                <div className="text-xs text-slate-600 truncate">{wCand?.strumento ?? ''}</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-slate-900 truncate">{displayName(wCand)}</div>
                <div className="text-xs text-slate-600 truncate">
                  {wCand?.strumento ?? ''}
                  {eta ? ` · ${t('com.candidate_age', { eta })}` : ''}
                  {wCand?.nazionalita ? ` · ${wCand.nazionalita}` : ''}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500 mb-2">
            <span>{t('com.waiting.committee_progress')}</span>
            <span className="font-mono font-semibold text-slate-700">{votedCount} / {totalCount}</span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
              style={{ width: `${totalCount ? (votedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          {/* Per-commissario status list (matching vanilla renderWaiting) */}
          <div className="space-y-2">
            {commInFase.map((cid) => {
              const v = votedSet.has(cid);
              const isMe = cid === commissarioId;
              const comm = commById.get(cid);
              const nome = displayName(comm) || cid.substring(0, 8);
              return (
                <div
                  key={cid}
                  className={cn(
                    'flex items-center justify-between bg-white border rounded-lg px-3 py-2',
                    v ? 'border-emerald-200' : 'border-slate-200',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-sm shrink-0">
                      {comm?.foto ? (
                        <img src={comm.foto} alt="" className="w-full h-full object-cover" />
                      ) : (
                        '🧑‍⚖️'
                      )}
                    </div>
                    <span className={cn('text-sm truncate', isMe ? 'font-semibold text-slate-900' : 'text-slate-700')}>
                      {nome}{isMe ? ` ${t('com.you_suffix', { defaultValue: '(tu)' })}` : ''}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap',
                      v ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
                    )}
                  >
                    {v ? t('com.voted') : t('com.waiting_dot')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg shadow-sm"
            onClick={invalidateAll}
          >
            ↻ {t('com.waiting.refresh')}
          </button>
          <Link to="/" className="text-sm font-medium text-slate-700 hover:bg-slate-100 px-4 py-2 rounded-lg">
            {t('com.change_role')}
          </Link>
        </div>
      </div>
    </section>
  );
}
