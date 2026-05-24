import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchDashboardCounts } from '@/api/home';

// ─── KPI card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number | string;
  sub: string;
  icon: ReactNode;
  accent?: 'teal' | 'amber' | 'muted' | 'default';
  loading?: boolean;
}

function KpiCard({ label, value, sub, icon, accent = 'default', loading }: KpiCardProps) {
  const accentBg: Record<string, string> = {
    teal: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    muted: 'bg-muted text-muted-foreground',
    default: 'bg-primary/10 text-primary',
  };
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-mono font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums text-foreground leading-none">
                {value}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground truncate">{sub}</p>
          </div>
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              accentBg[accent],
            )}
          >
            {icon}
          </span>
        </div>
      </CardContent>
    </Card>
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
  variant?: 'primary' | 'secondary';
}

function RoleTile({ eyebrow, title, description, cta, icon: Icon, onClick, variant = 'primary' }: RoleTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col text-left rounded-xl border p-6 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'min-h-[12rem] hover:shadow-md',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary'
          : 'bg-card text-card-foreground hover:bg-accent/50 border-border',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[10px] font-mono font-semibold uppercase tracking-[0.16em] mb-1',
              variant === 'primary' ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}
          >
            {eyebrow}
          </p>
          <h3 className="flex items-center gap-2 text-xl font-bold leading-tight">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                variant === 'primary' ? 'bg-white/20' : 'bg-muted',
              )}
            >
              {Icon}
            </span>
            {title}
          </h3>
          <p
            className={cn(
              'mt-3 text-sm leading-relaxed max-w-sm',
              variant === 'primary' ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {description}
          </p>
        </div>
        <ArrowRight
          className={cn(
            'h-5 w-5 shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5',
            variant === 'primary' ? 'text-primary-foreground/60' : 'text-muted-foreground',
          )}
        />
      </div>
      <div
        className={cn(
          'mt-auto pt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold',
          variant === 'primary' ? 'text-primary-foreground' : 'text-primary',
        )}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { t } = useTranslation();
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const { data: counts, isLoading } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: fetchDashboardCounts,
    staleTime: 30_000,
    // Never throw — show 0 on error
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

  return (
    <section className="mx-auto max-w-5xl space-y-8 pb-12">
      {/* Page header */}
      <header>
        <p className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t('home.eyebrow')}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
          {t('home.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
          {t('home.subtitle')}
        </p>
      </header>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label={t('home.kpi.concorsi_attivi')}
          value={safe.concorsiAttivi}
          sub={t('home.kpi.concorsi_total', { n: safe.concorsiTotal })}
          icon={<Trophy className="h-4 w-4" />}
          accent="default"
          loading={isLoading}
        />
        <KpiCard
          label={t('home.kpi.fasi_in_corso')}
          value={safe.fasiInCorso}
          sub={t('home.kpi.fasi_total', { n: safe.fasiTotal })}
          icon={<Flag className="h-4 w-4" />}
          accent="teal"
          loading={isLoading}
        />
        <KpiCard
          label={t('home.kpi.candidati')}
          value={safe.candidatiTotal}
          sub={t('home.kpi.candidati_sub')}
          icon={<Users className="h-4 w-4" />}
          accent="amber"
          loading={isLoading}
        />
        <KpiCard
          label={t('home.kpi.valutazioni')}
          value={safe.valutazioniTotal}
          sub={t('home.kpi.valutazioni_sub')}
          icon={<ClipboardList className="h-4 w-4" />}
          accent="muted"
          loading={isLoading}
        />
      </div>

      {/* Role tiles */}
      {(showAdmin || showCommissario) && (
        <div>
          <p className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground mb-3">
            {t('home.role.select')}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {showAdmin && (
              <RoleTile
                eyebrow={t('home.role.admin.eyebrow')}
                title={t('home.role.admin.title')}
                description={t('home.role.admin.desc')}
                cta={t('home.role.admin.cta')}
                icon={<Settings className="h-4 w-4" />}
                onClick={() => navigate('/admin')}
                variant="primary"
              />
            )}
            {showCommissario && (
              <RoleTile
                eyebrow={t('home.role.com.eyebrow')}
                title={t('home.role.com.title')}
                description={`${t('home.role.com.desc1')} ${t('home.role.com.desc_pres')} ${t('home.role.com.desc2')}`}
                cta={t('home.role.com.cta')}
                icon={<Music className="h-4 w-4" />}
                onClick={() => navigate('/commissario')}
                variant={showAdmin ? 'secondary' : 'primary'}
              />
            )}
          </div>
        </div>
      )}

      {/* No-role fallback (edge case: account exists but no handled role) */}
      {!showAdmin && !showCommissario && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {user?.role}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {t('home.role.forbidden')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick-action footer (admin shortcut to admin section) */}
      {showAdmin && (
        <div className="flex items-center justify-between rounded-lg border border-dashed px-5 py-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('home.ente.not_configured')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('home.ente.not_configured_desc')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => navigate('/admin')}
          >
            {t('home.ente.configure')}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </section>
  );
}
