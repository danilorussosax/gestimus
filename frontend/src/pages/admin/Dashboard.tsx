/**
 * AdminDashboard — panoramica del concorso attivo.
 *
 * Struttura:
 *   1. ConcorsoSelector + intestazione concorso
 *   2. Strip KPI: fasi, candidati, commissari, valutazioni
 *   3. Timeline fasi ordinata per `ordine`, colorata per stato
 *   4. Tabella riepilogativa fasi (candidati, ammessi, %)
 *
 * Fonti dati:
 *   GET /api/fasi?concorsoId=        → Fase[]
 *   GET /api/candidati?concorsoId=   → Candidato[]
 *   GET /api/commissari?concorsoId=  → Commissario[]
 *   GET /api/valutazioni             → Valutazione[] (no filtro concorso disponibile)
 *   GET /api/candidati-fase?faseId=  → per ogni fase (stats tabella)
 */

import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, Flag, Scale, ListChecks, Trophy } from 'lucide-react';

import { useActiveConcorso } from '@/api/concorsi';
import { http } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Fase, FaseStato, Candidato, Commissario, Valutazione, CandidatoFase } from '@/types';

import { ConcorsoSelector } from '@/components/admin/ConcorsoSelector';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Tipi locali
// ---------------------------------------------------------------------------

interface FaseStats {
  fase: Fase;
  candidatiFase: CandidatoFase[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statoLabel(stato: FaseStato): string {
  if (stato === 'PIANIFICATA') return 'Pianificata';
  if (stato === 'IN_CORSO') return 'In corso';
  if (stato === 'CONCLUSA') return 'Conclusa';
  return stato;
}

function statoVariant(stato: FaseStato): 'muted' | 'warning' | 'success' {
  if (stato === 'CONCLUSA') return 'success';
  if (stato === 'IN_CORSO') return 'warning';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent: 'brand' | 'sky' | 'amber' | 'emerald' | 'slate';
  loading?: boolean;
}

function KpiCard({ icon, label, value, accent, loading }: KpiCardProps) {
  const accentClasses: Record<KpiCardProps['accent'], { bg: string; icon: string; border: string }> = {
    brand:   { bg: 'bg-primary/5',   icon: 'text-primary',   border: 'border-primary/10' },
    sky:     { bg: 'bg-sky-50',      icon: 'text-sky-600',   border: 'border-sky-100' },
    amber:   { bg: 'bg-amber-50',    icon: 'text-amber-600', border: 'border-amber-100' },
    emerald: { bg: 'bg-emerald-50',  icon: 'text-emerald-700', border: 'border-emerald-100' },
    slate:   { bg: 'bg-muted',       icon: 'text-muted-foreground', border: 'border-border' },
  };
  const { bg, icon: iconColor, border } = accentClasses[accent];

  return (
    <div className={cn('bg-card rounded-xl border p-4', border)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </p>
        <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', bg, iconColor)}>
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="text-2xl font-bold text-foreground leading-tight">{value}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase timeline chip
// ---------------------------------------------------------------------------

function FaseChip({ fase }: { fase: Fase }) {
  const isInCorso = fase.stato === 'IN_CORSO';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
        fase.stato === 'CONCLUSA' && 'bg-emerald-50 border-emerald-200',
        fase.stato === 'IN_CORSO' && 'bg-amber-50 border-amber-300 shadow-sm',
        fase.stato === 'PIANIFICATA' && 'bg-card border-border',
      )}
    >
      {/* Ordine bullet */}
      <span
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
          fase.stato === 'CONCLUSA' && 'bg-emerald-600 text-white',
          fase.stato === 'IN_CORSO' && 'bg-amber-500 text-white',
          fase.stato === 'PIANIFICATA' && 'bg-muted text-muted-foreground',
        )}
      >
        {fase.ordine}
      </span>

      {/* Nome fase */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold truncate', isInCorso && 'text-amber-900')}>
          {fase.nome}
        </p>
        {fase.ammessi != null && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Ammessi: <span className="font-medium">{fase.ammessi}</span>
          </p>
        )}
      </div>

      {/* Stato badge */}
      <Badge variant={statoVariant(fase.stato)} className={cn(isInCorso && 'animate-pulse')}>
        {statoLabel(fase.stato)}
      </Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton layout
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="w-8 h-8 rounded-lg" />
            </div>
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
      {/* Timeline */}
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — nessun concorso selezionato
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
        <Trophy className="w-7 h-7 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground">Nessun concorso selezionato</p>
        <p className="text-sm text-muted-foreground mt-1">
          Seleziona un concorso dal menu in alto per visualizzare la dashboard.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { activeId, activeConcorso } = useActiveConcorso();

  // -------------------------------------------------------------------
  // Parallel queries — disabled when no concorso selected
  // -------------------------------------------------------------------

  const results = useQueries({
    queries: [
      {
        queryKey: ['fasi', activeId],
        queryFn: () => http.get<Fase[]>('fasi', { concorsoId: activeId! }),
        enabled: Boolean(activeId),
        staleTime: 30_000,
      },
      {
        queryKey: ['candidati', activeId],
        queryFn: () => http.get<Candidato[]>('candidati', { concorsoId: activeId! }),
        enabled: Boolean(activeId),
        staleTime: 30_000,
      },
      {
        queryKey: ['commissari', activeId],
        queryFn: () => http.get<Commissario[]>('commissari', { concorsoId: activeId! }),
        enabled: Boolean(activeId),
        staleTime: 30_000,
      },
      {
        queryKey: ['valutazioni'],
        queryFn: () => http.get<Valutazione[]>('valutazioni'),
        enabled: Boolean(activeId),
        staleTime: 60_000,
      },
    ],
  });

  const [fasiQ, candidatiQ, commissariQ, valutazioniQ] = results;

  const isLoading = results.some((r) => r.isLoading);

  const fasi: Fase[] = fasiQ.data ?? [];
  const candidati: Candidato[] = candidatiQ.data ?? [];
  const commissari: Commissario[] = commissariQ.data ?? [];
  const valutazioni: Valutazione[] = valutazioniQ.data ?? [];

  // Fasi ordered by ordine
  const fasiSorted = [...fasi].sort((a, b) => a.ordine - b.ordine);
  const fasiInCorso = fasi.filter((f) => f.stato === 'IN_CORSO').length;
  const fasiConcluse = fasi.filter((f) => f.stato === 'CONCLUSA').length;

  // Valutazioni KPI — count only those whose candidatoFaseId belongs to a fase
  // of the active concorso. We derive this from fasi IDs (via candidati-fase
  // would require N+1 queries — for the KPI we approximate: show total fetched).
  // The valutazioni endpoint has no concorsoId filter; we show total as-is.
  const valutazioniCount = valutazioni.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* ---- Header: selector + title ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
            {t('admin.nav.dashboard')}
          </p>
          <h1 className="text-2xl font-bold text-foreground truncate">
            {activeConcorso ? activeConcorso.nome : 'Dashboard'}
          </h1>
          {activeConcorso?.anno && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Edizione {activeConcorso.anno}
            </p>
          )}
        </div>
        <ConcorsoSelector className="sm:mt-0.5 shrink-0" />
      </div>

