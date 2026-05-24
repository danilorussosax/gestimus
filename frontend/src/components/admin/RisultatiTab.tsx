/**
 * RisultatiTab — per-fase leaderboard con ranking (scoring + tiebreak),
 * toggle anonimato, esporta CSV.
 * Prop: concorsoId (string)
 *
 * Layout/struttura replica esatta di js/views/admin/risultati.js (vanilla).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Eye, EyeOff, Scale, Users } from 'lucide-react';
import { http } from '@/lib/api';
import type { Candidato, CandidatoFase, Valutazione } from '@/types';
import type { FaseRecord } from '@/api/fasi';
import { mediaCandidato, getScala, fmtVoto } from '@/lib/scoring';
import { rankWithTieBreak, effectiveStrategy, type RankedRow } from '@/lib/tiebreak';
import { fetchValutazioniByFase } from '@/api/valutazioni';

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
    return (
      <p className="text-sm text-slate-500 italic">
        {t('admin.risultati.fase_not_started')}
      </p>
    );
  }

  const cfs = cfQuery.data ?? [];
  if (cfs.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
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
    <>
      {/* Tiebreak / ex-aequo badges — same flex row as vanilla */}
      {(tiebreakCount > 0 || exAequoGroups.size > 0) && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {tiebreakCount > 0 && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200"
              title={t('admin.risultati.tiebreak_badge_title') ?? 'Spareggi applicati per risolvere parità di punteggio'}
            >
              <Scale className="inline h-3 w-3 mr-0.5" aria-hidden />
              {t('admin.risultati.tiebreak_badge', { n: tiebreakCount })}
            </span>
          )}
          {exAequoGroups.size > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-200">
              <Users className="inline h-3 w-3 mr-0.5" aria-hidden />
              {t('admin.risultati.ex_aequo_badge', { n: exAequoGroups.size })}
            </span>
          )}
        </div>
      )}

      {/* Leaderboard table — c-table replaces ad-hoc min-w-full */}
      <div className="overflow-x-auto">
        <table className="c-table">
          <thead>
            <tr>
              <th className="text-left">{t('admin.risultati.col_pos')}</th>
              <th className="text-left">{t('admin.risultati.col_cand')}</th>
              <th className="text-right">{t('admin.risultati.col_media')}</th>
              {showEsito && (
                <th className="text-center">{t('admin.risultati.col_esito')}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const pos = r.posizione_finale ?? (i + 1);
              const isExAequo = !!r.ex_aequo_group;
              const hadTiebreak =
                Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1;
              const cand = r.cand as Candidato | undefined;
              const cf = r.cf as CandidatoFase;
              const tbTooltip = hadTiebreak
                ? r.tiebreak_log
                    .map((s) => `• ${s.motivazione ?? s.step}`)
                    .join('\n')
                : '';

              return (
                <tr
                  key={cf.id}
                  className={isExAequo ? 'bg-violet-50/40' : undefined}
                >
                  {/* Pos */}
                  <td className="text-slate-500">
                    {pos}{isExAequo ? '°' : ''}{' '}
                    {isExAequo && (
                      <span className="text-[10px] text-violet-700 font-bold ml-1">
                        ex aequo
                      </span>
                    )}
                  </td>

                  {/* Candidato */}
                  <td>
                    <span className="font-medium text-slate-900">
                      #{String(cand?.numeroCandidato ?? '').padStart(3, '0')}
                    </span>
                    {' · '}
                    {displayName(cand, anon)}
                    {!anon && cand?.strumento && (
                      <span className="text-slate-500 text-xs ml-1">
                        ({cand.strumento})
                      </span>
                    )}
                    {hadTiebreak && (
                      <span
                        className="ml-1 text-[10px] font-bold text-amber-700"
                        title={tbTooltip}
                      >
                        <Scale className="inline h-3 w-3" aria-hidden />
                      </span>
                    )}
                  </td>

                  {/* Media */}
                  <td className="text-right font-mono">
                    {fmtVoto(r.media, scala)}
                    <span className="text-[10px] text-slate-400 ml-0.5">
                      /{scala}
                    </span>
                  </td>

                  {/* Esito */}
                  {showEsito && (
                    <td className="text-center">
                      {cf.stato !== 'COMPLETATO' ? (
                        <span className="text-xs text-slate-500">—</span>
                      ) : cf.ammessoProssimaFase ? (
                        <span className="c-tag c-tag--green c-tag--no-dot">
                          {promossoLabel}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">{eliminatoLabel}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ex-aequo note — bg-violet-50 box, same as vanilla */}
      {exAequoGroups.size > 0 && (
        <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-900">
          <strong>{t('admin.risultati.ex_aequo_note_title')}:</strong>{' '}
          {t('admin.risultati.ex_aequo_note_body')}
        </div>
      )}

      {/* Tiebreak details — bg-amber-50 <details>, same as vanilla */}
      {tiebreakCount > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900">
          <details>
            <summary className="cursor-pointer font-semibold">
              {t('admin.risultati.tiebreak_details_title')}
            </summary>
            <ul className="mt-2 space-y-1.5">
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
        </div>
      )}
    </>
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
    // BOM UTF-8 per Excel + nome file sanificato
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
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 animate-pulse">
          <div className="h-5 bg-slate-100 rounded w-48 mb-3" />
          <div className="h-32 bg-slate-50 rounded" />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 animate-pulse">
          <div className="h-5 bg-slate-100 rounded w-48 mb-3" />
          <div className="h-32 bg-slate-50 rounded" />
        </div>
      </div>
    );
  }

  const fasi = fasiQuery.data ?? [];
  const candidati = candidatiQuery.data ?? [];

  return (
    <div className="space-y-6 view-fade">
      {/* Per-fase leaderboard cards */}
      {fasi.length === 0 && (
        <p className="text-sm text-slate-500 italic">Nessuna fase definita.</p>
      )}

      {fasi.map((fase) => {
        const showEsito = (groupSize.get(fase.id) ?? 1) > 1;

        return (
          <div
            key={fase.id}
            className="bg-white border border-slate-200 rounded-2xl p-5"
          >
            {/* Card header: title + stato badge */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-slate-900">
                <span className="text-slate-400 font-mono mr-1">#{fase.ordine}</span>
                {fase.nome}
                {fase.sezioniIds.length === 0 && (
                  <span className="text-xs text-slate-400 italic ml-2">
                    {t('admin.risultati.fase_scope_all') ?? 'tutte le sezioni'}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`c-tag c-tag--no-dot ${
                    fase.stato === 'CONCLUSA'
                      ? 'c-tag--gray'
                      : fase.stato === 'IN_CORSO'
                      ? 'c-tag--green'
                      : 'c-tag--blue'
                  }`}
                >
                  {fase.stato.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {/* Leaderboard body */}
            <FaseLeaderboard
              fase={fase}
              candidati={candidati}
              showEsito={showEsito}
              anon={anon}
            />
          </div>
        );
      })}

      {/* Footer toolbar: anonimato toggle + CSV export — same flex justify-end gap-2 as vanilla */}
      <div className="flex justify-end gap-2 flex-wrap items-center">
        <button
          type="button"
          className="c-btn c-btn--outline c-btn--sm"
          onClick={() => setAnon((v) => !v)}
          aria-pressed={anon}
        >
          {anon ? (
            <>
              <Eye className="h-4 w-4" aria-hidden />
              Mostra nomi
            </>
          ) : (
            <>
              <EyeOff className="h-4 w-4" aria-hidden />
              Modalità anonima
            </>
          )}
        </button>
        <button
          type="button"
          className="c-btn c-btn--primary c-btn--sm"
          onClick={() => { void handleExportCsv(); }}
        >
          <Download className="h-4 w-4" aria-hidden />
          {t('admin.risultati.export_csv')}
        </button>
      </div>
    </div>
  );
}

export default RisultatiTab;
