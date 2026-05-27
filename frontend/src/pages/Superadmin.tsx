/**
 * Superadmin.tsx — Multi-tenant console per il ruolo superadmin.
 *
 * Layout/classi IDENTICI a js/views/superadmin.js (design system legacy.css).
 * Tutta la data-wiring (queries, mutations, polling) è preservata.
 * Renders inside AppLayout.
 */

import React, { useCallback, useState } from 'react';
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
} from 'lucide-react';
import { httpErrorMessage } from '@/lib/api';
import {
  platformApi,
  type Tenant,
  type TenantStats,
  type TenantSmtp,
  type SystemSnapshot,
  type Piano,
  TENANT_PLANS,
} from '@/api/platform';
import { PIANI } from '@/lib/piani';
import { usePiani, PIANI_QUERY_KEY } from '@/hooks/usePiani';
import { PianoFormDialog } from '@/components/superadmin/dialogs/PianoFormDialog';
import {
  fmtBytes,
  fmtDate,
  fmtUptime,
  formatMb,
  cleanupCountdown,
} from '@/components/superadmin/format';
import {
  StatoBadge,
  PianoBadge,
  UsageBar,
  MiniBar,
  StatTile,
  KpiCard,
  ResourceCard24h,
} from '@/components/superadmin/ui';
import { AuditDialog } from '@/components/superadmin/dialogs/AuditDialog';
import { BackupsDialog } from '@/components/superadmin/dialogs/BackupsDialog';
import { SmtpDialog } from '@/components/superadmin/dialogs/SmtpDialog';
import { EditMetaDialog } from '@/components/superadmin/dialogs/EditMetaDialog';
import { ChangePlanDialog } from '@/components/superadmin/dialogs/ChangePlanDialog';
import { NewEnteDialog } from '@/components/superadmin/dialogs/NewEnteDialog';
import { DetailDrawer } from '@/components/superadmin/dialogs/DetailDrawer';

// ─── Local plan metadata (mirrors js/piani.js badge_color / limits) ──────────

// Catalogo piani: single source of truth in lib/piani.ts (port di js/piani.js).
// Prima era hardcoded qui con valori divergenti (prezzi/limiti errati).

// ─── Main page component ──────────────────────────────────────────────────────

