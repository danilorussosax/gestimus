/**
 * Statistiche — scoring analytics per concorso.
 * Seleziona un concorso → pick una fase → histogram distribuzione medie,
 * avg/median/stddev, top/bottom N candidati + riepilogo per fase.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Award } from 'lucide-react';
import { http } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Candidato, CandidatoFase, Valutazione } from '@/types';
import type { FaseRecord } from '@/api/fasi';

import {
  mediaCandidato,
  getScala,
  fmtVoto,
  computeAggregate,
} from '@/lib/scoring';
import { fetchValutazioniByFase } from '@/api/valutazioni';
import { rankWithTieBreak, effectiveStrategy } from '@/lib/tiebreak';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConcorsoRaw {
  id: string;
  nome: string;
  anno: number | null;
  stato: string | null;
  [k: string]: unknown;
}

interface CandidatoWithMedia {
  cf: CandidatoFase;
  cand: Candidato | undefined;
  media: number;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function buildHistogram(
  medias: number[],
  scala: number,
  buckets = 10,
): { label: string; count: number; from: number; to: number }[] {
  if (medias.length === 0) return [];
  const step = scala / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    label: `${(i * step).toFixed(1)}–${((i + 1) * step).toFixed(1)}`,
    from: i * step,
    to: (i + 1) * step,
    count: 0,
  }));
  for (const m of medias) {
    const idx = Math.min(Math.floor((m / scala) * buckets), buckets - 1);
    bins[idx].count++;
  }
  return bins;
}

function displayName(cand: Candidato | undefined): string {
  if (!cand) return '—';
  const parts = [cand.cognome, cand.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : cand.nome || '—';
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useConcorsi() {
  return useQuery({
    queryKey: ['concorsi'],
    queryFn: () => http.get<ConcorsoRaw[]>('concorsi', { limit: 500 }),
    staleTime: 60_000,
  });
}

function useFasi(concorsoId: string | undefined) {
  return useQuery({
    queryKey: ['fasi', concorsoId],
    queryFn: () => http.get<FaseRecord[]>('fasi', { concorsoId }),
    enabled: !!concorsoId,
    staleTime: 30_000,
  });
}

function useCandidatiFase(faseId: string | undefined) {
  return useQuery({
    queryKey: ['candidati-fase', faseId],
    queryFn: () => http.get<CandidatoFase[]>('candidati-fase', { faseId, limit: 500 }),
    enabled: !!faseId,
    staleTime: 30_000,
  });
}

function useCandidati(concorsoId: string | undefined) {
  return useQuery({
    queryKey: ['candidati', concorsoId],
    queryFn: () => http.get<Candidato[]>('candidati', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 30_000,
  });
}

function useValutazioniForCfs(cfIds: string[] | undefined) {
  return useQuery({
    queryKey: ['valutazioni', 'by-fase', ...(cfIds ?? [])],
    queryFn: () => fetchValutazioniByFase(cfIds!),
    enabled: Array.isArray(cfIds) && cfIds.length > 0,
    staleTime: 30_000,
  });
}

// ─── FaseStats ────────────────────────────────────────────────────────────────

interface FaseStatsProps {
  fase: FaseRecord;
  candidati: Candidato[];
}

function FaseStats({ fase, candidati }: FaseStatsProps) {
  const cfQuery = useCandidatiFase(fase.id);
  const cfIds = useMemo(() => (cfQuery.data ?? []).map((c) => c.id), [cfQuery.data]);
  const valQuery = useValutazioniForCfs(cfIds.length > 0 ? cfIds : undefined);
  const scala = getScala(fase);

  const data = useMemo((): CandidatoWithMedia[] => {
    const cfs = cfQuery.data ?? [];
    const vals = (valQuery.data ?? []) as Valutazione[];
    return cfs.map((cf) => {
      const cand = candidati.find((c) => c.id === cf.candidatoId);
      const vs = vals
        .filter((v) => v.candidatoFaseId === cf.id)
        .map((v) => ({
          commissario_id: v.commissarioId,
          criterio: v.criterio,
          voto: v.voto,
        }));
      return { cf, cand, media: mediaCandidato(vs, fase) };
    });
  }, [cfQuery.data, valQuery.data, candidati, fase]);

  const medias = useMemo(() => data.map((d) => d.media).filter((m) => m > 0), [data]);

  const stats = useMemo(() => {
    if (medias.length === 0) return null;
    const avg = computeAggregate(medias, 'aritmetica');
    const med = median(medias);
    const sd = stddev(medias);
    return { avg, med, sd };
  }, [medias]);

  const histogram = useMemo(() => buildHistogram(medias, scala), [medias, scala]);

  const ranked = useMemo(() => {
    if (data.length === 0) return [];
    const rows = data.map((d) => ({ ...d, valutazioni: [] }));
    return rankWithTieBreak(rows, fase, { strategy: effectiveStrategy(fase, null) });
  }, [data, fase]);

  const top3 = ranked.slice(0, 3);
  const bottom3 = [...ranked].reverse().slice(0, 3).reverse();

  if (cfQuery.isLoading || valQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Nessun candidato in questa fase.</p>;
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Media', value: fmtVoto(stats.avg, scala), sub: `/${scala}` },
            { label: 'Mediana', value: fmtVoto(stats.med, scala), sub: `/${scala}` },
            { label: 'Std dev', value: stats.sd.toFixed(2), sub: '' },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-lg border bg-muted/30 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                {kpi.label}
              </p>
              <p className="text-xl font-bold font-mono mt-0.5">
                {kpi.value}
                <span className="text-xs text-muted-foreground ml-0.5">{kpi.sub}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Histogram */}
      {histogram.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-mono uppercase tracking-wider">
            Distribuzione medie
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={histogram} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9 }}
                interval={1}
              />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
              <Tooltip
                formatter={(v) => [v, 'Candidati']}
                labelFormatter={(l) => `Range: ${l}`}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {histogram.map((entry, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={entry.count > 0 ? 'hsl(var(--primary))' : 'hsl(var(--muted))'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top / Bottom */}
      <div className="grid grid-cols-2 gap-3">
        {/* Top 3 */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1 flex items-center gap-1">
            <Award className="h-3 w-3 text-amber-500" /> Top 3
          </p>
          <ol className="space-y-1">
            {top3.map((r, i) => (
              <li key={(r.cf as CandidatoFase).id} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="font-mono text-muted-foreground w-4">{i + 1}.</span>
                  <span className="truncate">{displayName(r.cand as Candidato | undefined)}</span>
                </span>
                <span className="font-mono font-medium text-emerald-700">
                  {fmtVoto(r.media, scala)}
                </span>
              </li>
            ))}
          </ol>
        </div>
        {/* Bottom 3 */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-slate-400" /> Ultimi 3
          </p>
          <ol className="space-y-1">
            {bottom3.map((r, i) => (
              <li key={(r.cf as CandidatoFase).id} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="font-mono text-muted-foreground w-4">{ranked.length - bottom3.length + i + 1}.</span>
                  <span className="truncate">{displayName(r.cand as Candidato | undefined)}</span>
                </span>
                <span className="font-mono text-muted-foreground">
                  {fmtVoto(r.media, scala)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

// ─── Phase summary table ──────────────────────────────────────────────────────

interface PhaseSummaryProps {
  fasi: FaseRecord[];
  concorsoId: string;
}

function PhaseSummaryTable({ fasi, concorsoId }: PhaseSummaryProps) {
  const { t } = useTranslation();
  const valTotalQuery = useQuery({
    queryKey: ['valutazioni', 'by-concorso', concorsoId],
    queryFn: () => http.get<Valutazione[]>('valutazioni', { limit: 5000 }),
    staleTime: 30_000,
  });
  const cfAllQuery = useQuery({
    queryKey: ['candidati-fase', 'by-concorso', concorsoId],
    queryFn: () => http.get<CandidatoFase[]>('candidati-fase', { limit: 2000 }),
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const allCfs = cfAllQuery.data ?? [];
    const allVals = valTotalQuery.data ?? [];
    return fasi.map((f) => {
      const cfs = allCfs.filter((cf) => cf.faseId === f.id);
      const cfIdSet = new Set(cfs.map((cf) => cf.id));
      const vals = allVals.filter((v) => cfIdSet.has(v.candidatoFaseId));
      const ammessi = cfs.filter((cf) => cf.ammessoProssimaFase).length;
      return { nome: f.nome, totale: cfs.length, valutazioni: vals.length, ammessi };
    });
  }, [fasi, cfAllQuery.data, valTotalQuery.data]);

  if (cfAllQuery.isLoading || valTotalQuery.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {[
            t('stats.phases_col'),
            t('stats.candidates_col'),
            t('stats.evaluations_col'),
            t('stats.passed_col'),
            t('stats.rate_col'),
          ].map((h) => (
            <th
              key={h}
              className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground first:text-left text-center"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.nome}
            className="border-b border-border/50 hover:bg-muted/30 transition-colors"
          >
            <td className="px-3 py-2.5 font-medium text-foreground">{r.nome}</td>
            <td className="px-3 py-2.5 text-center font-mono text-muted-foreground">
              {r.totale}
            </td>
            <td className="px-3 py-2.5 text-center font-mono text-muted-foreground">
              {r.valutazioni}
            </td>
            <td className={`px-3 py-2.5 text-center font-mono ${r.ammessi > 0 ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}`}>
              {r.ammessi}
            </td>
            <td className="px-3 py-2.5 text-center font-mono text-muted-foreground">
              {r.totale > 0 ? `${((r.ammessi / r.totale) * 100).toFixed(0)}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminStatistiche() {
  const { t } = useTranslation();
  const concorsiQuery = useConcorsi();

  const [concorsoId, setConcorsoId] = useState<string>('');
  const [faseId, setFaseId] = useState<string>('');

  const fasiQuery = useFasi(concorsoId || undefined);
  const candidatiQuery = useCandidati(concorsoId || undefined);

  // Auto-select first concorso
  const concorsi = concorsiQuery.data ?? [];
  const activeConcorsoId = concorsoId || concorsi[0]?.id || '';

  const fasi = fasiQuery.data ?? [];
  const activeFaseId = faseId || fasi[0]?.id || '';
  const activeFase = fasi.find((f) => f.id === activeFaseId);

  const candidati = candidatiQuery.data ?? [];

  if (concorsiQuery.isLoading) {
    return (
      <section className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (concorsi.length === 0) {
    return (
      <section className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {t('stats.eyebrow')}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{t('stats.title')}</h1>
        </header>
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <h3 className="text-lg font-bold">{t('stats.empty')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('stats.empty_desc')}</p>
        </div>
      </section>
    );
  }

  const currentConcorso = concorsi.find((c) => c.id === activeConcorsoId) ?? concorsi[0];

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {t('stats.eyebrow')}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{t('stats.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('stats.subtitle')}</p>
        </div>

        {/* Concorso selector */}
        {concorsi.length > 1 && (
          <Select
            value={activeConcorsoId}
            onValueChange={(v) => { setConcorsoId(v); setFaseId(''); }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Seleziona concorso" />
            </SelectTrigger>
            <SelectContent>
              {concorsi.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} {c.anno ? `(${c.anno})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('stats.concorso')}: {currentConcorso.nome}
        {currentConcorso.anno ? ` (${currentConcorso.anno})` : ''}
      </p>

      {/* Fase distribution analytics */}
      {fasi.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Distribuzione punteggi per fase
              </CardTitle>
              <Select
                value={activeFaseId}
                onValueChange={setFaseId}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Seleziona fase" />
                </SelectTrigger>
                <SelectContent>
                  {fasi.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      #{f.ordine} {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {activeFase ? (
              <FaseStats fase={activeFase} candidati={candidati} />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Phase summary table */}
      {fasi.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('stats.phases')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 sm:p-0">
            <PhaseSummaryTable fasi={fasi} concorsoId={activeConcorsoId} />
          </CardContent>
        </Card>
      )}

      {/* Instruments + nationalities */}
      {candidati.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InstrumentsBar candidati={candidati} />
          <NationalitiesBar candidati={candidati} />
        </div>
      )}
    </section>
  );
}

// ─── Sub-charts ───────────────────────────────────────────────────────────────

function InstrumentsBar({ candidati }: { candidati: Candidato[] }) {
  const { t } = useTranslation();
  const data = useMemo(() => {
    const map: Record<string, number> = {};
    candidati.forEach((c) => { const k = c.strumento || 'Altro'; map[k] = (map[k] ?? 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
  }, [candidati]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('stats.instruments')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
            <Tooltip formatter={(v) => [v, 'Candidati']} />
            <Bar dataKey="value" fill="hsl(var(--primary))" fillOpacity={0.85} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function NationalitiesBar({ candidati }: { candidati: Candidato[] }) {
  const { t } = useTranslation();
  const data = useMemo(() => {
    const map: Record<string, number> = {};
    candidati.forEach((c) => { const k = c.nazionalita || '—'; map[k] = (map[k] ?? 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
  }, [candidati]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('stats.nationalities')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
            <Tooltip formatter={(v) => [v, 'Candidati']} />
            <Bar dataKey="value" fill="hsl(var(--chart-2, var(--primary)))" fillOpacity={0.8} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
