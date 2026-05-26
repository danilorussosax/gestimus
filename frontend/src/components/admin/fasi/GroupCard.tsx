import type { ReactNode } from 'react';
import { type FaseRecord } from '@/api/fasi';
import { type SezioneRecord } from '@/api/sezioni';
import { type CommissioneRecord } from '@/api/commissioni';
import {
  computeDrift,
  sharedValue,
  iconaPerSezione,
  type FaseGroup,
} from '../fasi-utils';

export interface GroupCardProps {
  group: FaseGroup;
  sezioni: SezioneRecord[] | undefined;
  commissioni: CommissioneRecord[] | undefined;
  renderRow: (fase: FaseRecord) => ReactNode;
  onWizard: () => void;
  onAddFase: () => void;
  onEditShared: () => void;
  onDeleteGroup: () => void;
}

export function GroupCard({
  group,
  sezioni,
  commissioni,
  renderRow,
  onWizard,
  onAddFase,
  onEditShared,
  onDeleteGroup,
}: GroupCardProps) {
  const sezioniRecord = group.sezioneIds
    .map((id) => sezioni?.find((s) => s.id === id))
    .filter((s): s is SezioneRecord => !!s);

  const title =
    group.type === 'shared'
      ? 'Fasi globali (tutte le sezioni)'
      : group.type === 'multi'
        ? `Fasi su: ${sezioniRecord.map((s) => s.nome).join(' + ')}`
        : (sezioniRecord[0]?.nome ?? '???');
  const subtitle =
    group.type === 'shared'
      ? 'Si applicano a tutti i candidati del concorso, indipendentemente dalla sezione.'
      : group.type === 'single'
        ? 'Fase madre della sezione: le sotto-fasi qui sotto formano la sequenza di valutazione.'
        : 'Caso avanzato: la fase coinvolge più sezioni contemporaneamente.';
  const groupIcon =
    group.type === 'shared' ? '🌐' : group.type === 'multi' ? '🔗' : iconaPerSezione(sezioniRecord[0]?.nome);

  const drift = computeDrift(group.fasi);
  const sharedComm = sharedValue(group.fasi, 'commissioneId');
  const sharedScala = sharedValue(group.fasi, 'scala');
  const sharedModo = sharedValue(group.fasi, 'modoValutazione');
  const sharedTempo = sharedValue(group.fasi, 'tempoMinuti');
  const commAssegnata = sharedComm ? commissioni?.find((c) => c.id === sharedComm) : null;

  const anyRunning = group.fasi.some((f) => f.stato === 'IN_CORSO');
  const hasFasi = group.fasi.length > 0;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-soft overflow-hidden">
      <header className="bg-gradient-to-br from-brand-50/60 to-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl" aria-hidden="true">{groupIcon}</span>
            <h3 className="font-bold text-slate-900 text-lg truncate">{title}</h3>
            {hasFasi ? (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {group.fasi.length} {group.fasi.length === 1 ? 'sotto-fase' : 'sotto-fasi'}
              </span>
            ) : (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 text-slate-400 border border-dashed border-slate-200">
                vuoto
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1 leading-snug">{subtitle}</p>
          {hasFasi && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {commAssegnata ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                  🎼 {commAssegnata.nome}
                </span>
              ) : drift.includes('commissioneId') ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
                  title="I valori divergono tra le sotto-fasi"
                >
                  ⚠ Commissioni diverse
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 italic">
                  Nessuna commissione
                </span>
              )}
              {sharedScala !== undefined ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  Scala {sharedScala}
                </span>
              ) : (
                drift.includes('scala') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ scala diff.
                  </span>
                )
              )}
              {sharedModo ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  {sharedModo}
                </span>
              ) : (
                drift.includes('modoValutazione') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ modo diff.
                  </span>
                )
              )}
              {sharedTempo !== undefined && sharedTempo != null && sharedTempo > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  ⏱ {sharedTempo}′
                </span>
              ) : (
                drift.includes('tempoMinuti') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ tempo diff.
                  </span>
                )
              )}
              {drift.includes('pesi') && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  ⚠ criteri diff.
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {group.fasi.length > 1 && (
            <button
              type="button"
              onClick={onEditShared}
              className="text-xs font-medium text-brand-700 hover:bg-brand-50 px-3 py-1.5 rounded-lg border border-brand-100"
            >
              ⚙ Configurazione condivisa
            </button>
          )}
          {hasFasi && (
            <button
              type="button"
              onClick={onDeleteGroup}
              disabled={anyRunning}
              title={
                anyRunning
                  ? "Impossibile: c'è almeno una sotto-fase IN_CORSO. Concludila prima."
                  : 'Elimina tutte le sotto-fasi del gruppo'
              }
              className="text-xs font-medium text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🗑 Elimina gruppo
            </button>
          )}
          {hasFasi ? (
            <button
              type="button"
              onClick={onAddFase}
              className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg shadow-sm"
            >
              ＋ Aggiungi sotto-fase
            </button>
          ) : (
            <button
              type="button"
              onClick={onWizard}
              className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg shadow-sm"
            >
              Configura fasi
            </button>
          )}
        </div>
      </header>
      {hasFasi ? (
        <div className="divide-y divide-slate-100">{group.fasi.map((f) => renderRow(f))}</div>
      ) : (
        <div className="px-5 py-8 text-center">
          <div className="text-3xl mb-2" aria-hidden="true">🎼</div>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Nessuna fase configurata per questa sezione. Usa il wizard per crearne una unica o una sequenza
            (eliminatoria → semifinale → finale).
          </p>
        </div>
      )}
    </section>
  );
}
