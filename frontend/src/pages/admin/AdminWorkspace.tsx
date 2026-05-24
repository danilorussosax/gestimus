import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Folder,
  Gavel,
  Scale,
  Flag,
  Calendar,
  User,
  GraduationCap,
  Trophy,
  Shield,
  Settings,
  RefreshCw,
  Plus,
  Star,
  ArrowLeft,
  ArrowRight,
  TriangleAlert,
  EyeOff,
  BookOpen,
} from 'lucide-react';

import { useActiveConcorso } from '@/api/concorsi';
import { ConcorsoSelector } from '@/components/admin/ConcorsoSelector';
import { FasiTab } from '@/components/admin/FasiTab';
import { CandidatiTab } from '@/components/admin/CandidatiTab';
import { IscrizioniTab } from '@/components/admin/IscrizioniTab';
import { RisultatiTab } from '@/components/admin/RisultatiTab';
import { CalendarioTab } from '@/components/admin/CalendarioTab';
import { AuditTab } from '@/components/admin/AuditTab';
import CommissariTab from '@/components/admin/CommissariTab';
import CommissioniTab from '@/components/admin/CommissioniTab';
import SezioniTab from '@/components/admin/SezioniTab';
import AdminDashboard from '@/pages/admin/Dashboard';
import { ImpostazioniConcorsoTab } from '@/components/admin/ImpostazioniConcorsoTab';

import { useCandidati } from '@/api/candidati';
import { useCommissari } from '@/api/commissari';
import { useCommissioni } from '@/api/commissioni';
import { useFasi } from '@/api/fasi';
import { useSezioni } from '@/api/sezioni';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId =
  | 'dashboard'
  | 'sezioni'
  | 'commissari'
  | 'commissioni'
  | 'fasi'
  | 'calendario'
  | 'iscrizioni'
  | 'candidati'
  | 'risultati'
  | 'audit'
  | 'impostazioni';

interface TabDef {
  id: TabId;
  label: string;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  countKey?: 'candidati' | 'commissari' | 'commissioni' | 'fasi' | 'sezioni';
}

const TABS: TabDef[] = [
  { id: 'dashboard',    labelKey: 'admin.nav.dashboard',    label: 'Dashboard',    Icon: LayoutDashboard },
  { id: 'sezioni',      labelKey: 'admin.nav.sezioni',      label: 'Sezioni',      Icon: Folder,        countKey: 'sezioni' },
  { id: 'commissari',   labelKey: 'admin.nav.commissari',   label: 'Commissari',   Icon: Gavel,         countKey: 'commissari' },
  { id: 'commissioni',  labelKey: 'admin.nav.commissioni',  label: 'Commissioni',  Icon: Scale,         countKey: 'commissioni' },
  { id: 'fasi',         labelKey: 'admin.nav.fasi',         label: 'Fasi',         Icon: Flag,          countKey: 'fasi' },
  { id: 'calendario',   labelKey: 'admin.nav.calendario',   label: 'Calendario',   Icon: Calendar },
  { id: 'iscrizioni',   labelKey: 'admin.tab.iscrizioni',   label: 'Iscrizioni',   Icon: User },
  { id: 'candidati',    labelKey: 'admin.nav.candidati',    label: 'Candidati',    Icon: GraduationCap, countKey: 'candidati' },
  { id: 'risultati',    labelKey: 'admin.nav.risultati',    label: 'Risultati',    Icon: Trophy },
  { id: 'audit',        labelKey: 'admin.nav.audit',        label: 'Audit',        Icon: Shield },
  { id: 'impostazioni', labelKey: 'admin.nav.impostazioni_concorso', label: 'Impostazioni', Icon: Settings },
];

// ---------------------------------------------------------------------------
// Count data hook — only called when activeId is available
// ---------------------------------------------------------------------------

