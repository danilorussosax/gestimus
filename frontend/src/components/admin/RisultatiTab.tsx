/**
 * RisultatiTab — per-fase leaderboard con ranking (scoring + tiebreak),
 * toggle anonimato, esporta CSV.
 * Prop: concorsoId (string)
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Eye, EyeOff, Scale, Users } from 'lucide-react';
import { http } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Candidato, CandidatoFase, Valutazione } from '@/types';
import type { FaseRecord } from '@/api/fasi';
import { mediaCandidato, getScala, fmtVoto } from '@/lib/scoring';
import { rankWithTieBreak, effectiveStrategy, type RankedRow } from '@/lib/tiebreak';
import {
  fetchValutazioniByFase,
} from '@/api/valutazioni';

// ─── Local helpers ────────────────────────────────────────────────────────────

function displayName(cand: Candidato | undefined | null, anon: boolean): string {
  if (!cand) return '—';
  if (anon) return `#${String(cand.numeroCandidato ?? '').padStart(3, '0')}`;
  const parts = [cand.cognome, cand.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : cand.nome || '—';
}

function csvEscape(v: unknown): string {
  let s = String(v ?? '');
  if (s.length && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useFasi(concorsoId: string) {
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

function useCandidati(concorsoId: string) {
  return useQuery({
    queryKey: ['candidati', concorsoId],
    queryFn: () => http.get<Candidato[]>('candidati', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 30_000,
  });
}

function useValutazioniForFase(cfIds: string[] | undefined) {
  return useQuery({
    queryKey: ['valutazioni', 'by-fase', ...(cfIds ?? [])],
    queryFn: () => fetchValutazioniByFase(cfIds!),
    enabled: Array.isArray(cfIds) && cfIds.length > 0,
    staleTime: 30_000,
  });
}

// ─── FaseLeaderboard ──────────────────────────────────────────────────────────

interface FaseLeaderboardProps {
  fase: FaseRecord;
  candidati: Candidato[];
  showEsito: boolean;
  anon: boolean;
}

function FaseLeaderboard({ fase, candidati, showEsito, anon }: FaseLeaderboardProps) {
  const { t } = useTranslation();
  const cfQuery = useCandidatiFase(fase.id);
  const cfIds = useMemo(
    () => (cfQuery.data ?? []).map((cf) => cf.id),
    [cfQuery.data],
  );
  const valQuery = useValutazioniForFase(cfIds.length > 0 ? cfIds : undefined);

  const scala = getScala(fase);

  const ranked: RankedRow[] = useMemo(() => {
    const cfs = cfQuery.data ?? [];
    const vals = (valQuery.data ?? []) as (Valutazione & { commissario_id: string; criterio: string; voto: number })[];
    if (cfs.length === 0) return [];
    const rows = cfs.map((cf) => {
      const cand = candidati.find((c) => c.id === cf.candidatoId);
      const vsRaw = vals.filter((v) => v.candidatoFaseId === cf.id);
      // Normalise field names: server returns camelCase, scoring.ts expects snake_case commissario_id/criterio/voto
      const vs = vsRaw.map((v) => ({
        commissario_id: v.commissarioId,
        criterio: v.criterio,
        voto: v.voto,
      }));
      return { cf, cand, media: mediaCandidato(vs, fase), valutazioni: vs };
    });
    return rankWithTieBreak(rows, fase, {
      strategy: effectiveStrategy(fase, null),
    });
  }, [cfQuery.data, valQuery.data, candidati, fase]);

  if (cfQuery.isLoading || valQuery.isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  const cfs = cfQuery.data ?? [];
  if (cfs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        {t('admin.risultati.fase_not_started')}
      </p>
    );
  }

  const tiebreakCount = ranked.filter(
    (r) => Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1,
  ).length;
  const exAequoGroups = new Set(
    ranked.filter((r) => r.ex_aequo_group).map((r) => r.ex_aequo_group),
  );

  const promossoLabel = (fase.testoEsitoPromosso ?? t('admin.risultati.promosso')).toUpperCase();
  const eliminatoLabel = (fase.testoEsitoEliminato ?? t('admin.risultati.eliminato')).toUpperCase();

  return (
    <div className="space-y-2">
      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-2">
        {tiebreakCount > 0 && (
          <Badge variant="warning" className="text-[10px] uppercase tracking-wider">
            <Scale className="mr-1 h-3 w-3" />
            {t('admin.risultati.tiebreak_badge', { n: tiebreakCount })}
          </Badge>
        )}
        {exAequoGroups.size > 0 && (
          <Badge className="text-[10px] uppercase tracking-wider bg-violet-100 text-violet-800 border-violet-200">
            <Users className="mr-1 h-3 w-3" />
            {t('admin.risultati.ex_aequo_badge', { n: exAequoGroups.size })}
          </Badge>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase tracking-wider">
            <tr>
              <th className="text-left py-2 pr-3">{t('admin.risultati.col_pos')}</th>
              <th className="text-left py-2 pr-3">{t('admin.risultati.col_cand')}</th>
              <th className="text-right py-2 pr-3">{t('admin.risultati.col_media')}</th>
              {showEsito && (
                <th className="text-center py-2 pr-3">{t('admin.risultati.col_esito')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ranked.map((r, i) => {
              const pos = r.posizione_finale ?? (i + 1);
              const isExAequo = !!r.ex_aequo_group;
              const hadTiebreak =
                Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1;
              const cand = r.cand as Candidato | undefined;
              const cf = r.cf as CandidatoFase;

              return (
                <tr
                  key={cf.id}
                  className={cn('transition-colors', isExAequo && 'bg-violet-50/40')}
                >
                  <td className="py-2 pr-3 text-muted-foreground font-mono text-xs">
                    {pos}
                    {isExAequo && (
                      <span className="ml-1 text-[10px] text-violet-700 font-bold">
                        ex aequo
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-foreground">
                      #{String(cand?.numeroCandidato ?? '').padStart(3, '0')}
                    </span>
                    {' · '}
                    {displayName(cand, anon)}
                    {!anon && cand?.strumento && (
                      <span className="text-muted-foreground text-xs ml-1">
                        ({cand.strumento})
                      </span>
                    )}
                    {hadTiebreak && (
                      <Scale className="inline ml-1 h-3 w-3 text-amber-600" aria-hidden />
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {fmtVoto(r.media, scala)}
                    <span className="text-[10px] text-muted-foreground ml-0.5">
                      /{scala}
                    </span>
                  </td>
                  {showEsito && (
                    <td className="py-2 pr-3 text-center">
                      {cf.stato !== 'COMPLETATO' ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : cf.ammessoProssimaFase ? (
                        <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-medium">
                          {promossoLabel}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{eliminatoLabel}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ex aequo note */}
      {exAequoGroups.size > 0 && (
        <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-900">
          <strong>{t('admin.risultati.ex_aequo_note_title')}:</strong>{' '}
          {t('admin.risultati.ex_aequo_note_body')}
        </div>
      )}

      {/* Tiebreak details */}
      {tiebreakCount > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {t('admin.risultati.tiebreak_details_title')}
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {ranked
              .filter((r) => Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1)
              .map((r) => {
                const cand = r.cand as Candidato | undefined;
                return (
                  <li key={(r.cf as CandidatoFase).id}>
                    <span className="font-semibold">
                      #{String(cand?.numeroCandidato ?? '').padStart(3, '0')}{' '}
                      {displayName(cand, false)}
                    </span>
                    {' → '}
                    {r.tiebreak_log
                      .map((s) => s.motivazione ?? s.step)
                      .join(' → ')}
                  </li>
                );
              })}
          </ul>
        </details>
      )}
    </div>
  );
}

