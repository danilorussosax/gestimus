import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface NumericCardProps {
  icon: string;
  title: string;
  desc: string;
  tip: ReactNode;
  value: string | number;
  min: number;
  max: number;
  suffix?: string | null;
  presets: { v: string | number; label: string }[];
  onChange: (v: string | number) => void;
}

export function NumericCard({ icon, title, desc, tip, value, min, max, suffix, presets, onChange }: NumericCardProps) {
  const isEmpty = value === '' || value == null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2 hover:shadow-soft transition-shadow">
      <div className="flex items-center gap-2">
        <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
        <p className="font-semibold text-sm text-slate-900 min-w-0">{title}</p>
      </div>
      <p className="text-xs text-slate-600 leading-snug">{desc}</p>
      <div className="relative">
        <input
          type="number"
          min={min}
          max={max}
          value={isEmpty ? '' : value}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={cn('c-input pr-12 text-xl font-bold tabular-nums')}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={String(p.v)}
            type="button"
            onClick={() => onChange(p.v)}
            className="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-brand-100 hover:text-brand-800 px-2 py-1 rounded-md transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mt-auto pt-1 border-t border-slate-100">{tip}</p>
    </div>
  );
}
