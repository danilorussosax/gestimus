// =============================================================================
// AllDonePanel — "all candidates evaluated" completion state
//
// Pure display — all data passed as props. presidentePanelSlot renders the
// PresidentePanel above the card when the current user is also presidente.
// Extracted from Commissario.tsx.
// =============================================================================

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface AllDonePanelProps {
  isPresidenteFase: boolean;
  evaluatedCount: number;
  faseNome: string;
  presidentePanelSlot?: ReactNode;
}

export function AllDonePanel({
  isPresidenteFase,
  evaluatedCount,
  faseNome,
  presidentePanelSlot,
}: AllDonePanelProps) {
  const { t } = useTranslation();

  return (
    <section className={cn('view-fade', isPresidenteFase ? 'c-page max-w-7xl mx-auto py-8' : 'max-w-2xl mx-auto text-center py-16')}>
      {isPresidenteFase && presidentePanelSlot}
      <div className={cn(isPresidenteFase && 'bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-soft max-w-2xl mx-auto text-center')}>
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-slate-900">{t('com.all_done.title')}</h2>
        <p className="text-slate-600 mt-2">
          {t('com.all_done.desc', { count: evaluatedCount, fase: faseNome })}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          {isPresidenteFase ? t('com.all_done.help_pres') : t('com.all_done.help')}
        </p>
        <div className="mt-6">
          <Link to="/" className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg">
            {t('com.back_to_menu')}
          </Link>
        </div>
      </div>
    </section>
  );
}
