/**
 * AdminDashboard — panoramica del concorso attivo.
 *
 * Props:
 *   embedded?: boolean — quando true (resa dentro AdminWorkspace) non mostra
 *   il ConcorsoSelector né l'empty-state; usa direttamente il concorso attivo.
 *   Default false (pagina standalone con selector in testa).
 *
 * Struttura (replica FEDELE del layout vanilla dashboard.js):
 *   1. ConcorsoSelector in testa; empty-state se nessun concorso selezionato.
 *   2. KPI strip: 3 stat cards (candidati / commissari / fasi concluse).
 *   3. Banner warning se nessuna commissione ha un presidente assegnato.
 *   4. Griglia "Sezioni del concorso": 10 cards cliccabili (SIDEBAR_TABS) → Link /admin.
 *   5. Statistiche distribuzione (strumenti top-8, nazionalità) + tabella fasi
 *      con colonne: Fase / Candidati / Valutazioni / Ammessi / % ammessi.
 *
 * Fonti dati:
 *   GET /api/fasi?concorsoId=              → Fase[]
 *   GET /api/candidati?concorsoId=         → Candidato[]
 *   GET /api/commissari?concorsoId=        → Commissario[]
 *   GET /api/sezioni?concorsoId=           → Sezione[]
 *   GET /api/commissioni?concorsoId=       → Commissione[]
 *   GET /api/calendario/eventi?concorsoId= → Evento[]
 *   GET /api/candidati-fase?faseId=        → CandidatoFase[] (per ogni fase)
 *   GET /api/valutazioni?candidatoFaseId=  → Valutazione[]  (per ogni cf)
 */

import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Calendar, Flag, Folder, GraduationCap, Gavel, Scale, Settings, Shield, Trophy, User } from 'lucide-react';

import { useActiveConcorso } from '@/api/concorsi';
import { http } from '@/lib/api';
import { fetchValutazioniByFase } from '@/api/valutazioni';
import type { Fase, Candidato, Commissario, Sezione, Commissione, Evento, CandidatoFase } from '@/types';
import { ConcorsoSelector } from '@/components/admin/ConcorsoSelector';
import { presidentiFor, type CommissioneLike } from '@/lib/presidenti';
import { faseFullLabel } from '@/lib/fase-label';

// ---------------------------------------------------------------------------
// SIDEBAR_TABS — single source of truth (mirrors vanilla dashboard.js order)
// 10 items: sezioni, commissari, commissioni, fasi, calendario, iscrizioni,
//           candidati, risultati, audit, impostazioni-concorso
// ---------------------------------------------------------------------------

interface SidebarTab {
  id: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  /** key into CountsMap, or null when count not applicable */
  countKey: 'sezioni' | 'commissari' | 'commissioni' | 'fasi' | 'eventi' | 'candidati' | null;
}

const SIDEBAR_TABS: SidebarTab[] = [
  {
    id: 'sezioni',
    icon: <Folder size={18} />,
    label: 'Sezioni',
    desc: 'Gestisci le sezioni strumentali del concorso.',
    countKey: 'sezioni',
  },
  {
    id: 'commissari',
    icon: <Gavel size={18} />,
    label: 'Commissari',
    desc: 'Elenco dei commissari e relative specialità.',
    countKey: 'commissari',
  },
  {
    id: 'commissioni',
    icon: <Scale size={18} />,
    label: 'Commissioni',
    desc: 'Composizione e presidenza delle commissioni.',
    countKey: 'commissioni',
  },
  {
    id: 'fasi',
    icon: <Flag size={18} />,
    label: 'Fasi',
    desc: 'Fasi del concorso: pianificazione, stato e ordine.',
    countKey: 'fasi',
  },
  {
    id: 'calendario',
    icon: <Calendar size={18} />,
    label: 'Calendario',
    desc: 'Calendariazione degli eventi per fase e sezione.',
    countKey: 'eventi',
  },
  {
    id: 'iscrizioni',
    icon: <User size={18} />,
    label: 'Iscrizioni',
    desc: 'Gestione domande di iscrizione e approvazioni.',
    countKey: null,
  },
  {
    id: 'candidati',
    icon: <GraduationCap size={18} />,
    label: 'Candidati',
    desc: 'Anagrafica e dati di tutti i candidati iscritti.',
    countKey: 'candidati',
  },
  {
    id: 'risultati',
    icon: <Trophy size={18} />,
    label: 'Risultati',
    desc: 'Classifiche, punteggi e pubblicazione esiti.',
    countKey: null,
  },
  {
    id: 'audit',
    icon: <Shield size={18} />,
    label: 'Audit',
    desc: 'Log delle azioni amministrative sul concorso.',
    countKey: null,
  },
  {
    id: 'impostazioni-concorso',
    icon: <Settings size={18} />,
    label: 'Impostazioni',
    desc: 'Configura parametri e opzioni del concorso.',
    countKey: null,
  },
];