// ─── RisultatiTab (main export) ───────────────────────────────────────────────

interface RisultatiTabProps {
  concorsoId: string;
}

export function RisultatiTab({ concorsoId }: RisultatiTabProps) {
  const { t } = useTranslation();
  const [anon, setAnon] = useState(false);

  const fasiQuery = useFasi(concorsoId);
  const candidatiQuery = useCandidati(concorsoId);

  // Compute groupSize: how many fasi share the same sezioniIds signature.
  const groupSize = useMemo(() => {
    const fasi = fasiQuery.data ?? [];
    const counts = new Map<string, number>();
    const signatures = new Map<string, string>();
    for (const f of fasi) {
      const ids = Array.isArray(f.sezioniIds) ? [...f.sezioniIds].sort() : [];
      const sig = ids.length === 0 ? '__shared__' : ids.join(',');
      signatures.set(f.id, sig);
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
    const result = new Map<string, number>();
    for (const f of fasi) result.set(f.id, counts.get(signatures.get(f.id)!) ?? 1);
    return result;
  }, [fasiQuery.data]);

  // CSV export: needs all candidatiFase + valutazioni per fase, fetched on demand.
  const handleExportCsv = async () => {
    const fasi = fasiQuery.data ?? [];
    const candidati = candidatiQuery.data ?? [];
    const lines = ['Fase,Posizione,Numero,Nome,Cognome,Strumento,Media,Esito'];
    for (const fase of fasi) {
      const cfs = await http.get<CandidatoFase[]>('candidati-fase', { faseId: fase.id, limit: 500 });
      if (cfs.length === 0) continue;
      const vals = await fetchValutazioniByFase(cfs.map((c) => c.id));
      const scala = getScala(fase);
      const rows = cfs.map((cf) => {
        const cand = candidati.find((c) => c.id === cf.candidatoId);
        const vs = vals
          .filter((v) => v.candidatoFaseId === cf.id)
          .map((v) => ({
            commissario_id: v.commissarioId,
            criterio: v.criterio,
            voto: v.voto,
          }));
        return { cf, cand, media: mediaCandidato(vs, fase), valutazioni: vs };
      });
      const ranked = rankWithTieBreak(rows, fase, { strategy: effectiveStrategy(fase, null) });
      ranked.forEach((r, i) => {
        const cand = r.cand as Candidato | undefined;
        const cf = r.cf as CandidatoFase;
        const esito =
          cf.stato !== 'COMPLETATO'
            ? 'in attesa'
            : cf.ammessoProssimaFase
            ? 'PROMOSSO'
            : 'ELIMINATO';
        const media = Number.isFinite(r.media) ? r.media.toFixed(2) : '0.00';
        void scala; // used in fmtVoto above
        lines.push(
          [
            csvEscape(fase.nome),
            r.posizione_finale ?? (i + 1),
            cand?.numeroCandidato ?? '',
            csvEscape(cand?.nome),
            csvEscape(cand?.cognome),
            csvEscape(cand?.strumento),
            media,
            esito,
          ].join(','),
        );
      });
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const safeName = 'risultati';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (fasiQuery.isLoading || candidatiQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const fasi = fasiQuery.data ?? [];
  const candidati = candidatiQuery.data ?? [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnon((v) => !v)}
          aria-pressed={anon}
        >
          {anon ? (
            <>
              <Eye className="h-4 w-4" />
              Mostra nomi
            </>
          ) : (
            <>
              <EyeOff className="h-4 w-4" />
              Modalità anonima
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportCsv}>
          <Download className="h-4 w-4" />
          {t('admin.risultati.export_csv')}
        </Button>
      </div>

      {/* Per-fase cards */}
      {fasi.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Nessuna fase definita.</p>
      )}
      {fasi.map((fase) => {
        const showEsito = (groupSize.get(fase.id) ?? 1) > 1;
        return (
          <Card key={fase.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">
                  <span className="text-muted-foreground font-mono mr-1.5">#{fase.ordine}</span>
                  {fase.nome}
                </CardTitle>
                <Badge
                  variant={fase.stato === 'CONCLUSA' ? 'muted' : fase.stato === 'IN_CORSO' ? 'success' : 'secondary'}
                >
                  {fase.stato.replace(/_/g, ' ')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <FaseLeaderboard
                fase={fase}
                candidati={candidati}
                showEsito={showEsito}
                anon={anon}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default RisultatiTab;
