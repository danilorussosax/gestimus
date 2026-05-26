// =============================================================================
// CountdownConfirm — 5-second auto-save confirmation overlay
//
// Owns its own countdown interval. Calls onConfirm when the timer reaches 0,
// or onCancel on Escape / button click. No shared state.
// Extracted from Commissario.tsx.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { displayName } from '@/pages/commissario-utils';
import type { Candidato } from '@/types';

export interface CountdownConfirmProps {
  candidato: Candidato | null | undefined;
  anonimo: boolean;
  ammesso: boolean;
  totale: number;
  scala: number;
  fmtVoto: (v: number, scala: number) => string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CountdownConfirm({
  candidato,
  anonimo,
  ammesso,
  totale,
  scala,
  fmtVoto,
  onConfirm,
  onCancel,
}: CountdownConfirmProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(5);
  const [pct, setPct] = useState(100);
  const confirmedRef = useRef(false);
  const totalSec = 5;

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const rem = Math.max(0, totalSec * 1000 - elapsed);
      const remSec = Math.ceil(rem / 1000);
      setRemaining(remSec);
      setPct((rem / (totalSec * 1000)) * 100);
      if (rem <= 0) {
        clearInterval(id);
        if (!confirmedRef.current) {
          confirmedRef.current = true;
          onConfirm();
        }
      }
    }, 100);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearInterval(id);
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerCls = ammesso
    ? 'bg-gradient-to-br from-emerald-500 to-emerald-700'
    : 'bg-gradient-to-br from-rose-500 to-rose-700';
  const numCls = ammesso ? 'text-emerald-600' : 'text-rose-600';
  const barCls = ammesso ? 'bg-emerald-500' : 'bg-rose-500';
  const verdictText = ammesso ? t('com.confirm.approved') : t('com.confirm.rejected');
  const numLabel = `#${String(candidato?.numeroCandidato ?? '').padStart(3, '0')}`;
  const nameLabel = anonimo ? '' : ` ${displayName(candidato)}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4 view-fade">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className={cn(headerCls, 'text-white px-6 py-5 text-center')}>
          <div className="text-4xl mb-1">⏳</div>
          <div className="text-[10px] uppercase tracking-widest font-bold opacity-90">
            {t('com.confirm.title')}
          </div>
          <h3 className="text-lg font-bold mt-1 leading-tight">
            {numLabel}{nameLabel}
          </h3>
          <div className="mt-3 inline-flex items-center gap-2 bg-white/20 rounded-full px-3 py-1 text-xs font-bold">
            {ammesso ? '✓' : '✕'} {verdictText} · {fmtVoto(totale, scala)}/{scala}
          </div>
        </div>
        <div className="p-6 text-center">
          <div className={cn('text-7xl font-black tabular-nums', numCls)}>{remaining}</div>
          <p className="text-sm text-slate-600 mt-3">
            {/* Hardcoded IT: the i18n key contains HTML tags; render plain equivalent */}
            Salvataggio automatico tra{' '}
            <strong>{remaining}</strong>{' '}
            {remaining === 1 ? 'secondo' : 'secondi'}.{' '}
            Hai questo tempo per <strong>annullare</strong> e riconsiderare la valutazione.
          </p>
          <div className="w-full h-2 bg-slate-200 rounded-full mt-4 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', barCls)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            className="c-btn c-btn--outline mt-5 w-full"
            onClick={onCancel}
          >
            {t('com.confirm.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