// ---------------------------------------------------------------------------
// CountsMap — derived from fetched data
// ---------------------------------------------------------------------------

interface CountsMap {
  sezioni: number;
  commissari: number;
  commissioni: number;
  fasi: number;
  eventi: number;
  candidati: number;
}

// ---------------------------------------------------------------------------
// KpiCard — replica di kpiCard() vanilla
// accent palette: brand (teal) / sky / amber / emerald
// ---------------------------------------------------------------------------

type KpiAccent = 'brand' | 'sky' | 'amber' | 'emerald';

const ACCENT_CLASSES: Record<KpiAccent, { bg: string; text: string; border: string }> = {
  brand:   { bg: 'bg-brand-50',   text: 'text-brand-700',   border: 'border-brand-100' },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-100' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
};

interface KpiCardProps {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  accent: KpiAccent;
}

function KpiCard({ icon, value, label, accent }: KpiCardProps) {
  const a = ACCENT_CLASSES[accent];
  return (
    <div className={`bg-white border ${a.border} rounded-xl p-3.5`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</p>
        <span className={`w-7 h-7 rounded-lg ${a.bg} ${a.text} inline-flex items-center justify-center shrink-0`}>
          {icon}
        </span>
      </div>
      <div className="text-2xl font-bold text-ink-900 leading-tight">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionCard — replica di sectionCard() vanilla
// icon + label + count badge + desc + hover "Apri →"
// Links to '/admin' (React Router Link, matches vanilla setAdminTab behaviour)
// ---------------------------------------------------------------------------

// Colore icona per sezione (classi Tailwind letterali → generate dallo scanner).
const SECTION_ICON_COLORS: Record<string, string> = {
  sezioni: 'bg-brand-50 text-brand-700',
  commissari: 'bg-amber-50 text-amber-700',
  commissioni: 'bg-violet-50 text-violet-700',
  fasi: 'bg-emerald-50 text-emerald-700',
  calendario: 'bg-sky-50 text-sky-700',
  iscrizioni: 'bg-rose-50 text-rose-700',
  candidati: 'bg-indigo-50 text-indigo-700',
  risultati: 'bg-yellow-50 text-yellow-700',
  audit: 'bg-slate-100 text-slate-700',
  'impostazioni-concorso': 'bg-cyan-50 text-cyan-700',
};

function SectionCard({ tab, count }: { tab: SidebarTab; count: number | null }) {
  // 'impostazioni-concorso' (id vanilla) → tab 'impostazioni' del workspace.
  const tabId = tab.id === 'impostazioni-concorso' ? 'impostazioni' : tab.id;
  const iconColor = SECTION_ICON_COLORS[tab.id] ?? 'bg-brand-50 text-brand-700';
  return (
    <Link
      to={`/admin?tab=${tabId}`}
      className="text-left bg-white border border-slate-200 hover:border-brand-300 hover:shadow-md rounded-xl p-4 transition-all group block"
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`w-9 h-9 rounded-lg ${iconColor} inline-flex items-center justify-center transition-colors`}>
          {tab.icon}
        </span>
        {count != null && (
          <span className="text-xs font-mono bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      <h4 className="text-sm font-semibold text-ink-900">{tab.label}</h4>
      <p className="text-xs text-ink-700 mt-1 line-clamp-2">{tab.desc}</p>
      <p className="text-[11px] text-brand-600 mt-2 inline-flex items-center gap-1 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        Apri <ArrowRight size={12} />
      </p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// HorizontalBarChart — replica del bar chart vanilla (strumenti / nazionalità)
// ---------------------------------------------------------------------------

interface BarChartProps {
  title: string;
  rows: [string, number][];
  max: number;
  barClass: string;
  bgClass: string;
}

function HorizontalBarChart({ title, rows, max, barClass, bgClass }: BarChartProps) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h4 className="font-semibold text-ink-900 mb-4 text-sm">{title}</h4>
      <div className="space-y-2">
        {rows.map(([label, count]) => (
          <div key={label} className="flex items-center gap-3">
            <span className="w-24 text-xs text-ink-700 truncate">{label}</span>
            <div className={`flex-1 h-5 ${bgClass} rounded-full overflow-hidden`}>
              <div
                className={`h-full ${barClass} rounded-full transition-all`}
                style={{ width: `${((count / max) * 100).toFixed(0)}%` }}
              />
            </div>
            <span className="text-xs font-mono font-medium text-ink-900 w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FasiSummaryTable — replica FEDELE della tabella vanilla:
//   5 colonne: Fase | Candidati | Valutazioni | Ammessi | % ammessi
//
// Per ogni fase:
//   1. GET /api/candidati-fase?faseId=   → CandidatoFase[]
//   2. GET /api/valutazioni?candidatoFaseId= (fanout per ogni cf.id)
//      tramite fetchValutazioniByFase(ids)
//
// valCount = numero di righe Valutazione della fase (non de-duplicato,
// mirrors vanilla che conta s.valutazioni filtrate per cf della fase)
// ---------------------------------------------------------------------------

interface FaseStat {
  nome: string;
  ordine: number;
  totale: number;
  valutazioni: number;
  ammessi: number;
}

function FasiSummaryTable({ fasi, activeId, sezioni }: { fasi: Fase[]; activeId: string; sezioni: Sezione[] }) {
  // Step 1: candidati-fase per ogni fase
  const cfQueries = useQueries({
    queries: fasi.map((f) => ({
      queryKey: ['candidati-fase', f.id, activeId],
      queryFn: () => http.get<CandidatoFase[]>('candidati-fase', { faseId: f.id }),
      staleTime: 60_000,
    })),
  });

  // Collect all cf.id lists per fase (used to fan-out valutazioni queries)
  const cfIdsByFase: string[][] = fasi.map((_, i) => {
    const cfs: CandidatoFase[] = cfQueries[i]?.data ?? [];
    return cfs.map((cf) => cf.id);
  });

  // Step 2: valutazioni per ogni fase (fanout via fetchValutazioniByFase)
  const valQueries = useQueries({
    queries: fasi.map((f, i) => ({
      queryKey: ['valutazioni', 'by-fase', f.id, activeId],
      queryFn: () => fetchValutazioniByFase(cfIdsByFase[i] ?? []),
      // only run once we have the cf ids
      enabled: cfQueries[i]?.isSuccess,
      staleTime: 60_000,
    })),
  });

  const stats: FaseStat[] = fasi.map((f, i) => {
    const cfs: CandidatoFase[] = cfQueries[i]?.data ?? [];
    const valCount = valQueries[i]?.data?.length ?? 0;
    const ammessi = cfs.filter((cf) => cf.ammessoProssimaFase).length;
    return {
      // Etichetta completa "fase madre · figlia" per distinguere figlie omonime.
      nome: faseFullLabel(f, sezioni),
      ordine: f.ordine,
      totale: cfs.length,
      valutazioni: valCount,
      ammessi,
    };
  });

  return (
    <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 overflow-x-auto">
      <h4 className="font-semibold text-ink-900 mb-4 text-sm">Riepilogo fasi</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            {(
              [
                { col: 'Fase',        align: 'text-left' },
                { col: 'Candidati',   align: 'text-center' },
                { col: 'Valutazioni', align: 'text-center' },
                { col: 'Ammessi',     align: 'text-center' },
                { col: '% ammessi',   align: 'text-center' },
              ] as const
            ).map(({ col, align }) => (
              <th
                key={col}
                className={`${align} px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((fs) => (
            <tr
              key={`${fs.ordine}-${fs.nome}`}
              className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <td className="px-3 py-2.5 font-medium text-ink-900">
                #{fs.ordine} {fs.nome}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-ink-700">{fs.totale}</td>
              <td className="px-3 py-2.5 text-center font-mono text-ink-700">{fs.valutazioni}</td>
              <td
                className={`px-3 py-2.5 text-center font-mono ${
                  fs.ammessi > 0 ? 'text-emerald-700 font-medium' : 'text-ink-700'
                }`}
              >
                {fs.ammessi}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-ink-700">
                {fs.totale > 0 ? `${Math.round((fs.ammessi / fs.totale) * 100)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NoPresidenteBanner — replica del banner vanilla:
//   bg-amber-50 border border-amber-200, icon warning, testo fisso.
//   Mostrato quando NESSUNA commissione ha presidenteId != null.
// ---------------------------------------------------------------------------

function NoPresidenteBanner() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
      <div>
        <strong>Nessun presidente designato.</strong>{' '}
        Apri il tab Commissioni per assegnare un presidente ad almeno una commissione.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — nessun concorso selezionato (solo in modalità standalone)
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center">
        <Trophy className="w-7 h-7 text-brand-700" />
      </div>
      <div>
        <p className="font-semibold text-ink-900">Nessun concorso selezionato</p>
        <p className="text-sm text-ink-700 mt-1">
          Seleziona un concorso dal menu in alto per visualizzare la dashboard.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardContent — rendered when a concorso is selected
// Mirrors renderDashboard() from vanilla dashboard.js exactly.
// ---------------------------------------------------------------------------

function DashboardContent({ activeId }: { activeId: string }) {
  const results = useQueries({
    queries: [
      {
        queryKey: ['fasi', activeId],
        queryFn: () => http.get<Fase[]>('fasi', { concorsoId: activeId }),
        staleTime: 30_000,
      },
      {
        queryKey: ['candidati', activeId],
        queryFn: () => http.get<Candidato[]>('candidati', { concorsoId: activeId }),
        staleTime: 30_000,
      },
      {
        queryKey: ['commissari', activeId],
        queryFn: () => http.get<Commissario[]>('commissari', { concorsoId: activeId }),
        staleTime: 30_000,
      },
      {
        queryKey: ['sezioni', activeId],
        queryFn: () => http.get<Sezione[]>('sezioni', { concorsoId: activeId }),
        staleTime: 30_000,
      },
      {
        queryKey: ['commissioni', activeId],
        queryFn: () => http.get<Commissione[]>('commissioni', { concorsoId: activeId }),
        staleTime: 30_000,
      },
      {
        queryKey: ['calendario/eventi', activeId],
        queryFn: () => http.get<Evento[]>('calendario/eventi', { concorsoId: activeId }),
        staleTime: 30_000,
      },
    ],
  });

  const [fasiQ, candidatiQ, commissariQ, sezioniQ, commissioniQ, eventiQ] = results;

  const fasi: Fase[]               = fasiQ.data        ?? [];
  const candidati: Candidato[]     = candidatiQ.data   ?? [];
  const commissari: Commissario[]  = commissariQ.data  ?? [];
  const sezioni: Sezione[]         = sezioniQ.data     ?? [];
  const commissioni: Commissione[] = commissioniQ.data ?? [];
  const eventi: Evento[]           = eventiQ.data      ?? [];

  // KPI derivations
  const fasiConcluse = fasi.filter((f) => f.stato === 'CONCLUSA').length;
  const fasiInCorso  = fasi.filter((f) => f.stato === 'IN_CORSO').length;
  const fasiSorted   = [...fasi].sort((a, b) => a.ordine - b.ordine);

  // Counts for section-card badges
  const counts: CountsMap = {
    sezioni:     sezioni.length,
    commissari:  commissari.length,
    commissioni: commissioni.length,
    fasi:        fasi.length,
    eventi:      eventi.length,
    candidati:   candidati.length,
  };

  // No-presidente: true se il concorso ha almeno un presidente distinto.
  // mirrors: db.presidentiFor(concorso.id).length > 0 (ora in @/lib/presidenti).
  // I record commissione/commissario del server portano `presidenteCommissarioId`
  // e l'`id` richiesti dalla shape strutturale CommissioneLike/CommissarioLike.
  const hasAnyPresidente =
    presidentiFor(activeId, commissioni as unknown as CommissioneLike[], commissari).length > 0;

  // Distribuzione strumenti (top 8) — mirrors vanilla
  const strumentiMap: Record<string, number> = {};
  candidati.forEach((c) => {
    const k = c.strumento ?? 'Altro';
    strumentiMap[k] = (strumentiMap[k] ?? 0) + 1;
  });
  const strumentiSorted = Object.entries(strumentiMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxStrumenti = Math.max(1, ...strumentiSorted.map(([, n]) => n));

  // Distribuzione nazionalità (all, no top-N limit) — mirrors vanilla
  const nazMap: Record<string, number> = {};
  candidati.forEach((c) => {
    const n = c.nazionalita ?? '—';
    nazMap[n] = (nazMap[n] ?? 0) + 1;
  });
  const nazSorted = Object.entries(nazMap).sort((a, b) => b[1] - a[1]);
  const maxNaz = Math.max(1, ...nazSorted.map(([, n]) => n));

  // Stats section shown only when candidati OR fasi exist
  // mirrors vanilla: `candidati.length === 0 && fasi.length === 0 ? '' : ...`
  const hasStats = candidati.length > 0 || fasi.length > 0;

  return (
    <div className="space-y-6">
      {/* ---- KPI strip: candidati / commissari / fasi concluse ---- */}
      {/* 3 cards; fasi accent amber when in-corso, emerald when all done */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<GraduationCap size={18} />}
          value={candidati.length}
          label="Candidati"
          accent="brand"
        />
        <KpiCard
          icon={<Gavel size={18} />}
          value={commissari.length}
          label="Commissari"
          accent="sky"
        />
        <KpiCard
          icon={<Flag size={18} />}
          value={`${fasiConcluse}/${fasi.length}`}
          label="Fasi concluse"
          accent={fasiInCorso > 0 ? 'amber' : 'emerald'}
        />
      </section>

      {/* ---- Sezioni del concorso: griglia di 10 cards cliccabili ---- */}
      <section>
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-ink-900">Sezioni del concorso</h3>
          <p className="text-xs text-ink-700">
            Le stesse voci della sidebar a sinistra, in forma di accesso rapido.
          </p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" id="dashboard-cards">
          {SIDEBAR_TABS.map((tab) => (
            <SectionCard
              key={tab.id}
              tab={tab}
              count={tab.countKey !== null ? (counts[tab.countKey] ?? null) : null}
            />
          ))}
        </div>
      </section>

      {/* ---- No-presidente warning banner ---- */}
      {/* Shown when NO commissione has a presidente assigned */}
      {!hasAnyPresidente && <NoPresidenteBanner />}

      {/* ---- Statistiche del concorso ---- */}
      {hasStats && (
        <section>
          <header className="mb-3">
            <h3 className="text-sm font-semibold text-ink-900">Statistiche del concorso</h3>
            <p className="text-xs text-ink-700">
              Distribuzione candidati e riepilogo per fase.
            </p>
          </header>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Distribuzione strumenti (top 8) — bg-brand-50 / bar bg-brand-500 */}
            <HorizontalBarChart
              title="Candidati per strumento"
              rows={strumentiSorted}
              max={maxStrumenti}
              barClass="bg-brand-500"
              bgClass="bg-brand-50"
            />
            {/* Distribuzione nazionalità (all) — bg-amber-50 / bar bg-amber-500 */}
            <HorizontalBarChart
              title="Candidati per nazionalità"
              rows={nazSorted}
              max={maxNaz}
              barClass="bg-amber-500"
              bgClass="bg-amber-50"
            />
            {/* Riepilogo per fase — 5 colonne: Fase/Candidati/Valutazioni/Ammessi/% */}
            {fasiSorted.length > 0 && (
              <FasiSummaryTable fasi={fasiSorted} activeId={activeId} sezioni={sezioni} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminDashboard — public default export
// ---------------------------------------------------------------------------

interface AdminDashboardProps {
  /** Quando true (dentro AdminWorkspace) sopprime selector e empty-state. */
  embedded?: boolean;
}

export default function AdminDashboard({ embedded = false }: AdminDashboardProps) {
  const { activeId, activeConcorso } = useActiveConcorso();

  // ---- Embedded mode: no selector, no empty-state prompt ----
  if (embedded) {
    if (!activeId) return null;
    return <DashboardContent activeId={activeId} />;
  }

  // ---- Standalone mode: selector + title header ----
  return (
    <div className="c-page space-y-6">
      {/* Header: selector + titolo concorso */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="c-page-header__eyebrow">Dashboard</p>
          <h1 className="c-page-header__title text-2xl">
            {activeConcorso ? activeConcorso.nome : 'Dashboard'}
          </h1>
          {activeConcorso?.anno && (
            <p className="c-page-header__sub text-sm mt-0.5">Edizione {activeConcorso.anno}</p>
          )}
        </div>
        <ConcorsoSelector className="sm:mt-0.5 shrink-0" />
      </div>

      {/* No concorso selected */}
      {!activeId && <EmptyState />}

      {/* Dashboard content */}
      {activeId && <DashboardContent activeId={activeId} />}
    </div>
  );
}
