/**
 * Superadmin.tsx — Multi-tenant console per il ruolo superadmin.
 *
 * Port di js/views/superadmin.js. Renderizza dentro AppLayout.
 * Features: KPI strip, sparkline RSS/CPU, lista enti (grid/table con
 * [data-ente-id]), dialogs create/edit/lifecycle, config piattaforma.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Download,
  Edit,
  Eye,
  Folder,
  Grid,
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
import { cn } from '@/lib/utils';
import { http, httpErrorMessage } from '@/lib/api';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PIANI: Record<TenantPiano, { nome: string; prezzo?: number; color: string }> = {
  trial:   { nome: 'Trial',   prezzo: 0,    color: 'bg-slate-100 text-slate-700' },
  starter: { nome: 'Starter', prezzo: 490,  color: 'bg-sky-100 text-sky-700' },
  pro:     { nome: 'Pro',     prezzo: 990,  color: 'bg-brand-100 text-brand-700' },
  ultra:   { nome: 'Ultra',   prezzo: 1990, color: 'bg-amber-100 text-amber-700' },
  ppe:     { nome: 'PPE',     prezzo: 0,    color: 'bg-emerald-100 text-emerald-700' },
};

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatoBadge({ stato }: { stato: TenantStato }) {
  const cls =
    stato === 'attivo'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : stato === 'sospeso'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-rose-50 text-rose-700 ring-rose-200';
  const dot =
    stato === 'attivo'
      ? 'bg-emerald-500'
      : stato === 'sospeso'
        ? 'bg-amber-500'
        : 'bg-rose-500';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {stato}
    </span>
  );
}

function PianoBadge({ piano }: { piano: TenantPiano }) {
  const p = PIANI[piano] ?? PIANI.trial;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ring-1 ring-current/20 ${p.color}`}>
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
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          <strong className={over ? 'text-rose-700' : ''}>{used}</strong>
          {limit != null && <span className="text-muted-foreground font-normal"> / {limit}</span>}
          {limit == null && <span className="text-muted-foreground font-normal"> illimitato</span>}
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barCls} transition-all`} style={{ width: `${pct ?? 0}%` }} />
      </div>
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
  const accentCls = {
    brand:   { bg: 'bg-primary/10',    text: 'text-primary',        border: 'border-primary/20' },
    amber:   { bg: 'bg-amber-50',      text: 'text-amber-700',      border: 'border-amber-100' },
    sky:     { bg: 'bg-sky-50',        text: 'text-sky-700',        border: 'border-sky-100' },
    slate:   { bg: 'bg-muted',         text: 'text-muted-foreground', border: 'border-border' },
    emerald: { bg: 'bg-emerald-50',    text: 'text-emerald-700',    border: 'border-emerald-100' },
  }[accent];
  return (
    <div className={`bg-card border ${accentCls.border} rounded-xl p-3.5`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
        <div className={`w-7 h-7 rounded-lg ${accentCls.bg} ${accentCls.text} inline-flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="text-xl font-bold leading-tight">{value}</div>
      <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{sub}</p>
    </div>
  );
}

// Simple inline sparkline SVG (no extra lib)
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 300, h = 60, pad = 4;
  if (values.length < 2) return <div className="h-16 flex items-center justify-center text-xs text-muted-foreground">in attesa…</div>;
  const min = 0, max = Math.max(...values, 1);
  const range = max - min || 1;
  const iW = w - pad * 2, iH = h - pad * 2;
  const step = iW / Math.max(1, 59);
  const offsetX = pad + iW - (values.length - 1) * step;
  const pts = values.map((v, i) => ({
    x: offsetX + i * step,
    y: pad + iH - ((v - min) / range) * iH,
  }));
  const line = 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  const last = pts[pts.length - 1];
  const area = `${line} L ${last.x.toFixed(1)} ${(h - pad).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(h - pad).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16 block">
      <path d={area} fill={color} fillOpacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={3} fill={color} />
    </svg>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function Superadmin() {
  const { t } = useTranslation();
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

  // Sparkline history
  const histRef = useRef<{ rss: number[]; cpu: number[] }>({ rss: [], cpu: [] });

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
        (tenantsQ.data ?? []).map(async (t) => {
          try {
            const s = await platformApi.getTenantStats(t.id);
            results.set(t.id, s);
          } catch { /* ignore */ }
        }),
      );
      return results;
    },
    enabled: (tenantsQ.data?.length ?? 0) > 0,
    staleTime: 60_000,
  });
  const statsMap: Map<string, TenantStats> = statsQ.data ?? new Map();

  const smtpQ = useQuery({
    queryKey: ['platform', 'smtp'],
    queryFn: async () => {
      const results = new Map<string, TenantSmtp>();
      await Promise.allSettled(
        (tenantsQ.data ?? []).map(async (t) => {
          try {
            const s = await platformApi.getTenantSmtp(t.id);
            results.set(t.id, s);
          } catch { /* ignore */ }
        }),
      );
      return results;
    },
    enabled: (tenantsQ.data?.length ?? 0) > 0,
    staleTime: 60_000,
  });
  const smtpMap: Map<string, TenantSmtp> = smtpQ.data ?? new Map();

  // System + runtime (polling 5s quando dashboard attiva)
  const systemQ = useQuery({
    queryKey: ['platform', 'system'],
    queryFn: () => platformApi.getSystem(),
    refetchInterval: activeTab === 'dashboard' ? 5000 : false,
    staleTime: 4000,
  });
  const sys: SystemSnapshot | undefined = systemQ.data;

  const runtimeQ = useQuery({
    queryKey: ['platform', 'runtime'],
    queryFn: () => platformApi.getRuntime(),
    refetchInterval: activeTab === 'dashboard' ? 5000 : false,
    staleTime: 4000,
  });
  const runtimeMap: Record<string, { reqCountMin: number; latencyP50Ms: number; latencyP95Ms: number; errorRate: number }> = runtimeQ.data?.tenants ?? {};

  const configQ = useQuery({
    queryKey: ['platform', 'config'],
    queryFn: () => platformApi.getConfig(),
    enabled: activeTab === 'config',
    staleTime: 60_000,
  });

  // Push sparkline history
  useEffect(() => {
    if (!sys) return;
    const h = histRef.current;
    h.rss.push(sys.memory.rss / (1024 * 1024));
    h.cpu.push(sys.cpu.processPct ?? 0);
    if (h.rss.length > 60) h.rss.shift();
    if (h.cpu.length > 60) h.cpu.shift();
  }, [sys]);

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
    .filter((t) => {
      if (filter.stato !== 'all' && t.stato !== filter.stato) return false;
      if (filter.piano !== 'all' && t.piano !== filter.piano) return false;
      if (q && !`${t.nome} ${t.slug}`.toLowerCase().includes(q)) return false;
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
  const attivi = tenants.filter((t) => t.stato === 'attivo').length;
  const sospesi = tenants.filter((t) => t.stato === 'sospeso').length;
  const archiviati = tenants.filter((t) => t.stato === 'archiviato').length;
  let totConcorsi = 0, totDisk = 0;
  for (const t of tenants) {
    const s = statsMap.get(t.id);
    if (s) { totConcorsi += s.concorsi; totDisk += s.diskUsageBytes; }
  }
  const rssMb = sys ? sys.memory.rss / (1024 * 1024) : null;
  const cpuPct = sys?.cpu?.processPct;
  const sysVal = sys
    ? `${rssMb! < 1024 ? rssMb!.toFixed(0) + ' MB' : (rssMb! / 1024).toFixed(2) + ' GB'} · CPU ${typeof cpuPct === 'number' ? cpuPct.toFixed(1) : '—'}%`
    : 'n/d';

  // ── Lifecycle helpers ─────────────────────────────────────────────────────
  function doLifecycle(t: Tenant, op: 'suspend' | 'reactivate' | 'restore') {
    const verbs: Record<string, string> = { suspend: 'Sospendere', reactivate: 'Riattivare', restore: 'Ripristinare' };
    if (!window.confirm(`${verbs[op]} ente "${t.nome}"?`)) return;
    lifecycleMut.mutate({ id: t.id, op });
  }

  function doArchive(t: Tenant) {
    const daysStr = window.prompt(`Giorni prima del cleanup (0 = mai):`, String(t.cleanupAfterDays));
    if (daysStr === null) return;
    archiveMut.mutate({ id: t.id, days: Number(daysStr) });
  }

  function doHardDelete(t: Tenant) {
    if (!window.confirm(`Cancellare definitivamente "${t.nome}"? Operazione IRREVERSIBILE.`)) return;
    const check = window.prompt(`Digita lo slug per confermare: ${t.slug}`);
    if (check !== t.slug) { toast.info('Slug non corretto: annullato'); return; }
    deleteMut.mutate(t.id);
  }

  // ── Sort header ───────────────────────────────────────────────────────────
  function SortTh({ col, label, align = 'left' }: { col: string; label: string; align?: string }) {
    const active = sort.col === col;
    return (
      <th
        className={`px-3 py-2.5 text-${align} text-[11px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer select-none hover:bg-muted`}
        onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />)}
        </span>
      </th>
    );
  }

  // ── Action menu (inline dropdown) ─────────────────────────────────────────
  function ActionMenu({ t }: { t: Tenant }) {
    const [open, setOpen] = useState(false);
    const isPlatform = t.slug === 'platform';
    const items: { label: string; icon: React.ElementType; action: () => void; cls?: string }[] = [
      { label: 'Dettaglio', icon: Eye,       action: () => { setDetailEnte(t); setOpen(false); } },
      { label: 'Cambia piano', icon: Star,   action: () => { setChangePlanEnte(t); setOpen(false); } },
      { label: 'Audit log', icon: List,      action: () => { setAuditEnte(t); setOpen(false); } },
      { label: 'Backup', icon: Download,     action: () => { setBackupsEnte(t); setOpen(false); } },
      { label: 'SMTP', icon: Mail,           action: () => { setSmtpEnte(t); setOpen(false); } },
      { label: 'Modifica meta', icon: Edit,  action: () => { setEditEnte(t); setOpen(false); } },
    ];
    if (!isPlatform) {
      if (t.stato === 'attivo') {
        items.push({ label: 'Sospendi', icon: Pause, cls: 'text-amber-700', action: () => { setOpen(false); doLifecycle(t, 'suspend'); } });
        items.push({ label: 'Archivia', icon: Folder, cls: 'text-rose-700', action: () => { setOpen(false); doArchive(t); } });
      } else if (t.stato === 'sospeso') {
        items.push({ label: 'Riattiva', icon: Play, cls: 'text-emerald-700', action: () => { setOpen(false); doLifecycle(t, 'reactivate'); } });
        items.push({ label: 'Archivia', icon: Folder, cls: 'text-rose-700', action: () => { setOpen(false); doArchive(t); } });
      } else if (t.stato === 'archiviato') {
        items.push({ label: 'Ripristina', icon: Undo2, cls: 'text-emerald-700', action: () => { setOpen(false); doLifecycle(t, 'restore'); } });
        items.push({ label: 'Cancella subito', icon: Trash2, cls: 'text-rose-700', action: () => { setOpen(false); doHardDelete(t); } });
      }
    }
    return (
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-label="Azioni"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-52 bg-card border border-border rounded-lg shadow-lg z-20 py-1">
              {items.map((it, i) => (
                <button
                  key={i}
                  className={`w-full px-3 py-1.5 text-sm text-left hover:bg-muted inline-flex items-center gap-2 ${it.cls ?? 'text-foreground'}`}
                  onClick={it.action}
                >
                  <it.icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {it.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Render grid/table ─────────────────────────────────────────────────────
  function EnteCard({ t }: { t: Tenant }) {
    const stats = statsMap.get(t.id);
    const smtp = smtpMap.get(t.id);
    const rt = runtimeMap[t.id];
    return (
      <article
        className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
        data-ente-id={t.id}
        onClick={() => setDetailEnte(t)}
      >
        <header className="px-4 pt-4 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold truncate leading-tight">{t.nome}</h3>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{t.slug}</p>
            </div>
            <ActionMenu t={t} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <StatoBadge stato={t.stato} />
            <PianoBadge piano={t.piano} />
            {t.pianoScadenza && <span className="text-[11px] text-muted-foreground">scade {fmtDate(t.pianoScadenza)}</span>}
          </div>
        </header>
        <div className="px-4 py-3 space-y-3">
          <UsageBar label="Concorsi" used={stats?.concorsi ?? 0} limit={null} />
          <UsageBar label="Iscrizioni" used={stats?.iscrizioni ?? 0} limit={null} />
        </div>
        <div className="px-4 py-3 border-t border-border grid grid-cols-3 gap-2">
          {(['commissari', 'candidati', 'accounts'] as const).map((k) => (
            <div key={k} className="text-center bg-muted/50 border border-border rounded-lg px-2 py-2">
              <div className="text-sm font-semibold">{stats?.[k] ?? '·'}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k}</div>
            </div>
          ))}
        </div>
        <footer className="px-4 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Folder className="w-3 h-3" />
            <strong>{stats ? fmtBytes(stats.diskUsageBytes) : '·'}</strong>
          </span>
          <span className="flex items-center gap-2">
            {smtp?.configured && <span className="inline-flex items-center gap-1 text-emerald-700"><Mail className="w-3 h-3" />SMTP</span>}
            {t.require2faAdmin && <span className="inline-flex items-center gap-1 text-indigo-700"><Lock className="w-3 h-3" />2FA</span>}
          </span>
        </footer>
        <div className="px-4 py-1.5 border-t border-border text-right">
          {rt && rt.reqCountMin > 0 ? (
            <span className={`text-[10px] font-mono ${rt.errorRate > 0 ? 'text-rose-700' : 'text-muted-foreground'}`}>
              {rt.reqCountMin} req/min · p50 {rt.latencyP50Ms}ms · p95 {rt.latencyP95Ms}ms
              {rt.errorRate > 0 && ` · ${Math.round(rt.errorRate * 100)}% err`}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground font-mono">idle</span>
          )}
        </div>
        {t.stato === 'archiviato' && (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
            Cleanup {cleanupCountdown(t)}
          </div>
        )}
      </article>
    );
  }

  // ── Dashboard tab ─────────────────────────────────────────────────────────
  const hist = histRef.current;

  function DashboardView() {
    return (
      <div className="space-y-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Enti totali" value={tot} sub={`${attivi} attivi · ${sospesi} sospesi · ${archiviati} archiviati`} accent="brand" icon={Building2} />
          <KpiCard label="Concorsi gestiti" value={totConcorsi} sub="somma su tutti i tenant" accent="amber" icon={Trophy} />
          <KpiCard label="Sistema" value={sysVal} sub={sys ? `heap ${(sys.memory.heapUsed / 1024 / 1024).toFixed(0)}/${(sys.memory.heapTotal / 1024 / 1024).toFixed(0)} MB · ${sys.cpu.cores} core · up ${fmtUptime(sys.uptimeSec)}` : 'n/d'} accent="sky" icon={Shield} />
          <KpiCard label="Storage uploads" value={fmtBytes(totDisk)} sub="allegati iscrizioni/foto" accent="slate" icon={Folder} />
          <KpiCard label="Uptime" value={sys ? fmtUptime(sys.uptimeSec) : 'n/d'} sub={sys ? `load sistema ${sys.cpu.loadAvg1.toFixed(2)} · ${sys.cpu.cores} core` : 'n/d'} accent="emerald" icon={Star} />
        </div>

        {/* Sparklines */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Memoria processo (RSS)</p>
              <span className="text-xl font-bold">{hist.rss.length ? `${hist.rss[hist.rss.length - 1].toFixed(0)} MB` : 'n/d'}</span>
            </div>
            <Sparkline values={hist.rss} color="#0ea5e9" />
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">CPU processo Node</p>
              <span className="text-xl font-bold">{hist.cpu.length ? `${hist.cpu[hist.cpu.length - 1].toFixed(1)}%` : 'n/d'}</span>
            </div>
            <Sparkline values={hist.cpu} color="#10b981" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Cerca per nome o slug…"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <select
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={filter.stato}
            onChange={(e) => setFilter((f) => ({ ...f, stato: e.target.value }))}
          >
            <option value="all">Tutti gli stati</option>
            <option value="attivo">Attivi</option>
            <option value="sospeso">Sospesi</option>
            <option value="archiviato">Archiviati</option>
          </select>
          <select
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={filter.piano}
            onChange={(e) => setFilter((f) => ({ ...f, piano: e.target.value }))}
          >
            <option value="all">Tutti i piani</option>
            {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}</option>)}
          </select>
          <div className="inline-flex border border-border rounded-md p-0.5 bg-muted">
            {(['grid', 'table'] as const).map((l) => (
              <button
                key={l}
                className={cn('px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors', layout === l ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground')}
                onClick={() => setLayout(l)}
              >
                {l === 'grid' ? <Grid className="w-3 h-3" /> : <List className="w-3 h-3" />}
                {l === 'grid' ? 'Grid' : 'Table'}
              </button>
            ))}
          </div>
          <button className="p-2 rounded-md hover:bg-muted text-muted-foreground" onClick={() => tenantsQ.refetch()} title="Ricarica">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Button size="sm" onClick={() => setNewEnteOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Nuovo ente
          </Button>
        </div>

        {/* List */}
        {tenantsQ.isLoading ? (
          <div className="text-center py-10 text-muted-foreground text-sm">Caricamento…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-card border-2 border-dashed border-border rounded-xl py-16 text-center">
            <p className="text-sm font-medium">Nessun ente corrisponde ai filtri.</p>
          </div>
        ) : layout === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => <EnteCard key={t.id} t={t} />)}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <SortTh col="nome" label="Ente" />
                    <SortTh col="stato" label="Stato" />
                    <SortTh col="piano" label="Piano" />
                    <SortTh col="concorsi" label="Concorsi" align="right" />
                    <SortTh col="iscrizioni" label="Iscrizioni" align="right" />
                    <SortTh col="storage" label="Storage" align="right" />
                    <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Attività</th>
                    <SortTh col="createdAt" label="Creato" align="right" />
                    <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((t) => {
                    const stats = statsMap.get(t.id);
                    const rt = runtimeMap[t.id];
                    return (
                      <tr
                        key={t.id}
                        className="hover:bg-muted/30 cursor-pointer"
                        data-ente-id={t.id}
                        onClick={() => setDetailEnte(t)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium truncate">{t.nome}</div>
                          <code className="text-xs text-muted-foreground">{t.slug}</code>
                        </td>
                        <td className="px-3 py-2.5"><StatoBadge stato={t.stato} /></td>
                        <td className="px-3 py-2.5"><PianoBadge piano={t.piano} /></td>
                        <td className="px-3 py-2.5 text-right font-medium">{stats?.concorsi ?? '·'}</td>
                        <td className="px-3 py-2.5 text-right">{stats?.iscrizioni ?? '·'}</td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">{stats ? fmtBytes(stats.diskUsageBytes) : '·'}</td>
                        <td className="px-3 py-2.5 text-right">
                          {rt && rt.reqCountMin > 0
                            ? <span className={`text-[10px] font-mono ${rt.errorRate > 0 ? 'text-rose-700' : 'text-muted-foreground'}`}>{rt.reqCountMin} req · p50 {rt.latencyP50Ms}ms</span>
                            : <span className="text-[10px] text-muted-foreground font-mono">idle</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground text-xs">{fmtDate(t.createdAt)}</td>
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <ActionMenu t={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Config tab ────────────────────────────────────────────────────────────
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
        <h2 className="text-lg font-semibold mb-1">Configurazione piattaforma</h2>
        <p className="text-sm text-muted-foreground mb-5">Impostazioni globali applicate a tutti i tenant.</p>
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div>
            <Label>Default cleanup days</Label>
            <Input
              type="number"
              className="mt-1"
              min={0}
              max={3650}
              value={effCleanup}
              onChange={(e) => setCleanup(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground mt-1.5">Giorni tra archiviazione e hard-delete (0 = mai). Override per-tenant da "Modifica ente".</p>
          </div>
          <div className="pt-3 border-t border-border">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={eff2fa}
                onChange={(e) => setRequire2fa(e.target.checked)}
                className="rounded"
              />
              Richiedi 2FA TOTP a tutti i super-admin
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">Al prossimo login gli account super-admin saranno forzati al setup TOTP.</p>
          </div>
          <div className="pt-3 border-t border-border">
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Salvataggio…' : 'Salva configurazione'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium leading-none">Gestimus · Super-admin</p>
            <h1 className="text-base font-semibold leading-tight">Piattaforma</h1>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          {(['dashboard', 'config'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                activeTab === tab ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {tab === 'dashboard' ? <Grid className="w-3.5 h-3.5" /> : <Settings className="w-3.5 h-3.5" />}
              {tab === 'dashboard' ? 'Dashboard' : 'Configurazione'}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'dashboard' ? <DashboardView /> : <ConfigView />}

      {/* ── Dialogs ── */}

      {/* Detail drawer */}
      {detailEnte && (
        <DetailDrawer t={detailEnte} statsMap={statsMap} smtpMap={smtpMap} onClose={() => setDetailEnte(null)}
          onEdit={(t) => { setDetailEnte(null); setEditEnte(t); }}
          onSmtp={(t) => { setDetailEnte(null); setSmtpEnte(t); }}
          onAudit={(t) => { setDetailEnte(null); setAuditEnte(t); }}
          onBackups={(t) => { setDetailEnte(null); setBackupsEnte(t); }}
        />
      )}

      {/* New ente */}
      {newEnteOpen && (
        <NewEnteDialog
          existingSlugs={tenants.map((t) => t.slug)}
          onClose={() => setNewEnteOpen(false)}
          onCreated={() => { setNewEnteOpen(false); invalidateAll(); }}
        />
      )}

      {/* Edit meta */}
      {editEnte && (
        <EditMetaDialog
          t={editEnte}
          onClose={() => setEditEnte(null)}
          onSaved={() => { setEditEnte(null); invalidateAll(); }}
        />
      )}

      {/* Change plan */}
      {changePlanEnte && (
        <ChangePlanDialog
          t={changePlanEnte}
          onClose={() => setChangePlanEnte(null)}
          onSaved={() => { setChangePlanEnte(null); invalidateAll(); }}
        />
      )}

      {/* SMTP */}
      {smtpEnte && (
        <SmtpDialog
          t={smtpEnte}
          smtp={smtpMap.get(smtpEnte.id)}
          onClose={() => setSmtpEnte(null)}
          onSaved={() => { setSmtpEnte(null); invalidateAll(); }}
        />
      )}

      {/* Audit */}
      {auditEnte && (
        <AuditDialog t={auditEnte} onClose={() => setAuditEnte(null)} />
      )}

      {/* Backups */}
      {backupsEnte && (
        <BackupsDialog
          t={backupsEnte}
          onClose={() => setBackupsEnte(null)}
          onCleanupRun={() => { setBackupsEnte(null); invalidateAll(); }}
        />
      )}
    </section>
  );
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

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
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full sm:max-w-md bg-card shadow-xl flex flex-col h-full overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Dettaglio ente</p>
            <h2 className="text-lg font-semibold truncate">{t.nome}</h2>
            <code className="text-xs text-muted-foreground">{t.slug}</code>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StatoBadge stato={t.stato} />
              <PianoBadge piano={t.piano} />
            </div>
          </div>
          <button className="p-1.5 rounded-md hover:bg-muted" onClick={onClose}><X className="w-4 h-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">Risorse</h3>
            <div className="space-y-3">
              <UsageBar label="Concorsi" used={stats?.concorsi ?? 0} limit={null} />
              <UsageBar label="Iscrizioni" used={stats?.iscrizioni ?? 0} limit={null} />
            </div>
            <div className="flex items-center justify-between text-xs mt-3 pt-3 border-t border-border">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Folder className="w-3 h-3" />Storage</span>
              <strong>{stats ? fmtBytes(stats.diskUsageBytes) : '·'}</strong>
            </div>
          </section>
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">Configurazione</h3>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between"><dt className="text-muted-foreground">Dominio custom</dt><dd>{t.dominio ?? <em className="text-muted-foreground">—</em>}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Cleanup days</dt><dd>{t.cleanupAfterDays === 0 ? <em>mai</em> : t.cleanupAfterDays}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">2FA admin</dt><dd>{t.require2faAdmin ? 'richiesto' : 'opzionale'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">SMTP</dt><dd>{smtp?.configured ? `configurato${smtp.encrypted ? ' (cifrato)' : ''}` : <em className="text-muted-foreground">non configurato</em>}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Creato il</dt><dd>{fmtDate(t.createdAt)}</dd></div>
              {t.stato === 'archiviato' && <div className="flex justify-between"><dt className="text-muted-foreground">Cleanup</dt><dd className="text-amber-700">{cleanupCountdown(t)}</dd></div>}
            </dl>
          </section>
          {t.note && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">Note</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.note}</p>
            </section>
          )}
        </div>
        <footer className="border-t border-border px-5 py-3 bg-muted/30 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => onAudit(t)}><List className="w-3.5 h-3.5 mr-1" />Audit</Button>
          <Button variant="ghost" size="sm" onClick={() => onBackups(t)}><Download className="w-3.5 h-3.5 mr-1" />Backup</Button>
          <Button variant="ghost" size="sm" onClick={() => onSmtp(t)}><Mail className="w-3.5 h-3.5 mr-1" />SMTP</Button>
          <Button size="sm" className="ml-auto" onClick={() => onEdit(t)}><Edit className="w-3.5 h-3.5 mr-1" />Modifica</Button>
        </footer>
      </aside>
    </div>
  );
}

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
    onSuccess: () => { toast.success(`Ente "${slug}" creato.`); onCreated(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Nuovo ente</DialogTitle></DialogHeader>
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Nome ente *</Label>
              <Input className="mt-1" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Conservatorio Verdi" />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input
                className="mt-1 font-mono text-sm"
                value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
                placeholder="conservatorio-verdi"
              />
              {slugErr && <p className="text-xs text-destructive mt-1">{slugErr}</p>}
              {!slugErr && slug && <p className="text-xs text-primary mt-1 font-mono">{slug}.gestimus.local:4000</p>}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Piano</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {TENANT_PLANS.map((k) => (
                <label key={k} className={cn('cursor-pointer border-2 rounded-lg p-3 transition-colors', piano === k ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground')}>
                  <input type="radio" name="piano" value={k} checked={piano === k} onChange={() => setPiano(k)} className="sr-only" />
                  <div className="font-semibold text-sm">{PIANI[k].nome}</div>
                  {PIANI[k].prezzo != null && <div className="text-xs text-muted-foreground mt-0.5">{PIANI[k].prezzo === 0 ? 'Gratuito' : `€${PIANI[k].prezzo}/anno`}</div>}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Scadenza piano</Label>
              <Input type="date" className="mt-1" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} />
            </div>
            <div>
              <Label>Cleanup days (0 = mai)</Label>
              <Input type="number" className="mt-1" min={0} max={3650} value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Email admin *</Label>
              <Input type="email" className="mt-1" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@ente.it" />
            </div>
            <div>
              <Label>Password *</Label>
              <div className="flex gap-1.5 mt-1">
                <div className="relative flex-1">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    className="pr-9 font-mono text-sm"
                    value={adminPass}
                    onChange={(e) => setAdminPass(e.target.value)}
                  />
                  <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" onClick={() => setShowPass((v) => !v)}>
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => { setAdminPass(genPassword()); setShowPass(true); }} title="Rigenera">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => { void navigator.clipboard.writeText(adminPass); toast.success('Copiato'); }} title="Copia">
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="mt-1.5">
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full transition-all ${scoreCls}`} style={{ width: `${score * 25}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{adminPass ? `Robustezza: ${scoreLabel}` : ''}</p>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !!slugErr || !slug || !nome || !adminEmail || adminPass.length < 8}>
            {createMut.isPending ? 'Creazione…' : 'Crea ente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Modifica {t.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div><Label>Nome ente</Label><Input className="mt-1" value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Piano</Label>
              <select className="w-full mt-1 border border-border rounded-md px-2 py-1.5 bg-background text-sm" value={piano} onChange={(e) => setPiano(e.target.value as TenantPiano)}>
                {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}</option>)}
              </select>
            </div>
            <div><Label>Scadenza piano</Label><Input type="date" className="mt-1" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} /></div>
          </div>
          <div><Label>Dominio custom</Label><Input className="mt-1" value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="es. ente1.gestimus.it" /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label>Cleanup days (0 = mai)</Label><Input type="number" className="mt-1" min={0} max={3650} value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))} /></div>
            <div className="flex items-end pb-1"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={require2fa} onChange={(e) => setRequire2fa(e.target.checked)} className="rounded" />2FA admin richiesto</label></div>
          </div>
          <div><Label>Note</Label><textarea className="w-full mt-1 border border-border rounded-md px-3 py-2 bg-background text-sm resize-none" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? 'Salvataggio…' : 'Salva'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePlanDialog({ t, onClose, onSaved }: { t: Tenant; onClose: () => void; onSaved: () => void }) {
  const [piano, setPiano] = useState<TenantPiano>(t.piano);
  const [pianoScadenza, setPianoScadenza] = useState(t.pianoScadenza ?? '');
  const [maxConcorsi, setMaxConcorsi] = useState('');
  const [maxCommissari, setMaxCommissari] = useState('');
  const [maxCandidati, setMaxCandidati] = useState('');

  const configQ = useQuery({ queryKey: ['platform', 'config', t.id], queryFn: () => platformApi.getTenantConfig(t.id) });
  useEffect(() => {
    const cfg = configQ.data;
    if (cfg) {
      setMaxConcorsi(cfg.maxConcorsi != null ? String(cfg.maxConcorsi) : '');
      setMaxCommissari(cfg.maxCommissari != null ? String(cfg.maxCommissari) : '');
      setMaxCandidati(cfg.maxCandidatiPerConcorso != null ? String(cfg.maxCandidatiPerConcorso) : '');
    }
  }, [configQ.data]);

  const parseOpt = (v: string): number | null => v.trim() === '' ? null : Number(v);

  const mut = useMutation({
    mutationFn: () => {
      const body: ChangePlanBody = {
        piano, pianoScadenza: pianoScadenza || null,
        overrides: { maxConcorsi: parseOpt(maxConcorsi), maxCommissari: parseOpt(maxCommissari), maxCandidatiPerConcorso: parseOpt(maxCandidati) },
      };
      return platformApi.changePlan(t.id, body);
    },
    onSuccess: () => { toast.success(`Piano aggiornato: ${piano}`); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Cambia piano — {t.nome}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Piano</Label>
              <select className="w-full mt-1 border border-border rounded-md px-2 py-1.5 bg-background text-sm" value={piano} onChange={(e) => setPiano(e.target.value as TenantPiano)}>
                {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}{k === t.piano ? ' (attuale)' : ''}</option>)}
              </select>
            </div>
            <div>
              <Label>Scadenza piano</Label>
              <Input type="date" className="mt-1" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Override limiti (vuoto = usa piano)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label>maxConcorsi</Label><Input type="number" min={0} className="mt-1" placeholder="usa piano" value={maxConcorsi} onChange={(e) => setMaxConcorsi(e.target.value)} /></div>
              <div><Label>maxCommissari</Label><Input type="number" min={0} className="mt-1" placeholder="usa piano" value={maxCommissari} onChange={(e) => setMaxCommissari(e.target.value)} /></div>
              <div><Label>maxCandidati</Label><Input type="number" min={0} className="mt-1" placeholder="usa piano" value={maxCandidati} onChange={(e) => setMaxCandidati(e.target.value)} /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? 'Salvataggio…' : 'Conferma cambio piano'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>SMTP — {t.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Stato: <strong>{smtp?.configured ? `configurato${smtp.encrypted ? ' (cifrato)' : ''}` : 'non configurato'}</strong>. La password è cifrata AES-GCM at-rest.</p>
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label>Host</Label><Input className="mt-1" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" /></div>
            <div><Label>Port</Label><Input type="number" className="mt-1" value={port} onChange={(e) => setPort(Number(e.target.value))} /></div>
          </div>
          <div><Label>User</Label><Input className="mt-1" value={user} onChange={(e) => setUser(e.target.value)} /></div>
          <div><Label>Password</Label><Input type="password" className="mt-1" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          <div><Label>From</Label><Input className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} placeholder='"Gestimus" <noreply@ente.it>' /></div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="rounded" />
            SSL/TLS implicita (porta 465)
          </label>
          {smtp?.configured && (
            <div className="pt-2 border-t border-border">
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (window.confirm(`Rimuovere SMTP di ${t.nome}?`)) delMut.mutate(); }}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />Rimuovi configurazione
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !host || !user || !pass || !from}>
            {saveMut.isPending ? 'Salvataggio…' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditDialog({ t, onClose }: { t: Tenant; onClose: () => void }) {
  const auditQ = useQuery({
    queryKey: ['platform', 'audit', t.id],
    queryFn: () => platformApi.getAudit({ tenantId: t.id, limit: 100 }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Audit log — {t.nome}</DialogTitle></DialogHeader>
        <div className="overflow-x-auto max-h-[60vh]">
          {auditQ.isLoading ? <p className="text-sm text-muted-foreground">Caricamento…</p>
            : (auditQ.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground italic">Nessuna riga di audit.</p>
              : (
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/50 text-left sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Quando</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditQ.data!.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.createdAt)}</td>
                        <td className="px-3 py-2 font-mono">{r.action}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.ip ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackupsDialog({ t, onClose, onCleanupRun }: { t: Tenant; onClose: () => void; onCleanupRun: () => void }) {
  const backupsQ = useQuery({ queryKey: ['platform', 'backups'], queryFn: () => platformApi.listBackups() });
  const rows = (backupsQ.data ?? []).filter((b) => b.tenantSlug === t.slug);

  const cleanupMut = useMutation({
    mutationFn: () => platformApi.runCleanup(),
    onSuccess: () => { toast.success('Job cleanup eseguito'); onCleanupRun(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Backup — {t.nome}</DialogTitle></DialogHeader>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Dump pre-cancellazione (JSON gzipped). Retention: default 90gg.</p>
          {t.stato === 'archiviato' && (
            <Button variant="outline" size="sm" onClick={() => { if (window.confirm('Eseguire cleanup ora?')) cleanupMut.mutate(); }} disabled={cleanupMut.isPending}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" />Esegui cleanup
            </Button>
          )}
        </div>
        <div className="overflow-x-auto max-h-[60vh]">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground italic">Nessun backup per questo tenant.</p>
            : (
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 text-left sticky top-0">
                  <tr>
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Modificato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((b, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-xs">{b.filename}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtBytes(b.sizeBytes)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(b.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Needed for SortTh inside DashboardView — hoisted to module scope
// (DashboardView references it inline, that's fine because it's a closure within render)
