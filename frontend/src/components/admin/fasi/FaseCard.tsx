import { cn } from '@/lib/utils';
import { Pencil, Trash2, ChevronUp, ChevronDown, Play, StopCircle, Shuffle } from 'lucide-react';
import { type FaseRecord } from '@/api/fasi';
import { STATO_COLORS, prettyStato, fmtDate } from '../fasi-utils';

export interface FaseCardProps {
  fase: FaseRecord;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onConclude: () => void;
  onSorteggio: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function FaseCard({
  fase,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onStart,
  onConclude,
  onSorteggio,
  onMoveUp,
  onMoveDown,
}: FaseCardProps) {
  const stato = fase.stato ?? 'PIANIFICATA';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-soft hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500">
              #{fase.ordine}
            </span>
            <h3 className="font-bold text-slate-900 text-lg">{fase.nome}</h3>
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                STATO_COLORS[stato],
              )}
            >
              {prettyStato(stato)}
            </span>
            {fase.modoValutazione === 'sincrona' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                sincrona
              </span>
            )}
          </div>

          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Scala {fase.scala}</span>
            {fase.metodoMedia && <span>Media: {fase.metodoMedia}</span>}
            {fase.ammessi != null && <span>Ammessi: {fase.ammessi}</span>}
            {fase.dataPrevista && <span>Data: {fmtDate(fase.dataPrevista)}</span>}
            {fase.tempoMinuti != null && fase.tempoMinuti > 0 && (
              <span>Tempo: {fase.tempoMinuti}′</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Sposta su"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronUp className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Sposta giù"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Modifica"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={stato === 'IN_CORSO'}
            title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {stato === 'PIANIFICATA' && (
          <button
            type="button"
            onClick={onStart}
            className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            Avvia
          </button>
        )}
        {stato === 'IN_CORSO' && (
          <button
            type="button"
            onClick={onConclude}
            className="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <StopCircle className="h-3.5 w-3.5" />
            Concludi
          </button>
        )}
        {stato !== 'CONCLUSA' && (
          <button
            type="button"
            onClick={onSorteggio}
            className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md inline-flex items-center gap-1"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Sorteggio
          </button>
        )}
      </div>
    </div>
  );
}