function useCounts(concorsoId: string) {
  // useCandidati returns a custom shape { candidati, ... } (not useQuery directly)
  const { candidati }              = useCandidati(concorsoId);
  const { data: commissari  = [] } = useCommissari(concorsoId);
  const { data: commissioni = [] } = useCommissioni(concorsoId);
  const { data: fasi        = [] } = useFasi(concorsoId);
  const { data: sezioni     = [] } = useSezioni(concorsoId);
  return {
    candidati:   candidati.length,
    commissari:  commissari.length,
    commissioni: commissioni.length,
    fasi:        fasi.length,
    sezioni:     sezioni.length,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type Counts = ReturnType<typeof useCounts>;

interface SidebarNavItemProps {
  tab: TabDef;
  active: boolean;
  count: number | null;
  onClick: () => void;
}

function SidebarNavItem({ tab, active, count, onClick }: SidebarNavItemProps) {
  const base =
    'flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2';
  const cls = active
    ? `${base} bg-[#edf5ff] border-l-brand-500 text-ink-900`
    : `${base} border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900`;

  return (
    <button type="button" onClick={onClick} className={cls}>
      <span className={`leading-none ${active ? 'text-brand-600' : 'text-ink-700'}`} aria-hidden="true">
        <tab.Icon size={16} />
      </span>
      <span className="flex-1">{tab.label}</span>
      {count != null && (
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 ${
            active ? 'bg-white text-brand-700' : 'bg-brand-50 text-ink-700 border border-brand-100'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface MobileTabButtonProps {
  tab: TabDef;
  active: boolean;
  onClick: () => void;
}

function MobileTabButton({ tab, active, onClick }: MobileTabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm font-medium px-3 h-10 transition whitespace-nowrap inline-flex items-center gap-2 border-b-2 ${
        active
          ? 'border-b-brand-500 text-ink-900 bg-white'
          : 'border-b-transparent text-ink-700 hover:bg-brand-50'
      }`}
    >
      <span aria-hidden="true" className={active ? 'text-brand-600' : 'text-ink-700'}>
        <tab.Icon size={14} />
      </span>
      {tab.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Dashboard placeholder tab
// ---------------------------------------------------------------------------

function DashboardPlaceholder() {
  return (
    <div className="c-tile text-center py-10 flex flex-col items-center gap-4">
      <LayoutDashboard size={32} className="text-brand-600 opacity-60" />
      <p className="text-ink-700 text-sm">
        La dashboard completa si trova nella pagina dedicata.
      </p>
      <Link to="/admin/dashboard" className="c-btn c-btn--primary c-btn--sm">
        <LayoutDashboard size={14} />
        <span>Vai alla Dashboard</span>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** Workspace admin: sidebar + tab di gestione concorso (layout vanilla replica). */
export default function AdminWorkspace() {
  const { t } = useTranslation();
  const { activeId, setActiveId, activeConcorso } = useActiveConcorso();
  // Tab attivo da URL (?tab=) così i deep-link (es. card della dashboard,
  // /admin?tab=fasi) selezionano la tab giusta.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = TABS.some((tb) => tb.id === tabParam)
    ? (tabParam as TabId)
    : 'dashboard';
  const setActiveTab = (tb: TabId) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tab', tb);
        return p;
      },
      { replace: true },
    );
  };

  const lbl = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  // If no active concorso, show selector
  if (!activeId || !activeConcorso) {
    return <ConcorsoSelector />;
  }

  return <WorkspaceInner
    concorsoId={activeId}
    concorso={activeConcorso}
    activeTab={activeTab}
    setActiveTab={setActiveTab}
    setActiveId={setActiveId}
    lbl={lbl}
  />;
}

// ---------------------------------------------------------------------------
// Inner workspace — only rendered when concorso is resolved
// ---------------------------------------------------------------------------

interface WorkspaceInnerProps {
  concorsoId: string;
  concorso: { nome: string; anno: number | null; stato: string; anonimo: boolean };
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  setActiveId: (id: string | null) => void;
  lbl: (key: string, fallback: string) => string;
}

function WorkspaceInner({
  concorsoId,
  concorso,
  activeTab,
  setActiveTab,
  setActiveId,
  lbl,
}: WorkspaceInnerProps) {
  const counts = useCounts(concorsoId);

  function getCount(tab: TabDef): number | null {
    if (!tab.countKey) return null;
    return (counts)[tab.countKey];
  }

  const statoTag =
    concorso.stato === 'ATTIVO'
      ? 'c-tag c-tag--green'
      : 'c-tag c-tag--gray c-tag--no-dot';

  return (
    <section className="view-fade c-page">
      <div className="flex gap-6 lg:gap-8 items-start">

        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="hidden md:block w-60 lg:w-64 shrink-0 sticky top-24">
          <div className="bg-white border border-brand-100 relative">

            {/* "Generale" header link */}
            <Link
              to="/"
              className="block px-4 py-4 border-b border-brand-100 hover:bg-accent transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[-2px]"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700">
                {lbl('admin.nav.eyebrow', 'Gestione')}
              </p>
              <h3 className="font-medium text-[15px] leading-tight mt-1 text-ink-900 inline-flex items-center gap-1.5">
                {lbl('admin.nav.eyebrow_title', 'Generale')}
                <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
                  <ArrowRight size={14} />
                </span>
              </h3>
            </Link>

            {/* Sezioni group */}
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700 px-4 pt-4 pb-2">
              {lbl('admin.nav.sections', 'Sezioni')}
            </p>
            <nav className="flex flex-col">
              {TABS.map((tab) => (
                <SidebarNavItem
                  key={tab.id}
                  tab={{ ...tab, label: lbl(tab.labelKey, tab.label) }}
                  active={activeTab === tab.id}
                  count={getCount(tab)}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </nav>

            {/* Amministrazione group */}
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700 px-4 pt-5 pb-2 border-t border-brand-100 mt-3">
              {lbl('admin.nav.admin_section', 'Amministrazione')}
            </p>
            <nav className="flex flex-col">
              <Link
                to="/admin/utenti"
                className="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900"
              >
                <span className="leading-none text-ink-700" aria-hidden="true">
                  <User size={16} />
                </span>
                <span className="flex-1">{lbl('admin.nav.utenti', 'Utenti')}</span>
              </Link>
              <Link
                to="/admin/manuale"
                className="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900"
              >
                <span className="leading-none text-ink-700" aria-hidden="true">
                  <BookOpen size={16} />
                </span>
                <span className="flex-1">{lbl('admin.nav.manuale', 'Manuale')}</span>
              </Link>
            </nav>

            {/* Active concorso card */}
            <div className="mx-4 my-4 bg-brand-50 p-3 border-l-2 border-brand-500">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700">
                {lbl('admin.concorso.active', 'Concorso attivo')}
              </p>
              <div className="font-medium text-sm mt-1.5 leading-snug truncate text-ink-900">
                {concorso.nome}
              </div>
              <div className="text-[11px] text-ink-700 mt-0.5">
                {concorso.anno
                  ? lbl('admin.header.year_short', `${concorso.anno}`).replace('{{anno}}', String(concorso.anno))
                  : '—'}
                {' · '}
                {lbl('admin.header.cands_short', `${counts.candidati} candidati`).replace('{{n}}', String(counts.candidati))}
              </div>
              {counts.commissari === 0 ? (
                <div className="text-[11px] text-[#b28600] font-medium mt-2 flex items-center gap-1.5">
                  <TriangleAlert size={12} />
                  {lbl('admin.header.no_president', 'Nessun presidente')}
                </div>
              ) : (
                <div className="text-[11px] text-ink-900 font-medium mt-2 flex items-center gap-1.5">
                  <Star size={12} className="text-[#b28600]" />
                  <span className="truncate">
                    {counts.commissari}{' '}
                    {lbl('admin.nav.commissari', 'commissari')}
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="px-4 pb-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="c-btn c-btn--ghost c-btn--sm !justify-start !gap-2"
                style={{ color: '#525252' }}
              >
                <RefreshCw size={14} />
                <span>{lbl('admin.concorso.change', 'Cambia concorso')}</span>
              </button>
              <Link to="/admin/nuovo-concorso" className="c-btn c-btn--primary c-btn--sm !justify-start !gap-2">
                <Plus size={14} />
                <span>{lbl('admin.concorso.new', 'Nuovo concorso')}</span>
              </Link>
            </div>

          </div>
        </aside>

        {/* ── Main content ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">

          {/* Back to concorsi breadcrumb */}
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="inline-flex items-center gap-1.5 text-sm text-ink-700 hover:text-ink-900 hover:bg-brand-50 px-2 py-1 rounded-md mb-4 -ml-2 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>{lbl('admin.header.back_to_concorsi', 'Gestione concorsi')}</span>
          </button>

          {/* Page header */}
          <header className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700">
                {concorso.anno
                  ? lbl('admin.header.year_label', `Anno ${concorso.anno}`).replace('{{anno}}', String(concorso.anno))
                  : '—'}
              </p>
              <div className="flex items-center gap-3 flex-wrap mt-1">
                <h2 className="text-2xl sm:text-[28px] font-light text-ink-900 tracking-tight truncate">
                  {concorso.nome}
                </h2>
                <span className={statoTag}>{concorso.stato}</span>
                {concorso.anonimo && (
                  <span className="c-tag c-tag--purple c-tag--no-dot" title={lbl('admin.header.anonimo_title', 'Anonimizzato')}>
                    <EyeOff size={12} />
                    <span className="ml-1">{lbl('admin.header.anonimo_tag', 'Anonimo')}</span>
                  </span>
                )}
              </div>
              <p className="text-sm text-ink-700 mt-1.5">
                {lbl('admin.header.summary', `${counts.commissari} commissari · ${counts.fasi} fasi`)
                  .replace('{{coms}}', String(counts.commissari))
                  .replace('{{fasi}}', String(counts.fasi))}
              </p>
            </div>

            {/* Mobile horizontal tab nav */}
            <nav className="md:hidden flex bg-white border border-brand-100 w-full overflow-x-auto no-scrollbar">
              {TABS.map((tab) => (
                <MobileTabButton
                  key={tab.id}
                  tab={{ ...tab, label: lbl(tab.labelKey, tab.label) }}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </nav>
          </header>

          {/* Tab content */}
          <div>
            {activeTab === 'dashboard'   && <AdminDashboard embedded />}
            {activeTab === 'sezioni'     && <SezioniTab     concorsoId={concorsoId} />}
            {activeTab === 'commissari'  && <CommissariTab  concorsoId={concorsoId} />}
            {activeTab === 'commissioni' && <CommissioniTab concorsoId={concorsoId} />}
            {activeTab === 'fasi'        && <FasiTab        concorsoId={concorsoId} />}
            {activeTab === 'calendario'  && <CalendarioTab  concorsoId={concorsoId} />}
            {activeTab === 'iscrizioni'  && <IscrizioniTab  concorsoId={concorsoId} />}
            {activeTab === 'candidati'   && <CandidatiTab   concorsoId={concorsoId} />}
            {activeTab === 'risultati'   && <RisultatiTab   concorsoId={concorsoId} />}
            {activeTab === 'audit'       && <AuditTab       concorsoId={concorsoId} />}
            {activeTab === 'impostazioni' && <ImpostazioniConcorsoTab concorsoId={concorsoId} />}
          </div>

        </div>
      </div>
    </section>
  );
}