export default function Superadmin() {
  const { t: _t } = useTranslation();
  const qc = useQueryClient();

  // Catalogo piani dinamico (API) con fallback statico su PIANI. La mappa è
  // sempre popolata: usata da PianoBadge, UsageBar, KPI revenue, filtro piani.
  const { piani: pianiList, pianiMap } = usePiani();
  // Opzioni filtro/select: piani dinamici (ordinati dal backend) se disponibili,
  // altrimenti le key storiche statiche.
  const pianoOptions: { key: string; nome: string }[] = pianiList.length
    ? pianiList.map((p) => ({ key: p.key, nome: p.nome }))
    : TENANT_PLANS.map((k) => ({ key: k, nome: PIANI[k].nome }));

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
    const p = pianiMap[ten.piano] ?? PIANI.trial;
    if (ten.stato === 'attivo' && !p.is_ppe && p.prezzo) revenue += p.prezzo;
  }

  const cpuPct = sys?.cpu.processPct;
  const cores = sys?.cpu.cores ?? 0;
  let sysVal = 'n/d';
  if (sys) {
    const mb = sys.memory.rss / (1024 * 1024);
    sysVal = `${mb < 1024 ? mb.toFixed(0) + ' MB' : (mb / 1024).toFixed(2) + ' GB'} · CPU ${typeof cpuPct === 'number' ? cpuPct.toFixed(1) : '—'}%`;
  }
  const loadAvg1 = sys?.cpu.loadAvg1;
  const loadAvgSysPct = cores > 0 && Number.isFinite(loadAvg1)
    ? Math.round(((loadAvg1 ?? 0) / cores) * 100)
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
  const liveCpuPct = sys?.cpu.processPct ?? cpuSeries.at(-1) ?? null;
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
    const piano = pianiMap[ten.piano] ?? PIANI.trial;

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
            <PianoBadge piano={ten.piano} info={piano} />
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
            <strong>{stats ? fmtBytes(stats.diskUsageBytes) : '·'}</strong>
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
    const piano = pianiMap[ten.piano] ?? PIANI.trial;
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
        <td className="px-3 py-2.5"><PianoBadge piano={ten.piano} info={piano} /></td>
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
        <td className="px-3 py-2.5 text-right text-ink-700">{stats ? fmtBytes(stats.diskUsageBytes) : '·'}</td>
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
            {pianoOptions.map((p) => <option key={p.key} value={p.key}>{p.nome}</option>)}
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
      <div className="space-y-8">
        <section className="max-w-2xl">
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
        </section>

        <PianiPanel />
      </div>
    );
  }

  // ── Catalogo piani (CRUD) ──────────────────────────────────────────────────
  function PianiPanel() {
    const { piani, isLoading, isError } = usePiani();
    const [formPiano, setFormPiano] = useState<Piano | null | undefined>(undefined); // undefined = chiuso, null = nuovo

    const invalidatePiani = () => {
      void qc.invalidateQueries({ queryKey: PIANI_QUERY_KEY });
    };

    const deleteMut = useMutation({
      mutationFn: (key: string) => platformApi.deletePiano(key),
      onSuccess: () => { toast.success('Piano eliminato'); invalidatePiani(); },
      onError: (err) => toast.error(httpErrorMessage(err)),
    });

    function doDelete(p: Piano) {
      if (!window.confirm(`Eliminare il piano "${p.nome}" (${p.key})?`)) return;
      deleteMut.mutate(p.key);
    }

    const fmtLimit = (v: number | null): number | string => v ?? '∞';
    const fmtPrezzo = (p: Piano) => {
      if (p.isPpe) return `€${p.ppeSetupPerConcorso ?? 0}/conc + €${(p.ppePerIscritto ?? 0).toFixed(2)}/iscr`;
      if (p.prezzo === 0) return 'Gratis';
      return `€${p.prezzo}/anno`;
    };

    const badgeCls: Record<string, string> = {
      sky:     'bg-sky-50 text-sky-700 ring-sky-200',
      emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      brand:   'bg-brand-50 text-brand-700 ring-brand-200',
      amber:   'bg-amber-50 text-amber-700 ring-amber-200',
      slate:   'bg-slate-100 text-slate-700 ring-slate-200',
    };

    return (
      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-ink-900">Piani d'acquisto</h2>
          <button className="c-btn c-btn--primary c-btn--sm" onClick={() => setFormPiano(null)}>
            <Plus className="w-3.5 h-3.5" /><span>Nuovo piano</span>
          </button>
        </div>
        <p className="text-sm text-ink-700 mb-4">Catalogo dei piani offerti ai tenant. Modificabili a runtime.</p>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="px-4 py-10 text-center text-sm text-ink-700">Caricamento…</div>
          ) : isError ? (
            <div className="px-4 py-10 text-center text-sm text-rose-700">Errore nel caricamento dei piani.</div>
          ) : piani.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-ink-700">Nessun piano configurato.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[11px] uppercase tracking-wide text-ink-700">
                    <th className="px-3 py-2.5 text-left font-semibold">Piano</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Prezzo</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Durata</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Concorsi</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Commissari</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Candidati</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Iscritti/anno</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Attivo</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Badge</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {piani.map((p) => (
                    <tr key={p.key} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink-900 flex items-center gap-1.5">
                          {p.nome}
                          {p.featured && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-brand-700 bg-brand-100 rounded px-1.5 py-0.5">consigliato</span>
                          )}
                        </div>
                        <code className="text-xs text-ink-500">{p.key}</code>
                      </td>
                      <td className="px-3 py-2.5 text-ink-900">{fmtPrezzo(p)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-700">{p.durataGiorni == null ? '—' : `${p.durataGiorni}g`}</td>
                      <td className="px-3 py-2.5 text-right text-ink-700">{fmtLimit(p.limitConcorsi)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-700">{fmtLimit(p.limitCommissari)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-700">{fmtLimit(p.limitCandidatiPerConcorso)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-700">{fmtLimit(p.limitIscrittiAnnui)}</td>
                      <td className="px-3 py-2.5 text-center">
                        {p.attivo
                          ? <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />sì</span>
                          : <span className="text-ink-500 text-xs">no</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ring-1 ${badgeCls[p.badgeColor] ?? badgeCls.slate}`}>
                          {p.badgeColor}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700"
                          title="Modifica"
                          onClick={() => setFormPiano(p)}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-rose-50 text-rose-700"
                          title="Elimina"
                          onClick={() => doDelete(p)}
                          disabled={deleteMut.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {formPiano !== undefined && (
          <PianoFormDialog
            piano={formPiano}
            onClose={() => setFormPiano(undefined)}
            onSaved={() => { setFormPiano(undefined); invalidatePiani(); }}
          />
        )}
      </section>
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

