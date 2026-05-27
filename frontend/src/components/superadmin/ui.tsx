// Display atoms extracted from Superadmin.tsx (lift-and-move, no behaviour change).

import React from 'react';
import type { TenantStato, TenantPiano } from '@/api/platform';
import { PIANI, type PianoInfo } from '@/lib/piani';

// ─── StatoBadge ───────────────────────────────────────────────────────────────

export function StatoBadge({ stato }: { stato: TenantStato }) {
  const cls =
    stato === 'attivo'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : stato === 'sospeso'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-rose-50 text-rose-700 ring-rose-200';
  const dot =
    stato === 'attivo' ? 'bg-emerald-500' : stato === 'sospeso' ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {stato}
    </span>
  );
}

// ─── PianoBadge ───────────────────────────────────────────────────────────────

// `info` opzionale: se passato (dalla mappa dinamica di usePiani) ha priorità,
// altrimenti ricade sul catalogo statico PIANI risolto per key.
export function PianoBadge({ piano, info }: { piano: TenantPiano; info?: PianoInfo }) {
  const p = info ?? PIANI[piano] ?? PIANI.trial;
  const colors: Record<string, string> = {
    sky:     'bg-sky-50 text-sky-700 ring-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    brand:   'bg-brand-50 text-brand-700 ring-brand-200',
    amber:   'bg-amber-50 text-amber-700 ring-amber-200',
    slate:   'bg-slate-100 text-slate-700 ring-slate-200',
  };
  const cls = colors[p.badge_color] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ring-1 ${cls}`}>
      {p.nome}
    </span>
  );
}

// ─── UsageBar ─────────────────────────────────────────────────────────────────

export function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit == null ? null : limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const over = limit != null && used > limit;
  const barCls = over ? 'bg-rose-500' : pct != null && pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-ink-700">{label}</span>
        <span className="font-medium">
          <strong className={over ? 'text-rose-700' : ''}>{used}</strong>
          {limit != null && <span className="text-ink-500 font-normal"> / {limit}</span>}
          {limit == null && <span className="text-ink-500 font-normal"> illimitato</span>}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barCls} transition-all duration-300`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

// ─── MiniBar ──────────────────────────────────────────────────────────────────

export function MiniBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit == null) return null;
  const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const color = used > limit ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1 bg-slate-200 rounded-full overflow-hidden mt-1 w-20 ml-auto">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── StatTile ─────────────────────────────────────────────────────────────────

export function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-2">
      <div className="text-sm font-semibold text-ink-900 leading-none">{value}</div>
      <div className="text-[10px] text-ink-500 uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}

// ─── KpiCard ──────────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, sub, accent, icon: Icon,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent: 'brand' | 'amber' | 'sky' | 'slate' | 'emerald';
  icon: React.ElementType;
}) {
  const accentCls: Record<string, { iconBg: string; iconText: string; border: string }> = {
    brand:   { iconBg: 'bg-brand-50',   iconText: 'text-brand-700',   border: 'border-brand-100' },
    amber:   { iconBg: 'bg-amber-50',   iconText: 'text-amber-700',   border: 'border-amber-100' },
    sky:     { iconBg: 'bg-sky-50',     iconText: 'text-sky-700',     border: 'border-sky-100' },
    slate:   { iconBg: 'bg-slate-100',  iconText: 'text-slate-700',   border: 'border-slate-200' },
    emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-700', border: 'border-emerald-100' },
  };
  const a = accentCls[accent] ?? accentCls.slate;
  return (
    <div className={`bg-white border ${a.border} rounded-xl p-3.5`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</p>
        <div className={`w-7 h-7 rounded-lg ${a.iconBg} ${a.iconText} inline-flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="text-xl font-bold text-ink-900 leading-tight">{value}</div>
      <p className="text-[11px] text-ink-500 mt-1 leading-tight">{sub}</p>
    </div>
  );
}

// ─── ResourceCard24h ──────────────────────────────────────────────────────────

// Card risorsa con finestra 24h — SVG inline (no chart lib). Mostra valore
// corrente, span coperto, e statistiche min/medio/picco sulla serie storica
// campionata dal backend (1 campione/intervalMs, fino a 24h).
export function ResourceCard24h({
  label, current, series, color, format, yMax = null, intervalMs,
}: {
  label: string;
  current: string;
  series: number[]; // cronologica (vecchio → nuovo)
  color: string;
  format: (v: number) => string;
  yMax?: number | null;
  intervalMs: number;
}) {
  const w = 320, h = 120, pad = 6;
  const n = series.length;
  const stats = n
    ? { min: Math.min(...series), max: Math.max(...series), avg: series.reduce((a, b) => a + b, 0) / n }
    : null;
  const spanMin = n > 1 ? Math.round(((n - 1) * intervalMs) / 60000) : 0;
  const spanLabel = spanMin >= 60 ? `${(spanMin / 60).toFixed(1)}h` : `${spanMin} min`;

  let chart: React.ReactNode;
  if (n >= 2 && stats) {
    const innerW = w - pad * 2, innerH = h - pad * 2;
    const maxV = yMax ?? stats.max;
    const minV = Math.min(0, stats.min);
    const range = (maxV - minV) || 1;
    const stepX = innerW / (n - 1);
    const pts = series.map((v, i) => ({
      x: pad + i * stepX,
      y: pad + innerH - ((v - minV) / range) * innerH,
    }));
    const line = 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
    const first = pts[0], last = pts[n - 1];
    const area = `${line} L ${last.x.toFixed(1)} ${(h - pad).toFixed(1)} L ${first.x.toFixed(1)} ${(h - pad).toFixed(1)} Z`;
    const avgY = pad + innerH - ((stats.avg - minV) / range) * innerH;
    chart = (
      <>
        <line x1={pad} y1={avgY} x2={w - pad} y2={avgY} stroke={color} strokeOpacity={0.25} strokeWidth={1} strokeDasharray="3 3" />
        <path d={area} fill={color} fillOpacity={0.08} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={3} fill={color} />
      </>
    );
  } else {
    chart = (
      <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize={11} fontFamily="ui-monospace,monospace">
        raccolta dati… (1 campione / {Math.round(intervalMs / 1000)}s)
      </text>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</p>
        <span className="text-xl font-bold text-ink-900">{current}</span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-700 bg-brand-50 rounded px-1.5 py-0.5">
          ultime 24h
        </span>
        <span className="text-[10px] text-ink-400 font-mono">{n > 1 ? `${spanLabel} · ${n} campioni` : '—'}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-28 block">
        {chart}
      </svg>
      {stats && n > 1 && (
        <div className="grid grid-cols-3 gap-1 mt-2 text-center">
          {([['min', stats.min], ['medio', stats.avg], ['picco', stats.max]] as const).map(([k, v]) => (
            <div key={k}>
              <p className="text-[9px] uppercase tracking-wide text-ink-400">{k}</p>
              <p className="text-xs font-semibold text-ink-800 font-mono">{format(v)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
