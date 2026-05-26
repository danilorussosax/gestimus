import { cn } from '@/lib/utils';
import { Pencil, Trash2, ChevronUp, ChevronDown, Play, StopCircle, Shuffle } from 'lucide-react';
import { type FaseRecord } from '@/api/fasi';
import { type CommissioneRecord } from '@/api/commissioni';
import { STATO_COLORS, prettyStato, fmtDate, type SharedField } from '../fasi-utils';

export interface InnerFaseRowProps {
  fase: FaseRecord;
  drift: SharedField[];
  isFirst: boolean;
  isLast: boolean;
  commissioni: CommissioneRecord[] | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onConclude: () => void;
  onSorteggio: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function InnerFaseRow({
  fase,
  drift,
  isFirst,
  isLast,
  commissioni,
  onEdit,
  onDelete,
  onStart,
  onConclude,
  onSorteggio,
  onMoveUp,
  onMoveDown,
}: InnerFaseRowProps) {
  const stato = fase.stato ?? 'PIANIFICATA';
  const tempo = Number(fase.tempoMinuti) || 0;

  // Pillole "override": mostriamo SOLO i campi che divergono dal gruppo,
  // così si vede dov'è lo scostamento (replica i driftPills di innerFaseRowHtml).
  const driftPills: string[] = [];
  if (drift.includes('scala')) driftPills.push(`scala ${fase.scala || 10}`);
  if (drift.includes('tempoMinuti') && tempo > 0) driftPills.push(`⏱ ${tempo}′`);
  if (drift.includes('modoValutazione')) driftPills.push(fase.modoValutazione ?? 'autonoma');
  if (drift.includes('metodoMedia')) driftPills.push(`media ${fase.metodoMedia ?? 'aritmetica'}`);
  if (drift.includes('pesi')) driftPills.push('criteri specifici');
  if (drift.includes('commissioneId')) {
    const c = fase.commissioneId ? commissioni?.find((x) => x.id === fase.commissioneId) : null;
    driftPills.push(c ? `🎼 ${c.nome}` : 'nessuna comm.');
  }

  return (
    <div className="px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-400">#{fase.ordine}</span>
          <h4 className="font-semibold text-slate-900 text-base">{fase.nome}</h4>
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
              STATO_COLORS[stato],
            )}
          >
            {prettyStato(stato)}
          </span>
          {driftPills.length > 0 && (
            <span
              className="text-[10px] font-medium text-amber-700 inline-flex items-center gap-1"
              title="Valori specifici di questa sotto-fase"
            >
              ▾ {driftPills.join(' · ')}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
          {fase.ammessi != null ? (
            <span>
              <strong>{fase.ammessi}</strong> passano
            </span>
          ) : (
            <span className="italic">tutti gli ammessi passano</span>
          )}
          {fase.dataPrevista && <span>📅 {fmtDate(fase.dataPrevista)}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stato === 'PIANIFICATA' && (
            <button
              type="button"
              onClick={onStart}
              className="text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-md shadow-sm inline-flex items-center gap-1"
            >
              <Play className="h-3 w-3" /> Avvia
            </button>
          )}
          {stato === 'IN_CORSO' && (
            <button
              type="button"
              onClick={onConclude}
              className="text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 px-2.5 py-1 rounded-md shadow-sm inline-flex items-center gap-1"
            >
              <StopCircle className="h-3 w-3" /> Concludi
            </button>
          )}
          {stato !== 'CONCLUSA' && (
            <button
              type="button"
              onClick={onSorteggio}
              className="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md inline-flex items-center gap-1"
            >
              <Shuffle className="h-3 w-3" /> Sorteggio
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Sposta su"
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          title="Sposta giù"
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          title="Modifica"
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-brand-700 hover:bg-brand-50"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={stato === 'IN_CORSO'}
          title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
