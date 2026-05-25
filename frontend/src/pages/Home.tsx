import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Trophy,
  Flag,
  Users,
  ClipboardList,
  Settings,
  Music,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchDashboardCounts } from '@/api/home';
import { http } from '@/lib/api';
import { useConcorsi } from '@/api/concorsi';
import type { Concorso, Fase, Candidato } from '@/types';
import type { ReactNode } from 'react';

// ─── KPI stat card ────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  sub: string;
  icon: ReactNode;
  accent?: 'teal' | 'amber' | 'gray' | 'rose' | '';
}

function StatCard({ label, value, sub, icon, accent = '' }: StatCardProps) {
  const cls = accent ? `c-stat c-stat--${accent}` : 'c-stat';
  return (
    <div className={cls}>
      <span
        className="absolute right-4 top-4 text-muted-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="c-stat__label">{label}</p>
      <p className="c-stat__value">{String(value)}</p>
      <p className="c-stat__sub">{sub}</p>
    </div>
  );
}

// ─── Role tile ────────────────────────────────────────────────────────────────

interface RoleTileProps {
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  icon: ReactNode;
  onClick: () => void;
}

function RoleTile({
  eyebrow,
  title,
  description,
  cta,
  icon,
  onClick,
}: RoleTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="c-tile c-tile--padded c-tile--clickable text-left"
      style={{ minHeight: '12rem' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="c-tile__eyebrow">{eyebrow}</p>
          <h3 className="c-tile__title flex items-center gap-2">
            <span className="text-muted-foreground">{icon}</span>
            {title}
          </h3>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-sm">
            {description}
          </p>
        </div>
        <span className="text-muted-foreground leading-none mt-1" aria-hidden="true">
          <ArrowRight size={24} />
        </span>
      </div>
      <div className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary">
        {cta} <ArrowRight size={14} />
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { t } = useTranslation();
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const { data: counts } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: fetchDashboardCounts,
    staleTime: 30_000,
    retry: 1,
  });

  const safe = {
    concorsiAttivi: counts?.concorsiAttivi ?? 0,
    concorsiTotal: counts?.concorsiTotal ?? 0,
    fasiInCorso: counts?.fasiInCorso ?? 0,
    fasiTotal: counts?.fasiTotal ?? 0,
    candidatiTotal: counts?.candidatiTotal ?? 0,
    valutazioniTotal: counts?.valutazioniTotal ?? 0,
  };

  const showAdmin = hasRole('admin', 'superadmin');
  const showCommissario = hasRole('commissario') || Boolean(user?.commissarioId);

  // Concorsi table (admin only) — mirrors vanilla renderHome's bottom table.
  const { data: concorsi = [] } = useConcorsi();
  const { data: allFasi = [] } = useQuery({
    queryKey: ['tenant-all', 'fasi'],
    queryFn: () => http.get<Fase[]>('fasi', { limit: 2000 }),
    staleTime: 30_000,
    enabled: showAdmin,
  });
  const { data: allCandidati = [] } = useQuery({
    queryKey: ['tenant-all', 'candidati'],
    queryFn: () => http.get<Candidato[]>('candidati', { limit: 2000 }),
    staleTime: 30_000,
    enabled: showAdmin,
  });

  const fasiByConcorso = useMemo(() => {
    const m = new Map<string, Fase[]>();
    for (const f of allFasi) {
      const arr = m.get(f.concorsoId) ?? [];
      arr.push(f);
      m.set(f.concorsoId, arr);
    }
    return m;
  }, [allFasi]);

  const candidatiCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allCandidati) m.set(c.concorsoId, (m.get(c.concorsoId) ?? 0) + 1);
    return m;
  }, [allCandidati]);

  // Entra nell'amministrazione di un concorso (riga tabella → /admin?c=ID).
  const openConcorso = (id: string) => {
    if (!showAdmin) {
      toast.error(t('home.role.forbidden'));
      return;
    }
    void navigate(`/admin?c=${encodeURIComponent(id)}`);
  };

  const faseTagClass = (stato: Fase['stato']) =>
    stato === 'IN_CORSO'
      ? 'c-tag c-tag--blue'
      : stato === 'CONCLUSA'
        ? 'c-tag c-tag--gray c-tag--no-dot'
        : 'c-tag c-tag--yellow';

  const statoTagClass = (stato: Concorso['stato']) =>
    stato === 'ATTIVO' ? 'c-tag c-tag--green' : 'c-tag c-tag--gray c-tag--no-dot';

  return (
    <section className="view-fade">

      {/* Carbon page header */}
      <header className="c-page-header">
        <p className="c-page-header__eyebrow">{t('home.eyebrow')}</p>
        <h1 className="c-page-header__title">{t('home.title')}</h1>
        <p className="c-page-header__sub">{t('home.subtitle')}</p>
      </header>

      <div className="c-page max-w-7xl mx-auto">

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            label={t('home.kpi.concorsi_attivi')}
            value={safe.concorsiAttivi}
            sub={t('home.kpi.concorsi_total', { n: safe.concorsiTotal })}
            icon={<Trophy size={20} />}
            accent=""
          />
          <StatCard
            label={t('home.kpi.fasi_in_corso')}
            value={safe.fasiInCorso}
            sub={t('home.kpi.fasi_total', { n: safe.fasiTotal })}
            icon={<Flag size={20} />}
            accent="teal"
          />
          <StatCard
            label={t('home.kpi.candidati')}
            value={safe.candidatiTotal}
            sub={t('home.kpi.candidati_sub')}
            icon={<Users size={20} />}
            accent="amber"
          />
          <StatCard
            label={t('home.kpi.valutazioni')}
            value={safe.valutazioniTotal}
            sub={t('home.kpi.valutazioni_sub')}
            icon={<ClipboardList size={20} />}
            accent="gray"
          />
        </div>

        {/* Role selector */}
        {(showAdmin || showCommissario) && (
          <>
            <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground mb-3">
              {t('home.role.select')}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {showAdmin && (
                <RoleTile
                  eyebrow={t('home.role.admin.eyebrow')}
                  title={t('home.role.admin.title')}
                  description={t('home.role.admin.desc')}
                  cta={t('home.role.admin.cta')}
                  icon={<Settings size={20} />}
                  onClick={() => navigate('/admin')}
                />
              )}
              {showCommissario && (
                <RoleTile
                  eyebrow={t('home.role.com.eyebrow')}
                  title={t('home.role.com.title')}
                  description={`${t('home.role.com.desc1')} ${t('home.role.com.desc_pres')} ${t('home.role.com.desc2')}`}
                  cta={t('home.role.com.cta')}
                  icon={<Music size={20} />}
                  onClick={() => navigate('/commissario')}
                />
              )}
            </div>
          </>
        )}

        {/* No-role fallback */}
        {!showAdmin && !showCommissario && (
          <div className="c-tile c-tile--padded mb-6">
            <p className="text-sm text-muted-foreground">{t('home.role.forbidden')}</p>
          </div>
        )}

        {/* Concorsi table (admin) — click a row to enter that concorso's admin */}
        {showAdmin && concorsi.length > 0 && (
          <>
            <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground mb-3">
              {t('home.concorsi.heading')}
            </h2>
            <div className="c-tile" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="c-table">
                <thead>
                  <tr>
                    <th>{t('home.concorsi.col_nome')}</th>
                    <th className="hidden md:table-cell">{t('home.concorsi.col_anno')}</th>
                    <th className="hidden md:table-cell">{t('home.concorsi.col_candidati')}</th>
                    <th>{t('home.concorsi.col_fasi')}</th>
                    <th>{t('home.concorsi.col_stato')}</th>
                  </tr>
                </thead>
                <tbody>
                  {concorsi.map((c) => {
                    const fs = fasiByConcorso.get(c.id) ?? [];
                    return (
                      <tr
                        key={c.id}
                        onClick={() => openConcorso(c.id)}
                        className="cursor-pointer hover:bg-brand-50/50 transition-colors"
                        title={t('admin.selector.open')}
                      >
                        <td><span className="font-medium">{c.nome}</span></td>
                        <td className="hidden md:table-cell">{c.anno ?? '—'}</td>
                        <td className="hidden md:table-cell">{candidatiCount.get(c.id) ?? 0}</td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {fs.length > 0 ? (
                              fs.map((f) => (
                                <span key={f.id} className={faseTagClass(f.stato)}>
                                  {f.nome}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={statoTagClass(c.stato)}>{c.stato}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

      </div>
    </section>
  );
}
