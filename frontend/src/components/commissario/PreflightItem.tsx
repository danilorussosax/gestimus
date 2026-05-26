// =============================================================================
// PreflightItem — single check-row in PresidentePanel preflight list
// Pure display component. Extracted from Commissario.tsx.
// =============================================================================

import { cn } from '@/lib/utils';

interface PreflightItemProps {
  ok: boolean;
  label: string;
}

export function PreflightItem({ ok, label }: PreflightItemProps) {
  return (
    <li className="flex items-start gap-2.5 p-2 rounded-lg bg-white border border-slate-200">
      <span
        className={cn(
          'w-6 h-6 inline-flex items-center justify-center rounded-full text-xs font-bold shrink-0',
          ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
        )}
      >
        {ok ? '✓' : '✗'}
      </span>
      <span className={cn('text-sm leading-snug', ok ? 'text-slate-800' : 'text-rose-900 font-medium')}>
        {label}
      </span>
    </li>
  );
}
