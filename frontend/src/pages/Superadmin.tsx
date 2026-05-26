/**
 * Superadmin.tsx — Multi-tenant console per il ruolo superadmin.
 *
 * Layout/classi IDENTICI a js/views/superadmin.js (design system legacy.css).
 * Tutta la data-wiring (queries, mutations, polling) è preservata.
 * Renders inside AppLayout.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Building2,
  Download,
  Edit,
  Eye,
  Folder,
  LayoutGrid,
  List,
  Lock,
  Mail,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  Trophy,
  Undo2,
  X,
} from 'lucide-react';
import { httpErrorMessage } from '@/lib/api';
import {
  platformApi,
  type Tenant,
  type TenantStats,
  type TenantSmtp,
  type SystemSnapshot,
  type TenantPiano,
  type TenantStato,
  type ChangePlanBody,
  TENANT_PLANS,
} from '@/api/platform';
import { PIANI, pianoPriceLabel, pianoDurataLabel } from '@/lib/piani';

// ─── Local plan metadata (mirrors js/piani.js badge_color / limits) ──────────

// Catalogo piani: single source of truth in lib/piani.ts (port di js/piani.js).
// Prima era hardcoded qui con valori divergenti (prezzi/limiti errati).

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}g ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMb(mb: number): string {
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function cleanupCountdown(t: Tenant): string {
  if (!t.cleanupScheduledAt) return 'mai';
  const ms = new Date(t.cleanupScheduledAt).getTime() - Date.now();
  if (ms <= 0) return 'scaduto (in attesa job)';
  const days = Math.ceil(ms / 86400_000);
  return `tra ${days} ${days === 1 ? 'giorno' : 'giorni'}`;
}

function genPassword(len = 14): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%&*';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => chars[v % chars.length]).join('');
}

function kebabize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function passwordScore(pwd: string): number {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12 && /\d/.test(pwd)) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd) && pwd.length >= 10) score++;
  return Math.min(4, score);
}

// ─── Sub-components (design-system classes) ──────────────────────────────────

function StatoBadge({ stato }: { stato: TenantStato }) {
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

function PianoBadge({ piano }: { piano: TenantPiano }) {
  const p = PIANI[piano] ?? PIANI.trial;
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

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
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

function MiniBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit == null) return null;
  const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const color = used > limit ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1 bg-slate-200 rounded-full overflow-hidden mt-1 w-20 ml-auto">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-2">
      <div className="text-sm font-semibold text-ink-900 leading-none">{value}</div>
      <div className="text-[10px] text-ink-500 uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}

function KpiCard({
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

// Card risorsa con finestra 24h — SVG inline (no chart lib). Mostra valore
// corrente, span coperto, e statistiche min/medio/picco sulla serie storica
// campionata dal backend (1 campione/intervalMs, fino a 24h).
function ResourceCard24h({
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

// ─── Main page component ──────────────────────────────────────────────────────

export default function Superadmin() {
  const { t: _t } = useTranslation();
  const qc = useQueryClient();

  // ── State ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'dashboard' | 'config'>('dashboard');
  const [layout, setLayout] = useState<'grid' | 'table'>('grid');
  const [filter, setFilter] = useState({ stato: 'all', piano: 'all', search: '' });
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'nome', dir: 'asc' });

  // Dialogs
  const [newEnteOpen, setNewEnteOpen] = useState(false);
  const [editEnte, setEditEnte] = useState<Tenant | null>(null);
  const [detailEnte, setDetailEnte] = useState<Tenant | null>(null);
  const [changePlanEnte, setChangePlanEnte] = useState<Tenant | null>(null);
  const [smtpEnte, setSmtpEnte] = useState<Tenant | null>(null);
  const [auditEnte, setAuditEnte] = useState<Tenant | null>(null);
  const [backupsEnte, setBackupsEnte] = useState<Tenant | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const tenantsQ = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: () => platformApi.listTenants(),
    staleTime: 30_000,
  });
  const tenants = tenantsQ.data ?? [];

  const statsQ = useQuery({
    queryKey: ['platform', 'stats'],
    queryFn: async () => {
      const results = new Map<string, TenantStats>();
      await Promise.allSettled(
        (tenantsQ.data ?? []).map(async (ten) => {
          try {
            const s = await platformApi.getTenantStats(ten.id);
            results.set(ten.id, s);
          } catch { /* ignore */ }
        }),
      );
      return results;
    },
    enabled: (tenantsQ.data?.length ?? 0) > 0,
    staleTime: 60_000,
  });
  const statsMap: Map<string, TenantStats> = statsQ.data ?? new Map<string, TenantStats>();

  const smtpQ = useQuery({
    queryKey: ['platform', 'smtp'],
    queryFn: async () => {
      const results = new Map<string, TenantSmtp>();
      await Promise.allSettled(
        (tenantsQ.data ?? []).map(async (ten) => {
          try {
            const s = await platformApi.getTenantSmtp(ten.id);
            results.set(ten.id, s);
          } catch { /* ignore */ }
        }),
      );
      return results;
    },
    enabled: (tenantsQ.data?.length ?? 0) > 0,
    staleTime: 60_000,
  });
  const smtpMap: Map<string, TenantSmtp> = smtpQ.data ?? new Map<string, TenantSmtp>();

  // System + runtime (polling 5s when dashboard active)
  const systemQ = useQuery({
    queryKey: ['platform', 'system'],
    queryFn: () => platformApi.getSystem(),
    refetchInterval: activeTab === 'dashboard' ? 5000 : false,
    staleTime: 4000,
  });
  const sys: SystemSnapshot | undefined = systemQ.data;

  // Serie 24h RAM/CPU dal backend (ring buffer, 1 campione/60s). Polling più
  // rado dello snapshot live: la serie cambia di un punto al minuto.
  const systemHistoryQ = useQuery({
    queryKey: ['platform', 'system-history'],
    queryFn: () => platformApi.getSystemHistory(),
    refetchInterval: activeTab === 'dashboard' ? 60_000 : false,
    staleTime: 30_000,
  });

  const runtimeQ = useQuery({
    queryKey: ['platform', 'runtime'],
    queryFn: () => platformApi.getRuntime(),
    refetchInterval: activeTab === 'dashboard' ? 5000 : false,
    staleTime: 4000,
  });
  const runtimeMap: Record<string, { reqCountMin: number; latencyP50Ms: number; latencyP95Ms: number; errorRate: number }> =
    runtimeQ.data?.tenants ?? {};

  const configQ = useQuery({
    queryKey: ['platform', 'config'],
    queryFn: () => platformApi.getConfig(),
    enabled: activeTab === 'config',
    staleTime: 60_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidateAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    void qc.invalidateQueries({ queryKey: ['platform', 'stats'] });
    void qc.invalidateQueries({ queryKey: ['platform', 'smtp'] });
  }, [qc]);

  const lifecycleMut = useMutation({
    mutationFn: ({ id, op }: { id: string; op: 'suspend' | 'reactivate' | 'restore' }) =>
      op === 'suspend' ? platformApi.suspendTenant(id)
        : op === 'reactivate' ? platformApi.reactivateTenant(id)
          : platformApi.restoreTenant(id),
    onSuccess: () => { invalidateAll(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const archiveMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days?: number }) => platformApi.archiveTenant(id, days),
    onSuccess: () => { invalidateAll(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => platformApi.deleteTenant(id),
    onSuccess: () => { invalidateAll(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const q = filter.search.trim().toLowerCase();
  const filtered = tenants
    .filter((ten) => {
      if (filter.stato !== 'all' && ten.stato !== filter.stato) return false;
      if (filter.piano !== 'all' && ten.piano !== filter.piano) return false;
      if (q && !`${ten.nome} ${ten.slug}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const get = (x: Tenant): string | number => {
        switch (sort.col) {
          case 'nome': return x.nome.toLowerCase();
          case 'slug': return x.slug;
          case 'stato': return x.stato;
          case 'piano': return x.piano;
          case 'concorsi': return statsMap.get(x.id)?.concorsi ?? 0;
          case 'iscrizioni': return statsMap.get(x.id)?.iscrizioni ?? 0;
          case 'storage': return statsMap.get(x.id)?.diskUsageBytes ?? 0;
          case 'createdAt': return new Date(x.createdAt).getTime();
          default: return '';
        }
      };
      const va = get(a), vb = get(b);
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });

  // ── KPI ──────────────────────────────────────────────────────────────────
  const tot = tenants.length;
  const attivi = tenants.filter((ten) => ten.stato === 'attivo').length;
  const sospesi = tenants.filter((ten) => ten.stato === 'sospeso').length;
  const archiviati = tenants.filter((ten) => ten.stato === 'archiviato').length;
  let totConcorsi = 0, totDisk = 0, revenue = 0;
  for (const ten of tenants) {
    const s = statsMap.get(ten.id);
    if (s) { totConcorsi += s.concorsi; totDisk += s.diskUsageBytes; }
    const p = PIANI[ten.piano];
    if (ten.stato === 'attivo' && ten.piano !== 'ppe' && p?.prezzo) revenue += p.prezzo;
  }

  const rssMb = sys ? sys.memory.rss / (1024 * 1024) : null;
  const cpuPct = sys?.cpu?.processPct;
  const cores = sys?.cpu?.cores ?? 0;
  const sysVal = sys
    ? `${rssMb! < 1024 ? rssMb!.toFixed(0) + ' MB' : (rssMb! / 1024).toFixed(2) + ' GB'} · CPU ${typeof cpuPct === 'number' ? cpuPct.toFixed(1) : '—'}%`
    : 'n/d';
  const loadAvg1 = sys?.cpu?.loadAvg1;
  const loadAvgSysPct = cores > 0 && Number.isFinite(loadAvg1)
    ? Math.round((loadAvg1! / cores) * 100)
    : null;
  const sysSub = sys
    ? `heap ${(sys.memory.heapUsed / 1024 / 1024).toFixed(0)}/${(sys.memory.heapTotal / 1024 / 1024).toFixed(0)} MB · ${cores} core · load sistema ${loadAvgSysPct ?? '—'}% (media 60s) · up ${fmtUptime(sys.uptimeSec)}`
    : 'dati di sistema non disponibili';

  // ── Serie risorse 24h (dal backend) ───────────────────────────────────────
  const samples = systemHistoryQ.data?.samples ?? [];
  const histIntervalMs = systemHistoryQ.data?.intervalMs ?? 60_000;
  const rssSeries = samples.map((s) => s.rssMb);
  const cpuSeries = samples.map((s) => s.cpuPct);
  // Valore corrente: snapshot live (5s) se disponibile, altrimenti ultimo campione.
  const liveRssMb = sys ? sys.memory.rss / (1024 * 1024) : (rssSeries.at(-1) ?? null);
  const liveCpuPct = sys?.cpu?.processPct ?? cpuSeries.at(-1) ?? null;
  const cpuSeriesMax = cpuSeries.length ? Math.max(...cpuSeries) : 0;

  // ── Lifecycle helpers ─────────────────────────────────────────────────────
  function doLifecycle(ten: Tenant, op: 'suspend' | 'reactivate' | 'restore') {
    const verbs: Record<string, string> = { suspend: 'Sospendere', reactivate: 'Riattivare', restore: 'Ripristinare' };
    if (!window.confirm(`${verbs[op]} ente "${ten.nome}"?`)) return;
    lifecycleMut.mutate({ id: ten.id, op });
  }

  function doArchive(ten: Tenant) {
    const daysStr = window.prompt('Giorni prima del cleanup (0 = mai):', String(ten.cleanupAfterDays));
    if (daysStr === null) return;
    archiveMut.mutate({ id: ten.id, days: Number(daysStr) });
  }

  function doHardDelete(ten: Tenant) {
    if (!window.confirm(`Cancellare definitivamente "${ten.nome}"? Operazione IRREVERSIBILE.`)) return;
    const check = window.prompt(`Digita lo slug per confermare: ${ten.slug}`);
    if (check !== ten.slug) { toast.info('Slug non corretto: annullato'); return; }
    deleteMut.mutate(ten.id);
  }

  // ── Sort header ───────────────────────────────────────────────────────────
  function SortTh({ col, label, align = 'left' }: { col: string; label: string; align?: string }) {
    const active = sort.col === col;
    const dir = active ? sort.dir : null;
    const arrow = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '';
    return (
      <th
        className={`px-3 py-2.5 text-${align} text-[11px] uppercase tracking-wide font-semibold text-ink-700 cursor-pointer select-none hover:bg-slate-100`}
        onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
      >
        <span className="inline-flex items-center gap-1">
          {label} <span className="text-brand-600">{arrow}</span>
        </span>
      </th>
    );
  }

  // ── Action menu ───────────────────────────────────────────────────────────
  function ActionMenu({ ten }: { ten: Tenant }) {
    const [open, setOpen] = useState(false);
    const isPlatform = ten.slug === 'platform';

    interface MenuItem { label: string; icon: React.ElementType; action: () => void; color?: 'rose' | 'amber' | 'emerald' }
    const items: MenuItem[] = [
      { label: 'Dettaglio',    icon: Eye,      action: () => { setDetailEnte(ten); setOpen(false); } },
      { label: 'Cambia piano', icon: Star,     action: () => { setChangePlanEnte(ten); setOpen(false); } },
      { label: 'Audit log',    icon: List,     action: () => { setAuditEnte(ten); setOpen(false); } },
      { label: 'Backup',       icon: Download, action: () => { setBackupsEnte(ten); setOpen(false); } },
      { label: 'Configurazione SMTP', icon: Mail, action: () => { setSmtpEnte(ten); setOpen(false); } },
      { label: 'Modifica meta', icon: Edit,   action: () => { setEditEnte(ten); setOpen(false); } },
    ];
    if (!isPlatform) {
      if (ten.stato === 'attivo') {
        items.push({ label: 'Sospendi', icon: Pause,  color: 'amber', action: () => { setOpen(false); doLifecycle(ten, 'suspend'); } });
        items.push({ label: 'Archivia', icon: Folder, color: 'rose',  action: () => { setOpen(false); doArchive(ten); } });
      } else if (ten.stato === 'sospeso') {
        items.push({ label: 'Riattiva', icon: Play,   color: 'emerald', action: () => { setOpen(false); doLifecycle(ten, 'reactivate'); } });
        items.push({ label: 'Archivia', icon: Folder, color: 'rose',    action: () => { setOpen(false); doArchive(ten); } });
      } else if (ten.stato === 'archiviato') {
        items.push({ label: 'Ripristina',      icon: Undo2,  color: 'emerald', action: () => { setOpen(false); doLifecycle(ten, 'restore'); } });
        items.push({ label: 'Cancella subito', icon: Trash2, color: 'rose',    action: () => { setOpen(false); doHardDelete(ten); } });
      }
    }

    return (
      <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700"
          onClick={() => setOpen((v) => !v)}
          aria-label="Azioni"
          title="Azioni"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
              {items.map((it, i) => {
                const cls = it.color === 'rose' ? 'text-rose-700'
                  : it.color === 'amber' ? 'text-amber-700'
                  : it.color === 'emerald' ? 'text-emerald-700'
                  : 'text-ink-900';
                return (
                  <button
                    key={i}
                    className={`w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50 inline-flex items-center gap-2 ${cls}`}
                    onClick={it.action}
                  >
                    <it.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {it.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Ente card (grid layout) ───────────────────────────────────────────────
  function EnteCard({ ten }: { ten: Tenant }) {
    const stats = statsMap.get(ten.id);
    const smtp = smtpMap.get(ten.id);
    const rt = runtimeMap[ten.id];
    const isPlatform = ten.slug === 'platform';
    const piano = PIANI[ten.piano] ?? PIANI.trial;

    return (
      <article
        className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
        data-ente-id={ten.id}
        onClick={() => setDetailEnte(ten)}
        style={{ cursor: 'pointer' }}
      >
        <header className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold text-ink-900 truncate leading-tight">{ten.nome}</h3>
              <p className="text-xs text-ink-500 mt-1 flex items-center gap-1.5">
                <code className="font-mono">{ten.slug}</code>
                {isPlatform && (
                  <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700 px-1.5 rounded">super-admin</span>
                )}
              </p>
            </div>
            <ActionMenu ten={ten} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <StatoBadge stato={ten.stato} />
            <PianoBadge piano={ten.piano} />
            {ten.pianoScadenza && (
              <span className="text-[11px] text-ink-500">scade {fmtDate(ten.pianoScadenza)}</span>
            )}
          </div>
        </header>

        <div className="px-4 py-3 space-y-3">
          <UsageBar label="Concorsi" used={stats?.concorsi ?? 0} limit={piano.limit_concorsi} />
          <UsageBar label="Iscrizioni / anno" used={stats?.iscrizioni ?? 0} limit={piano.limit_iscritti_annui} />
        </div>

        <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-3 gap-2">
          <StatTile value={stats?.commissari ?? '·'} label="commissari" />
          <StatTile value={stats?.candidati ?? '·'} label="candidati" />
          <StatTile value={stats?.accounts ?? '·'} label="account" />
        </div>

        <footer className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-ink-700 inline-flex items-center gap-1.5">
            <Folder className="w-3 h-3" />
            <strong>{stats ? fmtBytes(stats.diskUsageBytes ?? 0) : '·'}</strong>
          </span>
          <span className="text-ink-700 inline-flex items-center gap-1.5">
            {smtp?.configured
              ? <span className="inline-flex items-center gap-1 text-emerald-700"><Mail className="w-3 h-3" />SMTP</span>
              : <span className="text-ink-500">no SMTP</span>}
            {ten.require2faAdmin && (
              <span className="inline-flex items-center gap-1 text-indigo-700 ml-2"><Lock className="w-3 h-3" />2FA</span>
            )}
          </span>
        </footer>

        {/* Runtime row */}
        <div className="px-4 py-1.5 border-t border-slate-100 bg-white text-right">
          {rt && rt.reqCountMin > 0 ? (
            <span className={`text-[10px] font-mono ${rt.errorRate > 0 ? 'text-rose-700' : 'text-ink-700'}`}>
              {rt.reqCountMin} req/min · p50 {rt.latencyP50Ms}ms · p95 {rt.latencyP95Ms}ms
              {rt.errorRate > 0 && ` · ${Math.round(rt.errorRate * 100)}% err`}
            </span>
          ) : (
            <span className="text-[10px] text-ink-500 font-mono">idle</span>
          )}
        </div>

        {ten.stato === 'archiviato' && (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 flex items-center gap-1.5">
            Cleanup {cleanupCountdown(ten)}
          </div>
        )}
      </article>
    );
  }

  // ── Table row (table layout) ──────────────────────────────────────────────
  function TableRow({ ten }: { ten: Tenant }) {
    const stats = statsMap.get(ten.id);
    const rt = runtimeMap[ten.id];
    const piano = PIANI[ten.piano] ?? PIANI.trial;
    const concorsiUsed = stats?.concorsi ?? 0;

    return (
      <tr
        className="hover:bg-slate-50"
        data-ente-id={ten.id}
        onClick={() => setDetailEnte(ten)}
        style={{ cursor: 'pointer' }}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <div className="font-medium text-ink-900 truncate">{ten.nome}</div>
              <code className="text-xs text-ink-500">{ten.slug}</code>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5"><StatoBadge stato={ten.stato} /></td>
        <td className="px-3 py-2.5"><PianoBadge piano={ten.piano} /></td>
        <td className="px-3 py-2.5 text-right">
          <div className="text-ink-900 font-medium">
            {concorsiUsed}
            {piano.limit_concorsi != null && (
              <span className="text-ink-500 font-normal"> / {piano.limit_concorsi}</span>
            )}
          </div>
          <MiniBar used={concorsiUsed} limit={piano.limit_concorsi} />
        </td>
        <td className="px-3 py-2.5 text-right text-ink-900">{stats?.iscrizioni ?? '·'}</td>
        <td className="px-3 py-2.5 text-right text-ink-700">{stats ? fmtBytes(stats.diskUsageBytes ?? 0) : '·'}</td>
        <td className="px-3 py-2.5 text-right">
          {rt && rt.reqCountMin > 0 ? (
            <span className={`text-[10px] font-mono ${rt.errorRate > 0 ? 'text-rose-700' : 'text-ink-700'}`}>
              {rt.reqCountMin} req/min · p50 {rt.latencyP50Ms}ms · p95 {rt.latencyP95Ms}ms
              {rt.errorRate > 0 && ` · ${Math.round(rt.errorRate * 100)}% err`}
            </span>
          ) : (
            <span className="text-[10px] text-ink-500 font-mono">idle</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right text-ink-700 text-xs">{fmtDate(ten.createdAt)}</td>
        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="relative inline-block">
            <ActionMenu ten={ten} />
          </div>
        </td>
      </tr>
    );
  }

  // ── Dashboard view ────────────────────────────────────────────────────────
  function DashboardView() {
    return (
      <div className="space-y-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard
            label="Enti totali"
            value={tot}
            sub={`${attivi} attivi · ${sospesi} sospesi · ${archiviati} archiviati`}
            accent="brand"
            icon={Building2}
          />
          <KpiCard
            label="Concorsi gestiti"
            value={totConcorsi}
            sub="somma su tutti i tenant"
            accent="amber"
            icon={Trophy}
          />
          <KpiCard
            label="Sistema"
            value={sysVal}
            sub={sysSub}
            accent="sky"
            icon={Shield}
          />
          <KpiCard
            label="Storage uploads"
            value={fmtBytes(totDisk)}
            sub="allegati iscrizioni/foto"
            accent="slate"
            icon={Folder}
          />
          <KpiCard
            label="Revenue stimato"
            value={`€${revenue.toLocaleString('it-IT')}`}
            sub="piani attivi/anno"
            accent="emerald"
            icon={Star}
          />
        </div>

        {/* Risorse processo — finestra 24h (serie dal backend) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ResourceCard24h
            label="Memoria processo (RSS)"
            current={liveRssMb != null ? formatMb(liveRssMb) : 'n/d'}
            series={rssSeries}
            color="#0ea5e9"
            format={formatMb}
            intervalMs={histIntervalMs}
          />
          <ResourceCard24h
            label="CPU processo Node"
            current={liveCpuPct != null ? `${liveCpuPct.toFixed(1)}%` : 'n/d'}
            series={cpuSeries}
            color="#10b981"
            format={(v) => `${v.toFixed(1)}%`}
            yMax={Math.max(100, cpuSeriesMax * 1.1)}
            intervalMs={histIntervalMs}
          />
        </div>

        {/* Toolbar */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              id="sa-search"
              type="search"
              placeholder="Cerca per nome o slug…"
              className="c-input c-input--sm w-full"
              style={{ paddingLeft: '2.25rem' }}
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <select
            id="sa-stato-filter"
            className="c-input c-input--sm"
            title="Filtra per stato"
            value={filter.stato}
            onChange={(e) => setFilter((f) => ({ ...f, stato: e.target.value }))}
          >
            <option value="all">Tutti gli stati</option>
            <option value="attivo">Attivi</option>
            <option value="sospeso">Sospesi</option>
            <option value="archiviato">Archiviati</option>
          </select>
          <select
            id="sa-piano-filter"
            className="c-input c-input--sm"
            title="Filtra per piano"
            value={filter.piano}
            onChange={(e) => setFilter((f) => ({ ...f, piano: e.target.value }))}
          >
            <option value="all">Tutti i piani</option>
            {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}</option>)}
          </select>
          <div className="inline-flex border border-slate-200 rounded-md p-0.5 bg-slate-50" role="tablist">
            {(['grid', 'table'] as const).map((l) => (
              <button
                key={l}
                data-layout={l}
                className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors${layout === l ? ' bg-white shadow-sm text-ink-900' : ' text-ink-500'}`}
                title={l === 'grid' ? 'Vista griglia' : 'Vista tabella'}
                onClick={() => setLayout(l)}
              >
                {l === 'grid' ? <LayoutGrid className="w-3 h-3" /> : <List className="w-3 h-3" />}
                {l === 'grid' ? 'Grid' : 'Table'}
              </button>
            ))}
          </div>
          <button
            data-action="refresh"
            className="c-btn c-btn--ghost c-btn--sm"
            title="Ricarica"
            onClick={() => tenantsQ.refetch()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            data-action="new-ente"
            className="c-btn c-btn--primary c-btn--sm"
            onClick={() => setNewEnteOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" /><span>Nuovo ente</span>
          </button>
        </div>

        {/* List */}
        {tenantsQ.isLoading ? (
          <div className="text-center py-10 text-ink-700 text-sm">Caricamento…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl py-16 text-center">
            <div className="inline-flex w-12 h-12 rounded-full bg-slate-100 text-slate-500 items-center justify-center mb-3">
              <Search className="w-5 h-5" />
            </div>
            <p className="text-sm text-ink-700 font-medium">Nessun ente corrisponde ai filtri.</p>
            <p className="text-xs text-ink-500 mt-1">Prova a cambiare stato, piano o ricerca testuale.</p>
          </div>
        ) : layout === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ten) => <EnteCard key={ten.id} ten={ten} />)}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <SortTh col="nome" label="Ente" />
                    <SortTh col="stato" label="Stato" />
                    <SortTh col="piano" label="Piano" />
                    <SortTh col="concorsi" label="Concorsi" align="right" />
                    <SortTh col="iscrizioni" label="Iscrizioni" align="right" />
                    <SortTh col="storage" label="Storage" align="right" />
                    <th
                      className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-700"
                      title="Richieste e latenza mediana sull'ultimo minuto"
                    >
                      Attività (60s)
                    </th>
                    <SortTh col="createdAt" label="Creato" align="right" />
                    <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-700">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((ten) => <TableRow key={ten.id} ten={ten} />)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Config view ───────────────────────────────────────────────────────────
  function ConfigView() {
    const [cleanup, setCleanup] = useState<number | undefined>(undefined);
    const [require2fa, setRequire2fa] = useState<boolean | undefined>(undefined);
    const cfg = configQ.data;
    const effCleanup = cleanup ?? cfg?.defaultCleanupDays ?? 30;
    const eff2fa = require2fa ?? cfg?.require2faSuperadmin ?? false;

    const saveMut = useMutation({
      mutationFn: () => platformApi.updateConfig({ defaultCleanupDays: effCleanup, require2faSuperadmin: eff2fa }),
      onSuccess: () => { toast.success('Configurazione salvata'); void qc.invalidateQueries({ queryKey: ['platform', 'config'] }); },
      onError: (err) => toast.error(httpErrorMessage(err)),
    });

    return (
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-ink-900 mb-1">Configurazione piattaforma</h2>
        <p className="text-sm text-ink-700 mb-5">Impostazioni globali applicate a tutti i tenant.</p>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-ink-900">Default cleanup days</label>
            <input
              id="cfg-cleanup"
              type="number"
              className="c-input mt-1"
              min={0}
              max={3650}
              value={effCleanup}
              onChange={(e) => setCleanup(Number(e.target.value))}
            />
            <p className="text-xs text-ink-700 mt-1.5">
              Giorni di default tra archiviazione e hard-delete (0 = mai). Override per-tenant disponibile da "Modifica ente".
            </p>
          </div>
          <div className="pt-3 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
              <input
                id="cfg-2fa"
                type="checkbox"
                checked={eff2fa}
                onChange={(e) => setRequire2fa(e.target.checked)}
              />
              <span>Richiedi 2FA TOTP a tutti i super-admin</span>
            </label>
            <p className="text-xs text-ink-700 mt-1 ml-6">
              Al prossimo login gli account super-admin saranno forzati al setup TOTP.
            </p>
          </div>
          <div className="pt-3 border-t border-slate-100">
            <button
              data-action="cfg-save"
              className="c-btn c-btn--primary c-btn--sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
            >
              <span>{saveMut.isPending ? 'Salvataggio…' : 'Salva configurazione'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="bg-slate-50 min-h-screen view-fade">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600 text-white inline-flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500 font-medium leading-none">Gestimus · Super-admin</p>
              <h1 className="text-base font-semibold text-ink-900 leading-tight">Piattaforma</h1>
            </div>
          </div>
          <nav className="flex items-center gap-1" id="sa-nav">
            {(['dashboard', 'config'] as const).map((tab) => (
              <button
                key={tab}
                data-tab={tab}
                onClick={() => setActiveTab(tab)}
                className={`sa-nav-btn inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors${
                  activeTab === tab
                    ? ' bg-brand-50 text-brand-700'
                    : ' text-ink-700 hover:bg-slate-100'
                }`}
              >
                {tab === 'dashboard' ? <LayoutGrid className="w-3.5 h-3.5" /> : <Settings className="w-3.5 h-3.5" />}
                <span>{tab === 'dashboard' ? 'Dashboard' : 'Configurazione'}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6" id="sa-main">
        {activeTab === 'dashboard' ? <DashboardView /> : <ConfigView />}
      </main>

      {/* ── Overlays ── */}

      {detailEnte && (
        <DetailDrawer
          t={detailEnte}
          statsMap={statsMap}
          smtpMap={smtpMap}
          onClose={() => setDetailEnte(null)}
          onEdit={(ten) => { setDetailEnte(null); setEditEnte(ten); }}
          onSmtp={(ten) => { setDetailEnte(null); setSmtpEnte(ten); }}
          onAudit={(ten) => { setDetailEnte(null); setAuditEnte(ten); }}
          onBackups={(ten) => { setDetailEnte(null); setBackupsEnte(ten); }}
        />
      )}

      {newEnteOpen && (
        <NewEnteDialog
          existingSlugs={tenants.map((ten) => ten.slug)}
          onClose={() => setNewEnteOpen(false)}
          onCreated={() => { setNewEnteOpen(false); invalidateAll(); }}
        />
      )}

      {editEnte && (
        <EditMetaDialog
          t={editEnte}
          onClose={() => setEditEnte(null)}
          onSaved={() => { setEditEnte(null); invalidateAll(); }}
        />
      )}

      {changePlanEnte && (
        <ChangePlanDialog
          t={changePlanEnte}
          onClose={() => setChangePlanEnte(null)}
          onSaved={() => { setChangePlanEnte(null); invalidateAll(); }}
        />
      )}

      {smtpEnte && (
        <SmtpDialog
          t={smtpEnte}
          smtp={smtpMap.get(smtpEnte.id)}
          onClose={() => setSmtpEnte(null)}
          onSaved={() => { setSmtpEnte(null); invalidateAll(); }}
        />
      )}

      {auditEnte && (
        <AuditDialog t={auditEnte} onClose={() => setAuditEnte(null)} />
      )}

      {backupsEnte && (
        <BackupsDialog
          t={backupsEnte}
          onClose={() => setBackupsEnte(null)}
          onCleanupRun={() => { setBackupsEnte(null); invalidateAll(); }}
        />
      )}
    </div>
  );
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function DetailDrawer({
  t, statsMap, smtpMap, onClose, onEdit, onSmtp, onAudit, onBackups,
}: {
  t: Tenant;
  statsMap: Map<string, TenantStats>;
  smtpMap: Map<string, TenantSmtp>;
  onClose: () => void;
  onEdit: (t: Tenant) => void;
  onSmtp: (t: Tenant) => void;
  onAudit: (t: Tenant) => void;
  onBackups: (t: Tenant) => void;
}) {
  const stats = statsMap.get(t.id);
  const smtp = smtpMap.get(t.id);
  const piano = (t.piano in (PIANI as object)) ? PIANI[t.piano] : PIANI.trial;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative w-full sm:max-w-md bg-white shadow-xl flex flex-col h-full">
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Dettaglio ente</p>
            <h2 className="text-lg font-semibold text-ink-900 truncate">{t.nome}</h2>
            <p className="text-xs text-ink-500 mt-0.5"><code>{t.slug}</code></p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StatoBadge stato={t.stato} />
              <PianoBadge piano={t.piano} />
              {t.pianoScadenza && (
                <span className="text-[11px] text-ink-700">scade {fmtDate(t.pianoScadenza)}</span>
              )}
            </div>
          </div>
          <button
            className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700"
            onClick={onClose}
            aria-label="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Risorse</h3>
            <div className="space-y-3">
              <UsageBar label="Concorsi" used={stats?.concorsi ?? 0} limit={piano.limit_concorsi} />
              <UsageBar label="Iscrizioni / anno" used={stats?.iscrizioni ?? 0} limit={piano.limit_iscritti_annui} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <StatTile value={stats?.commissari ?? '·'} label="commissari" />
              <StatTile value={stats?.candidati ?? '·'} label="candidati" />
              <StatTile value={stats?.accounts ?? '·'} label="account" />
            </div>
            <div className="flex items-center justify-between text-xs text-ink-700 mt-3 pt-3 border-t border-slate-100">
              <span className="inline-flex items-center gap-1.5"><Folder className="w-3 h-3" />Storage uploads</span>
              <strong className="text-ink-900">{stats ? fmtBytes(stats.diskUsageBytes ?? 0) : '·'}</strong>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Configurazione</h3>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-ink-700">Dominio custom</dt>
                <dd>{t.dominio ? t.dominio : <span className="text-ink-500 italic">—</span>}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">Cleanup days</dt>
                <dd>{t.cleanupAfterDays === 0 ? <span className="italic">mai</span> : t.cleanupAfterDays}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">2FA admin</dt>
                <dd>{t.require2faAdmin ? 'richiesto' : 'opzionale'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">SMTP</dt>
                <dd>{smtp?.configured
                  ? `configurato${smtp.encrypted ? ' (cifrato)' : ''}`
                  : <span className="text-ink-500 italic">non configurato</span>}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">Creato il</dt>
                <dd>{fmtDate(t.createdAt)}</dd>
              </div>
              {t.stato === 'archiviato' && (
                <div className="flex justify-between">
                  <dt className="text-ink-700">Cleanup</dt>
                  <dd className="text-amber-700">{cleanupCountdown(t)}</dd>
                </div>
              )}
            </dl>
          </section>

          {t.note && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Note</h3>
              <p className="text-sm text-ink-700 whitespace-pre-wrap">{t.note}</p>
            </section>
          )}
        </div>

        <footer className="border-t border-slate-200 px-5 py-3 bg-slate-50 flex flex-wrap gap-2">
          <button
            data-drawer-act="audit"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => onAudit(t)}
          >
            <List className="w-3.5 h-3.5" /><span>Audit</span>
          </button>
          <button
            data-drawer-act="backup"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => onBackups(t)}
          >
            <Download className="w-3.5 h-3.5" /><span>Backup</span>
          </button>
          <button
            data-drawer-act="smtp"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => onSmtp(t)}
          >
            <Mail className="w-3.5 h-3.5" /><span>SMTP</span>
          </button>
          <button
            data-drawer-act="edit"
            className="c-btn c-btn--primary c-btn--sm ml-auto"
            onClick={() => onEdit(t)}
          >
            <Edit className="w-3.5 h-3.5" /><span>Modifica</span>
          </button>
        </footer>
      </aside>
    </div>
  );
}

// ─── UsageBar (exported for drawer) — already defined above as component ──────

// ─── NewEnteDialog ────────────────────────────────────────────────────────────

function NewEnteDialog({ existingSlugs, onClose, onCreated }: {
  existingSlugs: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [piano, setPiano] = useState<TenantPiano>('trial');
  const [pianoScadenza, setPianoScadenza] = useState('');
  const [cleanupDays, setCleanupDays] = useState(30);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPass, setAdminPass] = useState(genPassword);
  const [showPass, setShowPass] = useState(true);
  const reserved = new Set([...existingSlugs.map((s) => s.toLowerCase()), 'platform']);

  const slugErr = (() => {
    if (!slug) return '';
    if (slug.length < 2 || slug.length > 63) return `Lunghezza fuori range (${slug.length})`;
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return 'Solo a-z, 0-9 e trattino.';
    if (reserved.has(slug)) return `Slug "${slug}" già in uso o riservato`;
    return '';
  })();

  useEffect(() => {
    if (!slugTouched) setSlug(kebabize(nome));
  }, [nome, slugTouched]);

  const score = passwordScore(adminPass);
  const scoreCls = ['', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'][score];
  const scoreLabel = ['', 'Debole', 'Media', 'Buona', 'Forte'][score];

  const createMut = useMutation({
    mutationFn: () => platformApi.createTenant({
      slug, nome, piano, pianoScadenza: pianoScadenza || null, cleanupAfterDays: cleanupDays,
      adminEmail, adminPassword: adminPass,
    }),
    onSuccess: () => { toast.success(`Ente "${slug}" creato. Comunica le credenziali in modo sicuro.`); onCreated(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Nuovo ente</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Step 1: Identificazione */}
          <section>
            <header className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">1</span>
              <h3 className="text-sm font-semibold text-ink-900">Identificazione</h3>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">
                  Nome ente <span className="text-rose-600">*</span>
                </label>
                <input
                  className="c-input"
                  placeholder="es. Conservatorio Verdi"
                  autoComplete="off"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
                <p className="text-xs text-ink-500 mt-1">Visibile agli utenti del tenant.</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">
                  Slug <span className="text-rose-600">*</span>
                </label>
                <input
                  className="c-input font-mono text-sm"
                  placeholder="conservatorio-verdi"
                  autoComplete="off"
                  value={slug}
                  onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
                />
                {slugErr
                  ? <p className="text-xs text-rose-700 mt-1">{slugErr}</p>
                  : slug
                    ? <p className="text-xs text-brand-700 mt-1 font-mono">→ {slug}.gestimus.local:4000</p>
                    : <p className="text-xs text-ink-500 mt-1">2-63 caratteri, kebab-case (a-z, 0-9, trattino).</p>}
              </div>
            </div>
          </section>

          {/* Step 2: Piano */}
          <section>
            <header className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">2</span>
              <h3 className="text-sm font-semibold text-ink-900">Piano</h3>
              <span className="text-xs text-ink-500">— modificabile in seguito da "Cambia piano"</span>
            </header>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TENANT_PLANS.map((k) => (
                <label
                  key={k}
                  className={`cursor-pointer block border-2 rounded-lg p-3 transition-colors${piano === k ? ' border-brand-500 bg-brand-50' : ' border-slate-200 hover:border-slate-300'}`}
                  onClick={() => setPiano(k)}
                >
                  <input type="radio" name="ne-piano" value={k} checked={piano === k} onChange={() => setPiano(k)} className="sr-only" />
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-semibold text-ink-900">
                      {PIANI[k].nome}
                      {PIANI[k].featured && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 bg-brand-100 rounded px-1.5 py-0.5">consigliato</span>
                      )}
                    </span>
                    <span className="text-xs text-ink-700">{pianoPriceLabel(k)}</span>
                  </div>
                  <p className="text-[11px] text-ink-600 leading-snug">{PIANI[k].descrizione}</p>
                  <div className="mt-1 text-[11px] text-ink-500 flex gap-3">
                    <span>📊 {PIANI[k].limit_concorsi ?? '∞'} concorsi</span>
                    <span>👥 {PIANI[k].limit_iscritti_annui ?? '∞'} iscr/anno</span>
                  </div>
                  {piano === k && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-emerald-700 font-medium inline-flex items-center gap-1">
                      Selezionato
                    </div>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">Cleanup days post-archiviazione</label>
                <input
                  type="number"
                  className="c-input"
                  min={0}
                  max={3650}
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                />
                <p className="text-xs text-ink-500 mt-1">Giorni tra archiviazione e hard-delete (0 = mai).</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Scadenza piano</label>
                <input
                  type="date"
                  className="c-input"
                  value={pianoScadenza}
                  onChange={(e) => setPianoScadenza(e.target.value)}
                />
                <p className="text-xs text-ink-500 mt-1">Lascia vuoto se non scade.</p>
              </div>
            </div>
          </section>

          {/* Step 3: Amministratore */}
          <section>
            <header className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">3</span>
              <h3 className="text-sm font-semibold text-ink-900">Primo amministratore</h3>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">
                  Email admin <span className="text-rose-600">*</span>
                </label>
                <input
                  type="email"
                  className="c-input"
                  placeholder="admin@ente.it"
                  autoComplete="off"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">
                  Password <span className="text-rose-600">*</span>
                </label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showPass ? 'text' : 'password'}
                      className="c-input pr-9 font-mono text-sm"
                      autoComplete="new-password"
                      value={adminPass}
                      onChange={(e) => setAdminPass(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-ink-700 hover:text-ink-900"
                      title="Nascondi/mostra"
                      onClick={() => setShowPass((v) => !v)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="c-btn c-btn--ghost c-btn--sm"
                    title="Genera nuova"
                    onClick={() => { setAdminPass(genPassword()); setShowPass(true); }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="c-btn c-btn--ghost c-btn--sm"
                    title="Copia"
                    onClick={() => { void navigator.clipboard.writeText(adminPass); toast.success('Password copiata negli appunti'); }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-1.5">
                  <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${scoreCls}`} style={{ width: `${score * 25}%` }} />
                  </div>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    {adminPass ? `Robustezza: ${scoreLabel}${adminPass.length < 8 ? ' (min 8 caratteri)' : ''}` : ''}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
              <span>Comunica le credenziali al cliente in modo sicuro (gestore password, mai email in chiaro). L'admin può cambiare la password al primo accesso.</span>
            </div>
          </section>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button
            className="c-btn c-btn--primary c-btn--sm"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !!slugErr || !slug || !nome || !adminEmail || adminPass.length < 8}
          >
            {createMut.isPending ? 'Creazione…' : 'Crea ente'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditMetaDialog ───────────────────────────────────────────────────────────

function EditMetaDialog({ t, onClose, onSaved }: { t: Tenant; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState(t.nome);
  const [piano, setPiano] = useState<TenantPiano>(t.piano);
  const [pianoScadenza, setPianoScadenza] = useState(t.pianoScadenza ?? '');
  const [dominio, setDominio] = useState(t.dominio ?? '');
  const [cleanupDays, setCleanupDays] = useState(t.cleanupAfterDays);
  const [require2fa, setRequire2fa] = useState(t.require2faAdmin);
  const [note, setNote] = useState(t.note ?? '');

  const mut = useMutation({
    mutationFn: () => platformApi.updateTenant(t.id, {
      nome, piano, pianoScadenza: pianoScadenza || null,
      dominio: dominio.trim() || null, cleanupAfterDays: cleanupDays,
      require2faAdmin: require2fa, note: note.trim() || null,
    }),
    onSuccess: () => { toast.success('Modifiche salvate'); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Modifica {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-ink-900">Nome ente</label>
            <input className="c-input mt-1" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-ink-900">Piano</label>
              <select
                className="c-input mt-1"
                value={piano}
                onChange={(e) => setPiano(e.target.value as TenantPiano)}
              >
                {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-ink-900">Scadenza piano</label>
              <input type="date" className="c-input mt-1" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-ink-900">Dominio custom</label>
            <input className="c-input mt-1" value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="es. ente1.gestimus.it" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-ink-900">Cleanup days (0 = mai)</label>
              <input type="number" className="c-input mt-1" min={0} max={3650} value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium block text-ink-900">2FA admin</label>
              <label className="inline-flex items-center gap-2 mt-2">
                <input type="checkbox" checked={require2fa} onChange={(e) => setRequire2fa(e.target.checked)} />
                <span className="text-sm">Richiesto per gli admin</span>
              </label>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-ink-900">Note</label>
            <textarea className="c-input mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button className="c-btn c-btn--primary c-btn--sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ChangePlanDialog ─────────────────────────────────────────────────────────

function ChangePlanDialog({ t, onClose, onSaved }: { t: Tenant; onClose: () => void; onSaved: () => void }) {
  const [piano, setPiano] = useState<TenantPiano>(t.piano);
  const [pianoScadenza, setPianoScadenza] = useState(t.pianoScadenza ?? '');
  const [maxConcorsi, setMaxConcorsi] = useState('');
  const [maxCommissari, setMaxCommissari] = useState('');
  const [maxCandidati, setMaxCandidati] = useState('');

  const configQ = useQuery({
    queryKey: ['platform', 'config', t.id],
    queryFn: () => platformApi.getTenantConfig(t.id),
  });
  useEffect(() => {
    const cfg = configQ.data;
    if (cfg) {
      setMaxConcorsi(cfg.maxConcorsi != null ? String(cfg.maxConcorsi) : '');
      setMaxCommissari(cfg.maxCommissari != null ? String(cfg.maxCommissari) : '');
      setMaxCandidati(cfg.maxCandidatiPerConcorso != null ? String(cfg.maxCandidatiPerConcorso) : '');
    }
  }, [configQ.data]);

  const parseOpt = (v: string): number | null => v.trim() === '' ? null : Number(v);

  const selectedPiano = PIANI[piano] ?? PIANI.trial;
  const changed = piano !== t.piano;

  const mut = useMutation({
    mutationFn: () => {
      const body: ChangePlanBody = {
        piano, pianoScadenza: pianoScadenza || null,
        overrides: {
          maxConcorsi: parseOpt(maxConcorsi),
          maxCommissari: parseOpt(maxCommissari),
          maxCandidatiPerConcorso: parseOpt(maxCandidati),
        },
      };
      return platformApi.changePlan(t.id, body);
    },
    onSuccess: () => { toast.success(`Piano aggiornato: ${piano}`); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Cambia piano — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Piano attuale */}
          <section className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Piano attualmente attivo</h3>
              <PianoBadge piano={t.piano} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div><span className="text-ink-700">Scadenza:</span> <strong>{t.pianoScadenza ? fmtDate(t.pianoScadenza) : <em className="font-normal text-ink-500">non impostata</em>}</strong></div>
              <div><span className="text-ink-700">Limite concorsi:</span> <strong>{(PIANI[t.piano]?.limit_concorsi ?? null) == null ? <em className="font-normal text-ink-500">illimitato</em> : PIANI[t.piano].limit_concorsi}</strong></div>
            </div>
          </section>

          {/* Nuovo piano */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Nuovo piano</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">Piano</label>
                <select className="c-input" value={piano} onChange={(e) => setPiano(e.target.value as TenantPiano)}>
                  {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}{k === t.piano ? ' (attuale)' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Scadenza piano</label>
                <input type="date" className="c-input" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} />
                <p className="text-xs text-ink-500 mt-1">Lascia vuoto se non scade.</p>
              </div>
            </div>
            <div className="mt-3 bg-brand-50 border border-brand-100 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <strong className="text-ink-900">{selectedPiano.nome}</strong>
                <span className="text-ink-700">·</span>
                <span className="text-ink-700">{pianoPriceLabel(piano)}</span>
                {changed
                  ? <span className="ml-auto text-xs text-emerald-700 font-medium">↑ cambio</span>
                  : <span className="ml-auto text-xs text-ink-500">nessun cambio</span>}
              </div>
              <p className="text-xs text-ink-600 mb-1">{selectedPiano.descrizione}</p>
              <p className="text-[11px] text-ink-500">Durata: {pianoDurataLabel(piano)}</p>
              <ul className="text-xs text-ink-900 grid sm:grid-cols-2 gap-1 mt-2">
                <li>Concorsi: <strong>{selectedPiano.limit_concorsi ?? <em className="font-normal">illimitato</em>}</strong></li>
                <li>Iscrizioni/anno: <strong>{selectedPiano.limit_iscritti_annui ?? <em className="font-normal">illimitato</em>}</strong></li>
              </ul>
            </div>
          </section>

          {/* Override limiti */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Override limiti per-tenant (opzionale)</h3>
            <p className="text-xs text-ink-700 mb-3">Imposta un override solo se vuoi forzare un limite diverso da quello di default del piano. Lascia vuoto per ereditare il piano.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium block mb-1">maxConcorsi</label>
                <input type="number" min={0} className="c-input c-input--sm" placeholder="usa piano" value={maxConcorsi} onChange={(e) => setMaxConcorsi(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">maxCommissari</label>
                <input type="number" min={0} className="c-input c-input--sm" placeholder="usa piano" value={maxCommissari} onChange={(e) => setMaxCommissari(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">maxCandidatiPerConcorso</label>
                <input type="number" min={0} className="c-input c-input--sm" placeholder="usa piano" value={maxCandidati} onChange={(e) => setMaxCandidati(e.target.value)} />
              </div>
            </div>
          </section>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button className="c-btn c-btn--primary c-btn--sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Salvataggio…' : 'Conferma cambio piano'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SmtpDialog ───────────────────────────────────────────────────────────────

function SmtpDialog({ t, smtp, onClose, onSaved }: { t: Tenant; smtp?: TenantSmtp; onClose: () => void; onSaved: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [secure, setSecure] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => platformApi.setTenantSmtp(t.id, { host, port, user, password: pass, from, secure }),
    onSuccess: () => { toast.success('SMTP salvato'); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const delMut = useMutation({
    mutationFn: () => platformApi.deleteTenantSmtp(t.id),
    onSuccess: () => { toast.success('SMTP rimosso'); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">SMTP — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-ink-700">
            Stato: <strong>{smtp?.configured ? `configurato${smtp.encrypted ? ' (cifrato)' : ''}` : 'non configurato'}</strong>. La password è cifrata AES-GCM at-rest.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Host</label>
              <input className="c-input mt-0.5" placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Port</label>
              <input type="number" className="c-input mt-0.5" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
          </div>
          <div><label className="text-sm font-medium">User</label><input className="c-input mt-0.5" value={user} onChange={(e) => setUser(e.target.value)} /></div>
          <div><label className="text-sm font-medium">Password</label><input type="password" className="c-input mt-0.5" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          <div>
            <label className="text-sm font-medium">From</label>
            <input className="c-input mt-0.5" placeholder='"Gestimus" <noreply@ente.it>' value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm mt-1">
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
            <span>Connessione SSL/TLS implicita (porta 465)</span>
          </label>
          {smtp?.configured && (
            <div className="pt-2 border-t border-slate-200">
              <button
                className="c-btn c-btn--ghost c-btn--sm text-rose-700"
                onClick={() => { if (window.confirm(`Rimuovere la configurazione SMTP di ${t.nome}?`)) delMut.mutate(); }}
              >
                <Trash2 className="w-3.5 h-3.5" /><span>Rimuovi configurazione attuale</span>
              </button>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button
            className="c-btn c-btn--primary c-btn--sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !host || !user || !pass || !from}
          >
            {saveMut.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AuditDialog ──────────────────────────────────────────────────────────────

function AuditDialog({ t, onClose }: { t: Tenant; onClose: () => void }) {
  const auditQ = useQuery({
    queryKey: ['platform', 'audit', t.id],
    queryFn: () => platformApi.getAudit({ tenantId: t.id, limit: 100 }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Audit log — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-x-auto max-h-[60vh] px-1">
          {auditQ.isLoading
            ? <p className="text-sm text-ink-700 italic p-4">Caricamento…</p>
            : (auditQ.data?.length ?? 0) === 0
              ? <p className="text-sm text-ink-700 italic p-4">Nessuna riga di audit per questo tenant.</p>
              : (
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-ink-700">Quando</th>
                      <th className="px-3 py-2 font-semibold text-ink-700">Action</th>
                      <th className="px-3 py-2 font-semibold text-ink-700">Payload</th>
                      <th className="px-3 py-2 font-semibold text-ink-700">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditQ.data!.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-700">{fmtDate(r.createdAt)}</td>
                        <td className="px-3 py-2"><code>{r.action}</code></td>
                        <td className="px-3 py-2"><pre className="text-xs whitespace-pre-wrap max-w-xs overflow-hidden">{r.payload ? JSON.stringify(r.payload) : ''}</pre></td>
                        <td className="px-3 py-2 text-ink-700">{r.ip ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </div>
    </div>
  );
}

// ─── BackupsDialog ────────────────────────────────────────────────────────────

function BackupsDialog({ t, onClose, onCleanupRun }: { t: Tenant; onClose: () => void; onCleanupRun: () => void }) {
  const backupsQ = useQuery({
    queryKey: ['platform', 'backups'],
    queryFn: () => platformApi.listBackups(),
  });
  const rows = (backupsQ.data ?? []).filter((b) => b.tenantSlug === t.slug);

  const cleanupMut = useMutation({
    mutationFn: () => platformApi.runCleanup(),
    onSuccess: (r) => {
      const res = r as { candidatesFound?: number; deleted?: number; backedUp?: number; errors?: unknown[] };
      toast.success(`Job: candidati=${res.candidatesFound ?? 0}, eliminati=${res.deleted ?? 0}, backup=${res.backedUp ?? 0}, errori=${res.errors?.length ?? 0}`);
      onCleanupRun();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Backup — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-100">
          <p className="text-sm text-ink-700">
            Dump pre-cancellazione (JSON gzipped). Retention: <code>BACKUP_RETENTION_DAYS</code> (default 90gg).
          </p>
          {t.stato === 'archiviato' && (
            <button
              className="c-btn c-btn--ghost c-btn--sm ml-3"
              onClick={() => {
                if (window.confirm('Eseguire ora il job di cleanup? Verranno hard-deletati i tenant archiviati con cleanup_scheduled_at scaduto.'))
                  cleanupMut.mutate();
              }}
              disabled={cleanupMut.isPending}
            >
              <RefreshCw className="w-3.5 h-3.5" /><span>Esegui cleanup ora</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto max-h-[60vh] px-1">
          {rows.length === 0
            ? <p className="text-sm text-ink-700 italic p-4">Nessun backup per questo tenant.</p>
            : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-ink-700">File</th>
                    <th className="px-3 py-2 font-semibold text-ink-700">Size</th>
                    <th className="px-3 py-2 font-semibold text-ink-700">Modificato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((b, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2"><code className="text-xs">{b.filename}</code></td>
                      <td className="px-3 py-2 text-ink-700">{fmtBytes(b.sizeBytes)}</td>
                      <td className="px-3 py-2 text-ink-700">{fmtDate(b.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}