      {/* ---- No concorso selected ---- */}
      {!activeId && <EmptyState />}

      {/* ---- Loading skeleton ---- */}
      {activeId && isLoading && <DashboardSkeleton />}

      {/* ---- Content ---- */}
      {activeId && !isLoading && (
        <div className="space-y-8">
          {/* ---- KPI strip ---- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={<Flag className="w-4 h-4" />}
              label="Fasi"
              value={`${fasiConcluse}/${fasi.length}`}
              accent={fasiInCorso > 0 ? 'amber' : 'emerald'}
            />
            <KpiCard
              icon={<Users className="w-4 h-4" />}
              label={t('admin.nav.candidati')}
              value={candidati.length}
              accent="brand"
            />
            <KpiCard
              icon={<Scale className="w-4 h-4" />}
              label={t('admin.nav.commissari')}
              value={commissari.length}
              accent="sky"
            />
            <KpiCard
              icon={<ListChecks className="w-4 h-4" />}
              label="Valutazioni"
              value={valutazioniCount}
              accent="slate"
            />
          </div>

          {/* ---- Phase timeline ---- */}
          {fasiSorted.length > 0 ? (
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3">
                Fasi del concorso
              </h2>

              {/* Connector line + chips */}
              <div className="relative">
                {fasiSorted.length > 1 && (
                  <div
                    aria-hidden
                    className="absolute left-[1.6rem] top-7 bottom-7 w-px bg-border z-0"
                  />
                )}
                <div className="relative z-10 flex flex-col gap-2">
                  {fasiSorted.map((fase) => (
                    <FaseChip key={fase.id} fase={fase} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nessuna fase configurata per questo concorso.
              </CardContent>
            </Card>
          )}

          {/* ---- Fasi summary table ---- */}
          {fasiSorted.length > 0 && (
            <FasiSummaryTable fasi={fasiSorted} activeId={activeId} />
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-fase stats table — fetches candidati-fase per each fase
// ---------------------------------------------------------------------------

function FasiSummaryTable({ fasi, activeId }: { fasi: Fase[]; activeId: string }) {
  // One query per fase to get candidati-fase
  const cfQueries = useQueries({
    queries: fasi.map((f) => ({
      queryKey: ['candidati-fase', f.id, activeId],
      queryFn: () => http.get<CandidatoFase[]>('candidati-fase', { faseId: f.id }),
      staleTime: 60_000,
    })),
  });

  const loading = cfQueries.some((q) => q.isLoading);

  const stats: (FaseStats & { ammessi: number; rate: string })[] = fasi.map((fase, i) => {
    const cfs: CandidatoFase[] = cfQueries[i]?.data ?? [];
    const ammessi = cfs.filter((cf) => cf.ammessoProssimaFase).length;
    const rate = cfs.length > 0 ? `${Math.round((ammessi / cfs.length) * 100)}%` : '—';
    return { fase, candidatiFase: cfs, ammessi, rate };
  });

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-3">Riepilogo fasi</h2>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {(['Fase', 'Candidati', 'Ammessi', '% ammessi'] as const).map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground first:text-left text-center"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: fasi.length }).map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {Array.from({ length: 4 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-12" />
                        </td>
                      ))}
                    </tr>
                  ))
                : stats.map(({ fase, candidatiFase, ammessi, rate }) => (
                    <tr
                      key={fase.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <span className="text-muted-foreground font-mono text-xs">
                            #{fase.ordine}
                          </span>
                          {fase.nome}
                          <Badge variant={statoVariant(fase.stato)} className="text-[10px] px-1.5 py-0">
                            {statoLabel(fase.stato)}
                          </Badge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-muted-foreground">
                        {candidatiFase.length}
                      </td>
                      <td className={cn('px-4 py-3 text-center font-mono font-medium', ammessi > 0 ? 'text-emerald-700' : 'text-muted-foreground')}>
                        {ammessi}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-muted-foreground">
                        {rate}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
