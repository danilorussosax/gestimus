/**
 * RisultatiTab — per-fase leaderboard con ranking (scoring + tiebreak),
 * toggle anonimato, esporta CSV, esporta protocollo PDF, verbale editor.
 * Prop: concorsoId (string)
 *
 * Layout/struttura replica FEDELE di js/views/admin/risultati.js (vanilla).
 * Differenze solo dove imposto dalla React/TSX API surface (hooks, JSX).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, FileText, Download } from 'lucide-react';
import { http } from '@/lib/api';
import type { Candidato, CandidatoFase, Valutazione, Concorso } from '@/types';
import type { FaseRecord } from '@/api/fasi';
import { mediaCandidato, getScala, fmtVoto } from '@/lib/scoring';
import { rankWithTieBreak, effectiveStrategy, type RankedRow } from '@/lib/tiebreak';
import { fetchValutazioniByFase } from '@/api/valutazioni';
import { getConcorso } from '@/api/concorsi';
import { listCriteri } from '@/api/criteri';
import { normalizeCandidato, candidatiApi } from '@/api/candidati';
import { criteriFromRecords } from '@/lib/scoring';
import { getPresidenteForFase } from '@/lib/presidenti';
import { commissariApi } from '@/api/commissari';
import { commissioniApi } from '@/api/commissioni';
import { sezioniApi } from '@/api/sezioni';
import type { CommissarioRecord } from '@/api/commissari';
import type { CommissioneRecord } from '@/api/commissioni';
import type { SezioneRecord } from '@/api/sezioni';
import { exportProtocolloPdf } from '@/lib/protocollo-pdf';
import { VerbaleBlock } from '@/components/admin/VerbaleBlock';

// ─── Local helpers ────────────────────────────────────────────────────────────

function displayName(cand: Candidato | undefined | null, anon: boolean): string {
  if (!cand) return '—';
  if (anon) return '';
  const parts = [cand.cognome, cand.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : cand.nome || '—';
}

/** Vanilla `faseScopeLabel`: returns ' · sez1 + sez2' or '' for global fasi. */
function faseScopeLabel(fase: FaseRecord, sezioni: SezioneRecord[]): string {
  const ids = Array.isArray(fase.sezioniIds) ? fase.sezioniIds : [];
  if (ids.length === 0) return '';
  const nomi = ids
    .map((id) => sezioni.find((s) => s.id === id)?.nome)
    .filter(Boolean) as string[];
  if (nomi.length === 0) return '';
  return ' · ' + nomi.join(' + ');
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
    queryFn: () =>
      http
        .get<Candidato[]>('candidati', { concorsoId, limit: 1000 })
        .then((rows) => rows.map(normalizeCandidato)),
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

function useConcorsoData(concorsoId: string) {
  return useQuery({
    queryKey: ['concorsi', concorsoId],
    queryFn: () => getConcorso(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
}

function useCommissariData(concorsoId: string) {
  return useQuery({
    queryKey: ['commissari', concorsoId],
    queryFn: () => commissariApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
}

function useCommissioniData(concorsoId: string) {
  return useQuery({
    queryKey: ['commissioni', concorsoId],
    queryFn: () => commissioniApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
}

function useSezioniData(concorsoId: string) {
  return useQuery({
    queryKey: ['sezioni', concorsoId],
    queryFn: () => sezioniApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
}

// ─── FaseLeaderboard ──────────────────────────────────────────────────────────

interface FaseLeaderboardProps {
  fase: FaseRecord;
  candidati: Candidato[];
  showEsito: boolean;
  anon: boolean;
  /** Concorso (per la cascata tiebreak ereditata quando la fase non ha override). */
  concorso: Concorso | null;
  /** Per gli step spareggio "voto del Presidente" ed "età" dei gruppi. */
  commissioni: CommissioneRecord[];
  commissari: CommissarioRecord[];
  membriMap: MembriMap;
}

function FaseLeaderboard({ fase, candidati, showEsito, anon, concorso, commissioni, commissari, membriMap }: FaseLeaderboardProps) {
  const { t } = useTranslation();
  const cfQuery = useCandidatiFase(fase.id);
  const cfIds = useMemo(
    () => (cfQuery.data ?? []).map((cf) => cf.id),
    [cfQuery.data],
  );
  const valQuery = useValutazioniForFase(cfIds.length > 0 ? cfIds : undefined);
  const criteriQ = useQuery({
    queryKey: ['criteri', fase.id],
    queryFn: () => listCriteri(fase.id),
    enabled: !!fase.id,
    staleTime: 60_000,
  });

  const scala = getScala(fase);

  const ranked: RankedRow[] = useMemo(() => {
    const cfs = cfQuery.data ?? [];
    const vals = (valQuery.data ?? []) as (Valutazione & { commissario_id: string; criterio: string; voto: number })[];
    if (cfs.length === 0) return [];
    const faseWithCriteri = { ...fase, criteri: criteriFromRecords(criteriQ.data) };
    const rows = cfs.map((cf) => {
      const cand = candidati.find((c) => c.id === cf.candidatoId);
      const vsRaw = vals.filter((v) => v.candidatoFaseId === cf.id);
      const vs = vsRaw.map((v) => ({
        commissario_id: v.commissarioId,
        criterio: v.criterio,
        voto: v.voto,
      }));
      return { cf, cand, media: mediaCandidato(vs, faseWithCriteri), valutazioni: vs };
    });
    return rankWithTieBreak(
      rows,
      faseWithCriteri,
      makeRankCtx(faseWithCriteri, concorso, commissioni, commissari, candidati, membriMap),
    );
  }, [cfQuery.data, valQuery.data, candidati, fase, concorso, criteriQ.data, commissioni, commissari, membriMap]);

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

  // Counters for tiebreak/ex-aequo sub-header badges (exact vanilla logic)
  const tiebreakCount = ranked.filter(
    (r) => Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1,
  ).length;
  const exAequoGroups = new Set(
    ranked.filter((r) => r.ex_aequo_group).map((r) => r.ex_aequo_group),
  );

  // Custom esito labels with fallback (vanilla: fase.testo_esito_promosso)
  const promossoLabel = ((fase.testoEsitoPromosso || '') || (t('admin.risultati.promosso') || 'PROMOSSO')).toUpperCase();
  const eliminatoLabel = ((fase.testoEsitoEliminato || '') || (t('admin.risultati.eliminato') || 'ELIMINATO')).toUpperCase();

  return (
    <>
      {/* Tiebreak / ex-aequo sub-header badges — same flex row as vanilla */}
      {(tiebreakCount > 0 || exAequoGroups.size > 0) && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {tiebreakCount > 0 && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200"
              title={t('admin.risultati.tiebreak_badge_title') ?? 'Spareggi applicati per risolvere parità di punteggio'}
            >
              {'⚖ '}{(t('admin.risultati.tiebreak_badge') ?? '{n} spareggi').replace('{n}', String(tiebreakCount))}
            </span>
          )}
          {exAequoGroups.size > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-200">
              {'🤝 '}{(t('admin.risultati.ex_aequo_badge') ?? '{n} ex aequo').replace('{n}', String(exAequoGroups.size))}
            </span>
          )}
        </div>
      )}

      {/* Leaderboard table — vanilla: min-w-full text-sm */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase tracking-wider">
            <tr>
              {/* vanilla col headers: Pos | Candidato | Media | [Esito] */}
              <th className="text-left py-2 pr-3">{t('admin.risultati.col_pos')}</th>
              <th className="text-left py-2 pr-3">{t('admin.risultati.col_cand')}</th>
              <th className="text-right py-2 pr-3">{t('admin.risultati.col_media')}</th>
              {showEsito && (
                <th className="text-center py-2 pr-3">{t('admin.risultati.col_esito')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ranked.map((r, i) => {
              const pos = r.posizione_finale ?? (i + 1);
              const isExAequo = !!r.ex_aequo_group;
              const hadTiebreak =
                Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1;
              const cand = r.cand as Candidato | undefined;
              const cf = r.cf as CandidatoFase;
              // Tooltip: bullet-list of tiebreak log steps (same as vanilla title attr)
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
                  {/* Pos — vanilla: "{pos}°? [ex aequo badge]" */}
                  <td className="py-2 pr-3 text-slate-500">
                    {pos}{isExAequo ? '°' : ''}{' '}
                    {isExAequo && (
                      <span className="text-[10px] text-violet-700 font-bold ml-1">
                        ex aequo
                      </span>
                    )}
                  </td>

                  {/* Candidato — vanilla: "#NNN · Nome (strumento) [⚖]"
                      In anon mode: "#NNN (strumento)" only (name hidden, strumento kept) */}
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-900">
                      #{String(cand?.numeroCandidato ?? '').padStart(3, '0')}
                    </span>
                    {' · '}
                    {!anon && displayName(cand, false)}
                    {cand?.strumento && (
                      <span className="text-slate-500 text-xs ml-1">
                        ({cand.strumento})
                      </span>
                    )}
                    {hadTiebreak && (
                      // Vanilla uses a <span> with title= for the tooltip, not a Lucide icon
                      <span
                        className="ml-1 text-[10px] font-bold text-amber-700"
                        title={tbTooltip}
                      >
                        ⚖
                      </span>
                    )}
                  </td>

                  {/* Media — vanilla: "{fmtVoto} /{scala}" */}
                  <td className="py-2 pr-3 text-right font-mono">
                    {fmtVoto(r.media, scala)}
                    <span className="text-[10px] text-slate-400 ml-0.5">/{scala}</span>
                  </td>

                  {/* Esito — vanilla:
                      NOT COMPLETATO → <span text-xs text-slate-500>—</span>
                      ammesso        → <span bg-emerald-100 text-emerald-800 rounded-full>PROMOSSO</span>
                      not ammesso    → <span text-xs text-slate-600>ELIMINATO</span> (plain text, no pill) */}
                  {showEsito && (
                    <td className="py-2 pr-3 text-center">
                      {cf.stato !== 'COMPLETATO' ? (
                        <span className="text-xs text-slate-500">—</span>
                      ) : cf.ammessoProssimaFase ? (
                        <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-medium">
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

      {/* Ex-aequo note — bg-violet-50 box (exact vanilla markup) */}
      {exAequoGroups.size > 0 && (
        <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-900">
          <strong>{t('admin.risultati.ex_aequo_note_title') ?? 'Nota ex aequo'}:</strong>{' '}
          {t('admin.risultati.ex_aequo_note_body') ?? 'Le posizioni indicate sono condivise tra i candidati ex aequo; la posizione immediatamente successiva non viene assegnata. I premi previsti dal regolamento per le posizioni interessate si sommano e dividono in parti uguali tra i vincitori.'}
        </div>
      )}

      {/* Tiebreak detail block — bg-amber-50 <details> (exact vanilla markup) */}
      {tiebreakCount > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900">
          <details>
            <summary className="cursor-pointer font-semibold">
              {t('admin.risultati.tiebreak_details_title') ?? 'Dettaglio spareggi applicati'}
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

// Mappa vuota stabile (ref costante): fallback finché la mappa reale è in caricamento.
const EMPTY_RANKED_MAP = new Map<string, RankedRow[]>();

type MembriMap = Map<string, unknown[]>;

// Ref stabile per il fallback (evita di ricreare la mappa a ogni render).
const EMPTY_MEMBRI_MAP: MembriMap = new Map();

/** Carica i membri di tutti i candidati-gruppo (per lo step spareggio "età"). */
async function fetchMembriMap(candidati: Candidato[]): Promise<MembriMap> {
  const groupIds = candidati
    .filter((c) => (c as { isGruppo?: boolean }).isGruppo)
    .map((c) => c.id);
  const entries = await Promise.all(
    groupIds.map(async (id) => [id, await candidatiApi.membri(id).catch(() => [])] as const),
  );
  return new Map(entries);
}

/**
 * Contesto completo per rankWithTieBreak: strategy ereditata + presidente +
 * tutti i candidati (età individuale) + membri (età gruppi). Senza questi, gli
 * step spareggio "voto del Presidente" ed "età" sarebbero inerti.
 */
function makeRankCtx(
  fase: FaseRecord,
  concorso: Concorso | null,
  commissioni: CommissioneRecord[],
  commissari: CommissarioRecord[],
  candidati: Candidato[],
  membriMap: MembriMap,
) {
  const presidente = getPresidenteForFase(
    fase as Parameters<typeof getPresidenteForFase>[0],
    commissioni as Parameters<typeof getPresidenteForFase>[1],
    commissari as Parameters<typeof getPresidenteForFase>[2],
  );
  return {
    strategy: effectiveStrategy(fase, concorso),
    presidenteId: presidente?.id ?? null,
    allCandidati: candidati,
    getMembri: (id: string) => membriMap.get(id) ?? [],
  };
}

/** Costruisce la classifica per ogni fase (usata da PDF e dal blocco Verbale). */
async function buildRankedByFase(
  fasi: FaseRecord[],
  candidati: Candidato[],
  concorso: Concorso | null,
  commissioni: CommissioneRecord[],
  commissari: CommissarioRecord[],
): Promise<Map<string, RankedRow[]>> {
  const membriMap = await fetchMembriMap(candidati);
  const map = new Map<string, RankedRow[]>();
  for (const fase of fasi) {
    const cfs = await http.get<CandidatoFase[]>('candidati-fase', { faseId: fase.id, limit: 500 });
    if (cfs.length === 0) continue;
    const vals = await fetchValutazioniByFase(cfs.map((c) => c.id));
    const criteriRecords = await listCriteri(fase.id);
    const faseWithCriteri = { ...fase, criteri: criteriFromRecords(criteriRecords) };
    const rows = cfs.map((cf) => {
      const cand = candidati.find((c) => c.id === cf.candidatoId);
      const vs = vals
        .filter((v) => v.candidatoFaseId === cf.id)
        .map((v) => ({ commissario_id: v.commissarioId, criterio: v.criterio, voto: v.voto }));
      return { cf, cand, media: mediaCandidato(vs, faseWithCriteri), valutazioni: vs };
    });
    map.set(
      fase.id,
      rankWithTieBreak(rows, faseWithCriteri, makeRankCtx(fase, concorso, commissioni, commissari, candidati, membriMap)),
    );
  }
  return map;
}

export function RisultatiTab({ concorsoId }: RisultatiTabProps) {
  const { t } = useTranslation();
  const [anon, setAnon] = useState(false);

  // ALL hooks unconditionally before any early return (rules-of-hooks)
  const fasiQuery = useFasi(concorsoId);
  const candidatiQuery = useCandidati(concorsoId);
  const concorsoQuery = useConcorsoData(concorsoId);
  const commissariQuery = useCommissariData(concorsoId);
  const commissioniQuery = useCommissioniData(concorsoId);
  const sezioniQuery = useSezioniData(concorsoId);

  // Membri dei candidati-gruppo (per lo step spareggio "età"), condivisi dai
  // FaseLeaderboard live.
  const membriMapQuery = useQuery({
    queryKey: ['membri-map', concorsoId],
    queryFn: () => fetchMembriMap(candidatiQuery.data ?? []),
    enabled: !!candidatiQuery.data,
    staleTime: 60_000,
  });
  const membriMap = membriMapQuery.data ?? (EMPTY_MEMBRI_MAP as MembriMap);

  // Classifica per-fase completa (con presidente + età) per il blocco Verbale:
  // i tag <podio>/<vincitore>/<risultati>/<spareggi> dipendono da questa mappa.
  const rankedMapQuery = useQuery({
    queryKey: ['ranked-by-fase', concorsoId, (fasiQuery.data ?? []).map((f) => f.id).join(',')],
    queryFn: () =>
      buildRankedByFase(
        fasiQuery.data ?? [],
        candidatiQuery.data ?? [],
        concorsoQuery.data ?? null,
        commissioniQuery.data ?? [],
        commissariQuery.data ?? [],
      ),
    enabled:
      !!fasiQuery.data && !!candidatiQuery.data && !!commissioniQuery.data && !!commissariQuery.data,
    staleTime: 30_000,
  });

  // groupSize: how many fasi share same sezioniIds signature (vanilla computeGroupSizes)
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

  // CSV export: all vanilla columns including Nazionalita + Eta
  const handleExportCsv = async () => {
    const fasi = fasiQuery.data ?? [];
    const candidati = candidatiQuery.data ?? [];
    const concorso = concorsoQuery.data ?? null;
    // Vanilla header: Fase,Posizione,Numero,Nome,Cognome,Strumento,Nazionalita,Eta,Media,Esito
    const lines = ['Fase,Posizione,Numero,Nome,Cognome,Strumento,Nazionalita,Eta,Media,Esito'];
    const rankedMap = await buildRankedByFase(
      fasi,
      candidati,
      concorso,
      commissioniQuery.data ?? [],
      commissariQuery.data ?? [],
    );
    for (const fase of fasi) {
      const ranked = rankedMap.get(fase.id);
      if (!ranked || ranked.length === 0) continue;
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
        // Eta: age from dataNascita (same as vanilla ageFromDate)
        const eta = (() => {
          const dn = cand?.dataNascita;
          if (!dn) return cand?.eta ?? '';
          const d = new Date(dn);
          if (isNaN(d.getTime())) return '';
          const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
          if (days < 0) return '';
          return String(Math.floor(days / 365.2425));
        })();
        lines.push(
          [
            csvEscape(fase.nome),
            r.posizione_finale ?? (i + 1),
            cand?.numeroCandidato ?? '',
            csvEscape(cand?.nome),
            csvEscape(cand?.cognome),
            csvEscape(cand?.strumento),
            csvEscape(cand?.nazionalita),
            eta,
            media,
            esito,
          ].join(','),
        );
      });
    }
    // BOM UTF-8 per Excel + nome file sanificato (vanilla logic)
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const safeName = ((concorsoQuery.data?.nome ?? '') || 'risultati')
      // eslint-disable-next-line no-control-regex -- sanitizzazione nome file CSV
      .replace(/[\\/\x00-\x1f]+/g, '_')
      .replaceAll(' ', '_') || 'risultati';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_risultati.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Protocollo PDF: fetch all cf + vals on demand and rank (stesso motore del Verbale)
  const handleExportPdf = async () => {
    const concorso = concorsoQuery.data;
    if (!concorso) return;
    const fasi = fasiQuery.data ?? [];
    const candidati = candidatiQuery.data ?? [];
    const rankedMap = await buildRankedByFase(
      fasi,
      candidati,
      concorso,
      commissioniQuery.data ?? [],
      commissariQuery.data ?? [],
    );
    await exportProtocolloPdf({
      concorso: {
        id: concorso.id,
        nome: concorso.nome,
        anno: concorso.anno,
        anonimo: concorso.anonimo,
        logoUrl: concorso.logoUrl,
      },
      fasi,
      candidati,
      rankedByFase: rankedMap,
      sezioni: sezioniQuery.data ?? [],
      commissioni: commissioniQuery.data ?? [],
      commissari: commissariQuery.data ?? [],
    });
  };

  // Loading skeleton (after all hooks)
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
  const commissari: CommissarioRecord[] = commissariQuery.data ?? [];
  const commissioni: CommissioneRecord[] = commissioniQuery.data ?? [];
  const sezioni: SezioneRecord[] = sezioniQuery.data ?? [];
  const concorso = concorsoQuery.data ?? null;


  return (
    <div className="space-y-6">
      {/* Per-fase leaderboard cards — one card per fase (vanilla: buildFaseSummary) */}
      {fasi.length === 0 && (
        <p className="text-sm text-slate-500 italic">Nessuna fase definita.</p>
      )}

      {fasi.map((fase) => {
        const showEsito = (groupSize.get(fase.id) ?? 1) > 1;
        const scope = faseScopeLabel(fase, sezioni);
        // Vanilla: first sezione icon prefix (iconaPerSezione) — we skip the emoji icon
        // since we don't have that helper, but preserve the full scope label rendering.

        return (
          <div
            key={fase.id}
            className="bg-white border border-slate-200 rounded-2xl p-5"
          >
            {/* Card header: title + tiebreak/ex-aequo/stato badges */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              {/* Title: "#ordine Nome · scope" — vanilla exact markup */}
              <h3 className="font-semibold text-slate-900">
                <span className="text-slate-400 font-mono mr-1">#{fase.ordine}</span>
                {fase.nome}
                {scope ? (
                  <span className="text-slate-500 font-normal">{scope}</span>
                ) : (
                  <span className="text-xs text-slate-400 italic ml-2">
                    {t('admin.risultati.fase_scope_all') ?? 'tutte le sezioni'}
                  </span>
                )}
              </h3>

              {/* Right-side badges cluster: stato (vanilla inline classes, not c-tag) */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    fase.stato === 'CONCLUSA'
                      ? 'bg-slate-200 text-slate-700'
                      : 'bg-brand-100 text-brand-800'
                  }`}
                >
                  {(fase.stato ?? 'PIANIFICATA').replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {/* Leaderboard body — FaseLeaderboard handles its own data fetching */}
            <FaseLeaderboard
              fase={fase}
              candidati={candidati}
              showEsito={showEsito}
              anon={anon}
              concorso={concorso}
              commissioni={commissioni}
              commissari={commissari}
              membriMap={membriMap}
            />
          </div>
        );
      })}

      {/* Verbale della commissione block — per-fase editor with tag placeholders */}
      {concorso && fasi.length > 0 && (
        <VerbaleBlock
          concorso={{
            id: concorso.id,
            nome: concorso.nome,
            anno: concorso.anno,
            anonimo: concorso.anonimo,
            logoUrl: concorso.logoUrl,
          }}
          fasi={fasi}
          candidati={candidati}
          rankedByFase={rankedMapQuery.data ?? EMPTY_RANKED_MAP}
          commissioni={commissioni}
          commissari={commissari}
          sezioni={sezioni}
        />
      )}

      {/* Footer toolbar: anonimato toggle + export PDF (brand) + export CSV (slate-900)
          Vanilla order: [export-pdf brand-500] [export slate-900] — anon toggle added in React */}
      <div className="flex justify-end gap-2 flex-wrap items-center">
        {/* Anonimato toggle — React addition (vanilla had this per concorso.anonimo flag) */}
        <button
          type="button"
          className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
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

        {/* Protocollo PDF — vanilla: brand-500 button */}
        <button
          type="button"
          className="text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 px-3.5 py-2 rounded-lg shadow-soft flex items-center gap-1.5"
          disabled={!concorso || fasi.length === 0}
          onClick={() => { void handleExportPdf(); }}
        >
          <FileText className="h-4 w-4" aria-hidden />
          {t('admin.risultati.export_pdf') ?? 'Esporta PDF'}
        </button>

        {/* CSV — vanilla: slate-900 button */}
        <button
          type="button"
          className="text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-2 rounded-lg flex items-center gap-1.5"
          onClick={() => { void handleExportCsv(); }}
        >
          <Download className="h-4 w-4" aria-hidden />
          {t('admin.risultati.export_csv') ?? 'Esporta CSV'}
        </button>
      </div>
    </div>
  );
}

export default RisultatiTab;
