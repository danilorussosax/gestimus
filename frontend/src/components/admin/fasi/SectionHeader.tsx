import type { ReactNode } from 'react';

export function SectionHeader({ num, title, right }: { num: number; title: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0">
          {num}
        </span>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      {right}
    </header>
  );
}
