// =============================================================================
// KpiCard — gradient KPI tile used in PresidentePanel
// Pure display component. Extracted from Commissario.tsx.
// =============================================================================

import { cn } from '@/lib/utils';

interface KpiCardProps {
  gradient: string;
  value: string | number;
  label: string;
  icon: string;
  progress?: number;
}

export function KpiCard({ gradient, value, label, icon, progress }: KpiCardProps) {
  return (
    <div className={cn('relative rounded-2xl p-5 bg-gradient-to-br text-white shadow-md overflow-hidden', gradient)}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-11 h-11 rounded-xl bg-white/95 text-slate-700 flex items-center justify-center shadow-sm text-lg">
          {icon}
        </div>
        <span className="text-white/70 cursor-pointer leading-none text-lg" title="Altre opzioni">⋯</span>
      </div>
      <div className="text-3xl sm:text-4xl font-extrabold leading-none mb-1.5 drop-shadow-sm">
        {value}
      </div>
      <div className="text-xs sm:text-sm font-medium text-white/90 tracking-wide">{label}</div>
      {progress !== undefined && (
        <div className="mt-3 h-1.5 bg-white/25 rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
