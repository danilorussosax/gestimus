/**
 * pages/Commissario.tsx
 *
 * Judging interface for commissario accounts.
 *
 * States (matching vanilla commissario.js):
 *  • loading / error early returns
 *  • no active fase → NoActiveFase (+ optional PresidentePanel)
 *  • commissario not assigned to the active fase → NotAssigned
 *  • sincrona mode, candidate already voted but others haven't → Waiting
 *  • all candidates voted → AllDone (+ optional PresidentePanel)
 *  • main scoring sheet → ScoringSheet (+ optional PresidentePanel)
 *
 * Files created alongside this one:
 *   frontend/src/api/fase-runtime.ts  — REST + SSE helpers
 *   frontend/src/hooks/useFaseRuntime.ts — SSE + countdown hook
 *
 * Imported at integration:
 *   @/lib/scoring  — pesato, getScala, fmtVoto, getCriteri, getModoValutazione, voteStep
 *   @/api/valutazioni — saveValutazione(...)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { getPresidenteForFase, type CommissioneLike } from '@/lib/presidenti';

import type {
  Fase,
  Commissario,
  Commissione,
  CandidatoFase,
  Candidato,
  Valutazione,
  Concorso,
} from '@/types';
import {
  persistDraft,
  loadDraft,
  clearDraft,
  getCommissariIds,
  displayName,
  ageFromDate,
  formatTime,
  resolveSyncCurrentCf,
  isAmmesso,
  type DraftState,
} from './commissario-utils';

import {
  startFase,
  concludiFase,
  startFaseTimer,
  pauseFaseTimer,
  resumeFaseTimer,
  addFaseTimerBonus,
  resetFaseTimer,
} from '@/api/fase-runtime';
import { useFaseRuntime } from '@/hooks/useFaseRuntime';
import type { FaseRecord } from '@/api/fasi';
import { resolveAdmittedIds } from '@/lib/admitted';
import { useCommissarioData } from '@/hooks/useCommissarioData';
import { KpiCard } from '@/components/commissario/KpiCard';
import { PreflightItem } from '@/components/commissario/PreflightItem';
import { HistoryCard } from '@/components/commissario/HistoryCard';
import { CountdownConfirm } from '@/components/commissario/CountdownConfirm';
import { WaitingPanel } from '@/components/commissario/WaitingPanel';
import { AllDonePanel } from '@/components/commissario/AllDonePanel';

// ── Scoring helpers (modulo @/lib/scoring) ──────────────────────────────────
// Adapter tipato direttamente dal modulo reale via `typeof import(...)`: niente
// interfaccia parallela con `any` da tenere allineata a mano (le firme restano
// la fonte di verità in @/lib/scoring). L'import resta dinamico così il modulo
// di scoring (e le sue dipendenze pesanti) non entra nel bundle iniziale.
type ScoringModule = typeof import('@/lib/scoring');
// Lazy-imported once below
let _scoring: ScoringModule | null = null;
async function getScoring(): Promise<ScoringModule> {
  if (!_scoring) {
    _scoring = await import('@/lib/scoring');
  }
  return _scoring;
}

type SaveValutacionFn = (args: {
  candidatoFaseId: string;
  commissarioId: string;
  voti: Record<string, number>;
  note?: string;
}) => Promise<unknown>;

let _saveValutazione: SaveValutacionFn | null = null;
async function getSaveValutazione(): Promise<SaveValutacionFn> {
  if (!_saveValutazione) {
    const mod = await import('@/api/valutazioni') as { saveValutazione: SaveValutacionFn };
    _saveValutazione = mod.saveValutazione;
  }
  return _saveValutazione;
}

// ── Helper puri (persistDraft/loadDraft/getCommissariIds/displayName/ageFromDate/
//    formatTime) estratti in ./commissario-utils ──────────────────────────────

// ── Beep (timer expired) ──────────────────────────────────────────────────────

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => { ctx.close().catch(() => { /* noop */ }); };
  } catch { /* silent fallback */ }
}

// ── FloatingTimer component ───────────────────────────────────────────────────

interface FloatingTimerProps {
  faseId: string;
  isPresidente: boolean;
  candidatoFaseId?: string | null;
}

function FloatingTimer({ faseId, isPresidente, candidatoFaseId }: FloatingTimerProps) {
  const { t } = useTranslation();
  const { timer, refetch } = useFaseRuntime(faseId);
  const beepedRef = useRef<string | null>(null);
  const qc = useQueryClient();

  // Presidente auto-start: when the current cf changes, start the timer.
  useEffect(() => {
    if (!isPresidente || !candidatoFaseId) return;
    void startFaseTimer(faseId, candidatoFaseId).then(() => refetch()).catch(() => { /* noop */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faseId, candidatoFaseId, isPresidente]);

  // Beep once when expired.
  useEffect(() => {
    if (!timer.expired || !timer.hasState) return;
    const key = `${faseId}:expired`;
    if (beepedRef.current === key) return;
    beepedRef.current = key;
    beep();
  }, [timer.expired, timer.hasState, faseId]);

  if (!timer.hasState || timer.durationMs === 0) return null;

  const borderCls = timer.expired
    ? 'border-rose-400 animate-pulse'
    : timer.paused
    ? 'border-amber-300'
    : 'border-emerald-400';

  const numCls = timer.expired
    ? 'text-rose-600'
    : timer.remainingMs < 30_000
    ? 'text-rose-600'
    : timer.remainingMs < 60_000
    ? 'text-amber-600'
    : 'text-emerald-600';

  const statusIcon = timer.expired ? '🚨' : timer.paused ? '⏸️' : '⏱';
  const statusLabel = timer.expired
    ? t('com.timer.expired_status')
    : timer.paused
    ? t('com.timer.paused_status')
    : t('com.timer.running_status');

  async function handleTimerAction(action: 'pause' | 'resume' | 'bonus' | 'reset') {
    try {
      if (action === 'pause') await pauseFaseTimer(faseId);
      else if (action === 'resume') await resumeFaseTimer(faseId);
      else if (action === 'bonus') await addFaseTimerBonus(faseId, 60);
      else if (action === 'reset') await resetFaseTimer(faseId);
      refetch();
      void qc.invalidateQueries({ queryKey: ['fase-runtime', faseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('com.timer.error'));
    }
  }

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-40 bg-white/95 backdrop-blur-md border-2 rounded-2xl px-4 py-3 shadow-pop flex items-center gap-3 transition-all',
        borderCls,
      )}
      role="timer"
      aria-label={t('com.timer.aria_label')}
    >
      <div className="text-3xl leading-none" aria-hidden="true">{statusIcon}</div>
      <div className="min-w-[88px]">
        <div className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">
          {statusLabel}
        </div>
        <div className={cn('text-3xl font-black tabular-nums leading-none mt-0.5', numCls)}>
          {formatTime(timer.remainingMs)}
        </div>
      </div>
      {isPresidente && (
        <div className="flex flex-col gap-1">
          {timer.paused ? (
            <button
              className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-lg shadow-sm"
              onClick={() => handleTimerAction('resume')}
            >
              {t('com.timer.resume')}
            </button>
          ) : (
            <button
              className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-2.5 py-1 rounded-lg shadow-sm"
              onClick={() => handleTimerAction('pause')}
            >
              {t('com.timer.pause')}
            </button>
          )}
          <button
            className="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-lg"
            title={t('com.timer.bonus_title')}
            onClick={() => handleTimerAction('bonus')}
          >
            {t('com.timer.bonus')}
          </button>
          <button
            className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg"
            onClick={() => handleTimerAction('reset')}
          >
            {t('com.timer.reset')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── PresidentePanel component ─────────────────────────────────────────────────

interface PresidentePanelProps {
  concorso: Concorso;
  fasi: Fase[];
  commissioni: Commissione[];
  candidatiFase: CandidatoFase[];
  valutazioni: Valutazione[];
  onFaseChanged: () => void;
}

function PresidentePanel({
  concorso,
  fasi,
  commissioni,
  candidatiFase,
  valutazioni,
  onFaseChanged,
}: PresidentePanelProps) {
  const { t } = useTranslation();
  const [confirmEndFaseId, setConfirmEndFaseId] = useState<string | null>(null);
  const [endChecked, setEndChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  // KPI totals
  let totCand = 0;
  let totValutati = 0;
  for (const f of fasi) {
    const cfs = candidatiFase.filter((cf) => cf.faseId === f.id);
    // commissari IDs for this fase
    const commissione = commissioni.find((c) => c.id === f.commissioneId);
    const commIds = getCommissariIds(commissione);
    totCand += cfs.length;
    totValutati += cfs.filter((cf) =>
      commIds.every((cid) => valutazioni.some((v) => v.candidatoFaseId === cf.id && v.commissarioId === cid)),
    ).length;
  }
  const pctComplete = totCand > 0 ? Math.round((totValutati / totCand) * 100) : 0;

  async function handleStart(faseId: string) {
    setSaving(true);
    try {
      await startFase(faseId);
      toast.success(t('com.pres.phase_started'));
      onFaseChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('com.save.error', { msg: '?' }));
    } finally {
      setSaving(false);
    }
  }

  async function handleEnd(faseId: string) {
    if (!endChecked) {
      toast.warning(t('com.pres.end_checkbox_required'));
      return;
    }
    setSaving(true);
    try {
      // N144: calcola gli ammessi top-N (con risoluzione pareggi) e inviali al
      // server, altrimenti nessun candidato verrebbe promosso alla fase dopo.
      const faseRec = fasi.find((f) => f.id === faseId);
      const admitted = faseRec
        ? await resolveAdmittedIds(faseRec as unknown as FaseRecord, concorso)
        : null;
      await concludiFase(faseId, admitted ?? undefined);
      toast.success(t('com.pres.phase_ended'));
      setConfirmEndFaseId(null);
      setEndChecked(false);
      onFaseChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('com.save.error', { msg: '?' }));
    } finally {
      setSaving(false);
    }
  }

  function FasePresCard({ fase }: { fase: Fase }) {
    const isPlanned = fase.stato === 'PIANIFICATA';
    const isRunning = fase.stato === 'IN_CORSO';
    const isDone = fase.stato === 'CONCLUSA';

    const palette = isRunning
      ? { tag: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: t('com.pres.state_in_corso') }
      : isDone
      ? { tag: 'bg-slate-200 text-slate-700 border-slate-300', label: t('com.pres.state_conclusa') }
      : { tag: 'bg-amber-100 text-amber-800 border-amber-200', label: t('com.pres.state_pianificata') };

    const commissione = commissioni.find((c) => c.id === fase.commissioneId);
    const commIds = getCommissariIds(commissione);
    const cfs = candidatiFase.filter((cf) => cf.faseId === fase.id);

    const fullyVoted = cfs.filter((cf) =>
      commIds.every((cid) => valutazioni.some((v) => v.candidatoFaseId === cf.id && v.commissarioId === cid)),
    ).length;
    const partial = cfs.filter((cf) =>
      valutazioni.some((v) => v.candidatoFaseId === cf.id),
    ).length - fullyVoted;
    const passed = cfs.filter((cf) => cf.ammessoProssimaFase).length;
    const total = cfs.length;
    const pct = total ? Math.round((fullyVoted / total) * 100) : 0;

    const commDone = total === 0
      ? 0
      : commIds.filter((cid) =>
          cfs.every((cf) => valutazioni.some((v) => v.candidatoFaseId === cf.id && v.commissarioId === cid)),
        ).length;
    const allComm = commIds.length > 0 && commDone === commIds.length;
    const commPct = commIds.length ? Math.round((commDone / commIds.length) * 100) : 0;

    const missing = total - fullyVoted;

    // Pre-flight for PIANIFICATA
    const numCriteri = Array.isArray(fase.criteri) && fase.criteri.length > 0
      ? fase.criteri.length
      : (fase as unknown as { pesi?: Record<string, number> }).pesi
        ? Object.keys((fase as unknown as { pesi: Record<string, number> }).pesi).length
        : 4;
    const canStart = numCriteri > 0 && commIds.length > 0 && total > 0;

    const faseLabel = `${t('com.pres.phase_label', { ordine: fase.ordine })} · ${fase.nome}`;

    const isConfirmingEnd = confirmEndFaseId === fase.id;

    // Resolve sezione title (like vanilla titleSezione)
    const titleSezione = fase.nome;
    // Commissione as subtitle
    const subtitleCategoria = commissione?.nome ?? t('com.pres.scope_all', { defaultValue: 'Tutte le categorie' });

    const modo = (fase as unknown as { modoValutazione?: string }).modoValutazione ?? 'autonoma';
    const tempo = Number((fase as unknown as { tempoMinuti?: number }).tempoMinuti) || 0;
    const passedPct = total ? Math.round((passed / total) * 100) : 0;

    return (
      <article className="bg-white rounded-2xl border border-slate-200 shadow-soft p-5 sm:p-6 flex flex-col hover:shadow-md transition">
        {/* Header matching vanilla: Sezione eyebrow, titleSezione h4, categoria subtitle */}
        <header className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-ink-500 font-medium">Sezione</p>
            <h4 className="font-bold text-ink-900 text-xl sm:text-2xl leading-tight mt-0.5 truncate">
              {titleSezione}
            </h4>
            <p className="text-sm text-ink-700 mt-1 truncate" title={subtitleCategoria}>
              {subtitleCategoria}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border',
              palette.tag,
            )}
          >
            {palette.label}
          </span>
        </header>

        {/* Fase + commissione tag row */}
        <div className="mt-4 flex items-center gap-2 text-xs text-ink-700 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-brand-50 border border-brand-100 text-brand-700 font-medium">
            🏁 <span>{faseLabel}</span>
          </span>
          {commissione && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-ink-700">
              ⚖ <span className="truncate max-w-[14rem]">{commissione.nome}</span>
            </span>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
          <div className="flex items-center gap-2 text-ink-700 min-w-0">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold leading-none">Tempo</div>
              <div className="truncate font-medium">
                {tempo > 0 ? t('com.pres.tempo_value', { min: tempo, defaultValue: `${tempo} min` }) : t('com.pres.tempo_off', { defaultValue: 'Libero' })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-ink-700 min-w-0">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold leading-none">Valutazione</div>
              <div className="truncate font-medium">
                {modo === 'sincrona' ? t('com.pres.modo_sync', { defaultValue: 'Sincrona' }) : t('com.pres.modo_async', { defaultValue: 'Autonoma' })} · {t('com.pres.scala', { scala: fase.scala })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-ink-700 min-w-0">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold leading-none">Criteri</div>
              <div className="truncate font-medium">{t('com.pres.criteri_count', { n: numCriteri })}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-ink-700 min-w-0">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold leading-none">Scala</div>
              <div className="truncate font-medium">{t('com.pres.scala', { scala: fase.scala })}</div>
            </div>
          </div>
        </dl>

        {/* PIANIFICATA — preflight */}
        {isPlanned && (
          <div className="mt-5 pt-5 border-t border-slate-200">
            <div className="flex items-baseline justify-between mb-3">
              <h5 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                {t('com.pres.preflight_title')}
              </h5>
              <span className="text-xs text-slate-500">3 controlli</span>
            </div>
            <div className={cn(
              'rounded-lg border px-3 py-2 mb-3 text-sm font-semibold',
              canStart
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900',
            )}>
              {canStart
                ? `✓ Tutti i controlli passati — pronto ad avviare`
                : `✗ Risolvi i blocchi prima di avviare`}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <PreflightItem
                ok={commIds.length > 0}
                label={
                  commIds.length > 0
                    ? t('com.pres.pf.commissione_assigned', { name: commissione?.nome ?? '?', n: commIds.length })
                    : t('com.pres.pf.commissione_missing')
                }
              />
              <PreflightItem
                ok={numCriteri > 0}
                label={t('com.pres.pf.criteri', { n: numCriteri })}
              />
              <PreflightItem
                ok={total > 0}
                label={total > 0 ? t('com.pres.pf.cand_ok', { n: total }) : t('com.pres.pf.cand_zero')}
              />
            </ul>
            <div className="mt-5 pt-5 border-t border-slate-200 flex items-center justify-end">
              {canStart ? (
                <button
                  onClick={() => handleStart(fase.id)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-6 py-3 rounded-xl shadow-md transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:pointer-events-none"
                >
                  ▶ {t('com.pres.start')}
                </button>
              ) : (
                <button
                  disabled
                  title={t('com.pres.cant_start_hint')}
                  className="inline-flex items-center gap-2 text-base font-medium text-slate-400 bg-slate-100 cursor-not-allowed px-6 py-3 rounded-xl"
                >
                  ▶ {t('com.pres.start')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* IN_CORSO — progress */}
        {isRunning && (
          <div className="mt-5 pt-5 border-t border-slate-200 space-y-5">
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <h5 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                  {t('com.pres.progress_title')}
                </h5>
                <span className="text-base font-bold text-emerald-700">
                  {fullyVoted}<span className="text-slate-400 font-normal">/{total}</span>{' '}
                  <span className="text-sm text-slate-500 font-normal">({pct}%)</span>
                </span>
              </div>
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="font-semibold">{fullyVoted}</span> {t('com.pres.cand_full')}
                </div>
                <div className="flex items-center gap-1.5 text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="font-semibold">{partial}</span> {t('com.pres.cand_partial')}
                </div>
                <div className="flex items-center gap-1.5 text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                  <span className="font-semibold">{Math.max(0, total - fullyVoted - partial)}</span> {t('com.pres.cand_pending')}
                </div>
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <h5 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                  {t('com.pres.committee_title')}
                </h5>
                <span className={cn('text-base font-bold', allComm ? 'text-emerald-700' : 'text-amber-700')}>
                  {commDone}<span className="text-slate-400 font-normal">/{commIds.length}</span>{' '}
                  <span className="text-sm text-slate-500 font-normal">({commPct}%)</span>
                </span>
              </div>
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={cn('h-full transition-all', allComm ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-gradient-to-r from-amber-400 to-amber-500')}
                  style={{ width: `${commPct}%` }}
                />
              </div>
              <div className={cn('mt-2 text-sm', allComm ? 'text-emerald-700 font-semibold' : 'text-amber-700')}>
                {allComm
                  ? `✓ ${t('com.pres.committee_all_done')}`
                  : t('com.pres.committee_pending', { n: commIds.length - commDone })}
              </div>
            </div>
            {/* End fase */}
            {!isConfirmingEnd ? (
              <div className="mt-5 pt-5 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => { setConfirmEndFaseId(fase.id); setEndChecked(false); }}
                  disabled={saving}
                  className={cn(
                    'inline-flex items-center gap-2 text-base font-bold text-white px-6 py-3 rounded-xl shadow-md transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:pointer-events-none',
                    allComm ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700',
                  )}
                >
                  ■ {t('com.pres.end')}
                </button>
              </div>
            ) : (
              <div className="mt-5 pt-5 border-t border-slate-200 space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="font-semibold text-amber-900">{t('com.pres.end_warning')}</p>
                  <p className="text-amber-800 mt-2 text-xs">
                    {t('com.pres.end_stats', { n: fullyVoted, total })}
                  </p>
                  <div className="w-full h-2 bg-amber-200 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                  </div>
                  {missing > 0 && (
                    <p className="text-rose-700 text-xs mt-2 font-bold">
                      {t('com.pres.end_incomplete', { missing })}
                    </p>
                  )}
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={endChecked}
                    onChange={(e) => setEndChecked(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-brand-600"
                  />
                  <span className="text-xs text-slate-700">{t('com.pres.end_checkbox')}</span>
                </label>
                <div className="flex items-center justify-end gap-3">
                  <button
                    className="c-btn c-btn--outline c-btn--sm"
                    onClick={() => setConfirmEndFaseId(null)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => handleEnd(fase.id)}
                    disabled={saving}
                    className="c-btn c-btn--danger disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {t('com.pres.end_btn')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CONCLUSA — outcome */}
        {isDone && (
          <div className="mt-5 pt-5 border-t border-slate-200">
            <h5 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">
              {t('com.pres.outcome_title')}
            </h5>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-white border border-slate-200 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
                  {t('com.pres.outcome_total')}
                </div>
                <div className="text-3xl font-extrabold text-slate-900 leading-none">{total}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold mb-1">
                  {t('com.pres.outcome_passed')}
                </div>
                <div className="text-3xl font-extrabold text-emerald-800 leading-none">{passed}</div>
                <div className="text-[10px] text-emerald-700 mt-1">{passedPct}%</div>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
                <div className="text-xs uppercase tracking-wider text-rose-700 font-semibold mb-1">
                  {t('com.pres.outcome_eliminated')}
                </div>
                <div className="text-3xl font-extrabold text-rose-800 leading-none">
                  {Math.max(0, total - passed)}
                </div>
                <div className="text-[10px] text-rose-700 mt-1">{Math.max(0, 100 - passedPct)}%</div>
              </div>
            </div>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="rounded-3xl p-6 sm:p-10 mb-6 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/50 border border-emerald-100">
      <header className="flex items-start justify-between gap-6 flex-wrap mb-6">
        <div className="flex items-start gap-5 min-w-0">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg shrink-0 text-3xl sm:text-4xl">
            🎯
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-slate-900 text-2xl sm:text-3xl leading-tight tracking-tight">
                {t('com.pres.session_title')}
              </h3>
              <span className="text-[11px] font-bold px-2.5 py-0.5 bg-amber-500 text-white rounded-full uppercase tracking-wider">
                {t('com.pres.tag')}
              </span>
            </div>
            <p className="text-base text-slate-600 mt-2 leading-relaxed max-w-2xl">
              {t('com.pres.session_desc')}
            </p>
          </div>
        </div>
      </header>

      {/* KPI strip matching vanilla kpiGradientCard with icon circle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard gradient="from-sky-400 to-cyan-500" value={fasi.length} label="Fasi presiedute" icon="🏁" />
        <KpiCard gradient="from-emerald-400 to-teal-500" value={totCand} label="Candidati totali" icon="🎓" />
        <KpiCard gradient="from-violet-500 to-purple-600" value={totValutati} label="Valutati" icon="✓" />
        <KpiCard
          gradient="from-indigo-500 to-blue-600"
          value={`${pctComplete}%`}
          label="Completamento"
          icon="📊"
          progress={pctComplete}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        {fasi.map((f) => (
          <FasePresCard key={f.id} fase={f} />
        ))}
      </div>
    </section>
  );
}

// ── Scoring sheet ─────────────────────────────────────────────────────────────

interface ScoringSheetProps {
  concorso: Concorso;
  fase: Fase;
  commissario: Commissario;
  cf: CandidatoFase;
  candidato: Candidato | undefined;
  isPresidente: boolean;
  myEvaluated: CandidatoFase[];
  allCfs: CandidatoFase[];
  candidati: Candidato[];
  valutazioni: Valutazione[];
  commissioni: Commissione[];
  onSaved: () => void;
  onReset: () => void;
  scoring: ScoringModule;
}

function ScoringSheet({
  concorso,
  fase,
  commissario,
  cf,
  candidato,
  isPresidente,
  myEvaluated,
  allCfs,
  candidati,
  valutazioni,
  onSaved,
  onReset,
  scoring,
}: ScoringSheetProps) {
  const { t } = useTranslation();
  const scala = scoring.getScala(fase);
  const criteri = scoring.getCriteri(fase);

  // Draft state
  const initDraft = useCallback((): DraftState => {
    const restored = loadDraft(fase.id, cf.id);
    if (restored) return restored;
    const defaultVal = Math.round(scala * 0.7 * 10) / 10;
    const voti: Record<string, number> = {};
    criteri.forEach((c) => { voti[c.key] = defaultVal; });
    return { voti, note: '', faseId: fase.id, candidatoFaseId: cf.id };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase.id, cf.id, scala, criteri.map((c) => c.key).join(',')]);

  const [draft, setDraft] = useState<DraftState>(initDraft);

  // Re-init when cf changes
  useEffect(() => {
    const d = initDraft();
    setDraft(d);
    persistDraft(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase.id, cf.id]);

  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  function updateVoto(key: string, val: number) {
    setDraft((prev) => {
      const next = { ...prev, voti: { ...prev.voti, [key]: val } };
      persistDraft(next);
      return next;
    });
  }

  function updateNote(note: string) {
    setDraft((prev) => {
      const next = { ...prev, note };
      persistDraft(next);
      return next;
    });
  }

  function setAllVoti(target: number) {
    setDraft((prev) => {
      const voti: Record<string, number> = {};
      criteri.forEach((c) => { voti[c.key] = target; });
      const next = { ...prev, voti };
      persistDraft(next);
      return next;
    });
  }

  const totale = scoring.pesato(draft.voti, fase);
  const norm = scala ? totale / scala : 0;
  const totaleCls = norm >= 0.8 ? 'text-emerald-600' : norm >= 0.65 ? 'text-slate-900' : 'text-rose-600';

  const ammesso = isAmmesso(norm, fase.ordine);

  async function doSave() {
    setSaving(true);
    try {
      const save = await getSaveValutazione();
      await save({
        candidatoFaseId: cf.id,
        commissarioId: commissario.id,
        voti: draft.voti,
        note: draft.note || undefined,
      });
      const verdict = ammesso ? t('com.confirm.approved') : t('com.confirm.rejected');
      toast.success(t('com.save.success', { verdict }));
      onSaved();
    } catch (err) {
      toast.error(t('com.save.error', { msg: err instanceof Error ? err.message : '?' }));
    } finally {
      setSaving(false);
    }
  }

  // Star pictogram
  const currentStarLevel = Math.round((totale / scala) * 5);

  const step = scoring.voteStep(scala);
  const sliderMin = scala >= 30 ? 0 : 1;
  const mid = scala / 2;

  // Pesi label. NB: criteri.peso è già una percentuale 0-100 (colonna integer in
  // `criteri`), non una frazione 0-1 → niente *100 (mostrava "3500%" invece di "35%").
  const pesiLabel = criteri
    .map((c) => `${(c.label || c.key || '?').charAt(0).toUpperCase()}${Math.round(c.peso || 0)}`)
    .join('/');

  const eta = ageFromDate(candidato?.dataNascita);

  return (
    <>
      {showConfirm && (
        <CountdownConfirm
          candidato={candidato ?? null}
          anonimo={concorso.anonimo}
          ammesso={ammesso}
          totale={totale}
          scala={scala}
          fmtVoto={scoring.fmtVoto}
          onConfirm={async () => {
            setShowConfirm(false);
            await doSave();
          }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <section className="view-fade bg-gradient-to-br from-emerald-50/30 via-white to-emerald-50/20 -m-4 sm:-m-6 p-4 sm:p-6 rounded-3xl">
        {/* Header valutazione */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-5 sm:p-6 mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-bold text-amber-700 uppercase tracking-wider">
                {fase.nome} · {t('com.scale_suffix', { scala })}
                {scoring.getModoValutazione(fase) === 'sincrona' && (
                  <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 bg-indigo-500 text-white rounded normal-case">
                    {t('com.sincrona_tag')}
                  </span>
                )}
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3 tracking-tight truncate">
                {concorso.nome}
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {isPresidente ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                    🎯 {t('com.presidente_label')}
                  </span>
                ) : (
                  <span>{t('com.commissario_label')}: </span>
                )}
                <span className="font-semibold text-slate-800 ml-1">{displayName(commissario)}</span>
                {commissario.specialita && (
                  <span className="text-slate-500"> · {commissario.specialita}</span>
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                {t('com.progress_phase')}
              </div>
              <div className="text-2xl font-extrabold text-slate-900 leading-none mt-1">
                {myEvaluated.length}
                <span className="text-slate-400 font-medium text-base"> / {allCfs.length}</span>
              </div>
              <div className="w-32 h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all"
                  style={{ width: `${allCfs.length ? (myEvaluated.length / allCfs.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* 25% history sidebar */}
          <aside className="lg:col-span-1">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('com.history_title')}
            </h3>
            <div className="space-y-3">
              {myEvaluated.length === 0 ? (
                <div className="text-xs text-slate-400 italic bg-white border border-dashed border-slate-200 rounded-xl p-4 text-center">
                  {t('com.history_empty')}
                </div>
              ) : (
                myEvaluated.slice(-2).map((hcf) => (
                  <HistoryCard
                    key={hcf.id}
                    cf={hcf}
                    candidati={candidati}
                    valutazioni={valutazioni}
                    commissarioId={commissario.id}
                    anonimo={concorso.anonimo}
                    fase={fase}
                    fmtVotoFn={scoring.fmtVoto}
                    getCriteriFn={scoring.getCriteri}
                    pesatoFn={scoring.pesato}
                    getScalaFn={scoring.getScala}
                  />
                ))
              )}
            </div>
          </aside>

          {/* 75% main evaluation */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-7 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-100">
                <div className="flex items-center gap-5 min-w-0">
                  <div className="text-5xl sm:text-6xl font-black tabular-nums bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent leading-none shrink-0">
                    {String(candidato?.numeroCandidato ?? '').padStart(3, '0')}
                  </div>
                  {!concorso.anonimo && (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden flex items-center justify-center text-3xl text-slate-400 shrink-0 ring-4 ring-white shadow-md">
                      {candidato?.fotoUrl ? (
                        <img src={candidato.fotoUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        '👤'
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    {concorso.anonimo ? (
                      <>
                        <div className="font-bold text-slate-900 text-xl">{t('com.candidate_anonymous')}</div>
                        <div className="text-sm text-slate-600 mt-0.5">{candidato?.strumento ?? ''}</div>
                      </>
                    ) : (
                      <>
                        <div className="font-bold text-slate-900 text-xl truncate">{displayName(candidato)}</div>
                        <div className="text-sm text-slate-600 mt-0.5">
                          {candidato?.strumento ?? ''}
                          {eta ? ` · ${t('com.candidate_age', { eta })}` : ''}
                          {candidato?.nazionalita ? ` · ${candidato.nazionalita}` : ''}
                        </div>
                      </>
                    )}
                    <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 mt-1.5 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200">
                      {t('com.position_in_phase', { pos: cf.posizione, stato: cf.stato })}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    {t('com.weighted_total')}
                  </div>
                  <div id="totale" className={cn('text-4xl sm:text-5xl font-extrabold leading-none mt-1', totaleCls)}>
                    {scoring.fmtVoto(totale, scala)}
                    <span className="text-lg font-medium text-slate-300">/{scala}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1.5">
                    {t('com.weights', { label: pesiLabel })}
                  </div>
                </div>
              </div>

              {/* Quick score stars — sun palette matching vanilla ring-sun-400 */}
              <div className="mt-6 bg-sun-50/50 border border-sun-100 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold text-sun-700 uppercase tracking-wider">
                    {t('com.quick_score')}
                  </span>
                  <div className="flex items-center gap-1" data-pictogram="">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const active = n <= currentStarLevel;
                      const target = Math.round(scala * (n / 5) * 10) / 10;
                      return (
                        <button
                          key={n}
                          type="button"
                          title={`${target}/${scala}`}
                          className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center text-xl transition-all hover:scale-110',
                            active ? 'bg-white ring-2 ring-sun-400 shadow-sm' : 'bg-white/50 text-slate-300',
                          )}
                          onClick={() => setAllVoti(target)}
                        >
                          {active ? '⭐' : '☆'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Criteri sliders — vote-range class from design system */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {criteri.map((c) => {
                  const val = draft.voti[c.key] ?? sliderMin;
                  const peso = Math.round(c.peso || 0); // peso 0-100, già percentuale
                  return (
                    <div key={c.key} className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">{c.label}</div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider">peso {peso}%</div>
                        </div>
                        <div className="text-2xl font-bold tabular-nums text-brand-700 ml-2">
                          {scoring.fmtVoto(val, scala)}
                        </div>
                      </div>
                      <input
                        type="range"
                        min={sliderMin}
                        max={scala}
                        step={step}
                        value={val}
                        onChange={(e) => updateVoto(c.key, Number(e.target.value))}
                        className="vote-range mt-2 w-full"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                        <span>{sliderMin}</span>
                        <span>{scoring.fmtVoto(mid, scala)}</span>
                        <span>{scala}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Note */}
              <div className="mt-5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  {t('com.notes_label')}
                </label>
                <textarea
                  rows={3}
                  value={draft.note}
                  onChange={(e) => updateNote(e.target.value)}
                  placeholder={t('com.notes_placeholder')}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="mt-6 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  className="text-sm font-medium text-slate-600 hover:bg-slate-100 px-4 py-2.5 rounded-lg"
                  onClick={onReset}
                >
                  {t('com.reset_values')}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="ml-auto inline-flex items-center justify-center gap-2 text-base font-bold text-white bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 px-7 py-3.5 rounded-2xl shadow-glow transition disabled:opacity-60"
                  onClick={() => setShowConfirm(true)}
                >
                  {t('com.save_next')}
                </button>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {t('com.auto_promote_help')}
            </div>
          </div>
        </div>
      </section>

      {/* Floating timer */}
      {(Number(fase.tempoMinuti) || 0) > 0 && (
        <FloatingTimer
          faseId={fase.id}
          isPresidente={isPresidente}
          candidatoFaseId={cf.id}
        />
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Commissario() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const commissarioId = user?.commissarioId ?? null;

  // Scoring module (lazy-loaded once)
  const [scoring, setScoring] = useState<ScoringModule | null>(null);
  useEffect(() => {
    void getScoring().then(setScoring);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const {
    concorsiList,
    commissario,
    fasi,
    commissioni,
    commissariList,
    candidatiFaseList,
    candidati,
    valutazioni,
    faseWithCriteri: buildFaseWithCriteri,
    isLoading,
    commissarioConcorsoId,
    invalidateAll,
  } = useCommissarioData(commissarioId);

  // Derive the active concorso (mirrors what the hook does internally, but we
  // need the object here for guards and child component props).
  const concorso = concorsiList?.find((c) => c.id === commissarioConcorsoId) ?? null;

  // ── Guard: no commissario profile ─────────────────────────────────────────

  if (!commissarioId) {
    return (
      <section className="view-fade mx-auto max-w-2xl text-center py-16">
        <h2 className="text-xl font-bold text-slate-900">Account commissario senza profilo</h2>
        <p className="text-sm text-slate-600 mt-2">Contatta l'amministratore.</p>
      </section>
    );
  }

  if (isLoading || !scoring) {
    return (
      <section className="view-fade mx-auto max-w-2xl text-center py-16">
        <h2 className="text-xl font-bold text-slate-900">{t('common.loading')}</h2>
      </section>
    );
  }

  if (!concorso) {
    return (
      <section className="view-fade mx-auto max-w-2xl text-center py-16">
        <h2 className="text-xl font-bold text-slate-900">Nessun concorso assegnato</h2>
        <p className="text-sm text-slate-600 mt-2">Non risulti assegnato a nessun concorso.</p>
        <div className="mt-6">
          <Link to="/" className="c-btn c-btn--outline c-btn--sm">
            {t('app.dashboard')}
          </Link>
        </div>
      </section>
    );
  }
  // `concorso` deriva da commissario.concorsoId: se c'è il concorso, c'è il commissario.
  if (!commissario) return null;

  // ── Aliases ────────────────────────────────────────────────────────────────

  const fasiList: Fase[] = fasi ?? [];
  const commissioniList: Commissione[] = commissioni ?? [];
  const cfList: CandidatoFase[] = candidatiFaseList ?? [];
  const candidatiList: Candidato[] = candidati ?? [];
  const valsAll: Valutazione[] = valutazioni ?? [];

  const faseAttiva = fasiList.find((f) => f.stato === 'IN_CORSO') ?? null;

  // Fasi di cui questo commissario è presidente (presidente della commissione
  // assegnata alla fase) — db.getPresidenteForFase, ora in @/lib/presidenti.
  // Il record commissione del server porta `presidenteCommissarioId`; lo
  // esponiamo alla lib con la shape strutturale CommissioneLike.
  const commissioniLike = commissioniList as unknown as CommissioneLike[];
  const commissariSelf = [{ id: commissarioId }];
  const fasiPresidente = fasiList.filter(
    (f) => getPresidenteForFase(f, commissioniLike, commissariSelf)?.id === commissarioId,
  );
  const isPresidenteFase = fasiPresidente.length > 0;

  // ── No active fase ─────────────────────────────────────────────────────────

  if (!faseAttiva) {
    return (
      <section className="view-fade c-page max-w-7xl mx-auto" data-pres-fullpage="1">
        {isPresidenteFase ? (
          <PresidentePanel
            concorso={concorso}
            fasi={fasiPresidente}
            commissioni={commissioniList}
            candidatiFase={cfList}
            valutazioni={valsAll}
            onFaseChanged={invalidateAll}
          />
        ) : (
          <div className="bg-card border border-border rounded-lg shadow-soft p-10 text-center">
            <div className="text-6xl mb-4">⏸️</div>
            <h2 className="text-2xl font-bold">{t('com.no_phase.title')}</h2>
            <p className="text-muted-foreground mt-2 text-base">{t('com.no_phase.desc')}</p>
            <p className="text-sm text-muted-foreground mt-4">
              {t('com.no_phase.concorso_label')}:{' '}
              <span className="font-medium text-foreground">{concorso.nome}</span>
            </p>
          </div>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link to="/" className="c-btn c-btn--outline c-btn--sm">{t('app.dashboard')}</Link>
        </div>
      </section>
    );
  }

  // ── Active fase — resolve commissario membership ───────────────────────────

  const fase = faseAttiva;
  // Lookup commissari per id (nome/foto/stato) per lo stato d'attesa sincrono.
  const commById = new Map((commissariList ?? []).map((c) => [c.id, c]));
  // Fase arricchita con i criteri CONFIGURATI (dal record `criteri` della fase).
  // Da usare ovunque si chiamino gli helper di scoring: getCriteri/pesato/getScala
  // e per il render della scheda voto, così i commissari votano i criteri giusti
  // con i pesi configurati. Le chiavi (slug del nome) coincidono con la `criterio`
  // scritta nelle valutazioni — coerenti fra lettura (render) e scrittura (POST).
  const faseWithCriteri: Fase = buildFaseWithCriteri(fase);
  const faseCommissione = commissioniList.find((c) => c.id === fase.commissioneId);
  const assignedIds: string[] = getCommissariIds(faseCommissione);
  const isAssigned = assignedIds.includes(commissarioId);

  // ── Not assigned to this fase ──────────────────────────────────────────────

  if (!isAssigned) {
    if (isPresidenteFase) {
      return (
        <section className="view-fade c-page max-w-7xl mx-auto" data-pres-fullpage="1">
          <PresidentePanel
            concorso={concorso}
            fasi={fasiPresidente}
            commissioni={commissioniList}
            candidatiFase={cfList}
            valutazioni={valsAll}
            onFaseChanged={invalidateAll}
          />
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link to="/" className="c-btn c-btn--outline c-btn--sm">{t('app.dashboard')}</Link>
          </div>
        </section>
      );
    }
    return (
      <section className="view-fade max-w-2xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">🚫</div>
        <h2 className="text-xl font-bold text-slate-900">{t('com.not_assigned.title')}</h2>
        <p className="text-slate-600 mt-2">
          {t('com.not_assigned.desc', { fase: fase.nome })}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          {t('com.not_assigned.concorso_label')}:{' '}
          <span className="font-medium">{concorso.nome}</span>
        </p>
        <div className="mt-6">
          <Link to="/" className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg">
            {t('com.back_to_menu')}
          </Link>
        </div>
      </section>
    );
  }

  // ── Determine current candidate ────────────────────────────────────────────

  const modo = scoring.getModoValutazione(fase);
  const faseCfList = cfList
    .filter((cf) => cf.faseId === fase.id)
    .sort((a, b) => (a.posizione ?? 0) - (b.posizione ?? 0));

  // Solo commissari ATTIVI concorrono al conteggio "tutti hanno votato" in
  // sincrona: un commissario INATTIVO non deve bloccare l'avanzamento.
  const activeCommIds = assignedIds.filter((cid) => commById.get(cid)?.stato !== 'INATTIVO');

  const faseCriteriKeys = scoring.getCriteri(faseWithCriteri).map((c) => c.key);
  const myVotedCfIds = new Set(
    valsAll.filter((v) => v.commissarioId === commissarioId).map((v) => v.candidatoFaseId),
  );

  let currentCf: CandidatoFase | null = null;
  let waitingFor: CandidatoFase | null = null;

  if (modo === 'sincrona') {
    const resolved = resolveSyncCurrentCf(faseCfList, myVotedCfIds, activeCommIds, faseCriteriKeys, valsAll);
    currentCf = resolved.currentCf;
    waitingFor = resolved.waitingFor;
  } else {
    currentCf = faseCfList.find((cf) => !myVotedCfIds.has(cf.id)) ?? null;
  }

  const myEvaluated = faseCfList.filter((cf) => myVotedCfIds.has(cf.id));

  // ── Waiting state ──────────────────────────────────────────────────────────

  if (waitingFor) {
    const wCand = candidatiList.find((c) => c.id === waitingFor.candidatoId);
    const commInFase = commissioniList
      .filter((c) => c.id === fase.commissioneId)
      .flatMap((c) => getCommissariIds(c))
      .filter((cid) => commById.get(cid)?.stato !== 'INATTIVO');
    const votedSet = new Set(
      valsAll.filter((v) => v.candidatoFaseId === waitingFor.id).map((v) => v.commissarioId),
    );
    const votedCount = commInFase.filter((id) => votedSet.has(id)).length;
    const totalCount = commInFase.length;
    const eta = ageFromDate(wCand?.dataNascita);

    return (
      <WaitingPanel
        fase={fase}
        concorso={concorso}
        isPresidenteFase={isPresidenteFase}
        wCand={wCand}
        commInFase={commInFase}
        votedSet={votedSet}
        votedCount={votedCount}
        totalCount={totalCount}
        eta={eta}
        commissarioId={commissarioId}
        commById={commById}
        invalidateAll={invalidateAll}
        presidentePanelSlot={
          <PresidentePanel
            concorso={concorso}
            fasi={fasiPresidente}
            commissioni={commissioniList}
            candidatiFase={cfList}
            valutazioni={valsAll}
            onFaseChanged={invalidateAll}
          />
        }
      />
    );
  }

  // ── All done ───────────────────────────────────────────────────────────────

  if (!currentCf) {
    return (
      <AllDonePanel
        isPresidenteFase={isPresidenteFase}
        evaluatedCount={myEvaluated.length}
        faseNome={fase.nome}
        presidentePanelSlot={
          <PresidentePanel
            concorso={concorso}
            fasi={fasiPresidente}
            commissioni={commissioniList}
            candidatiFase={cfList}
            valutazioni={valsAll}
            onFaseChanged={invalidateAll}
          />
        }
      />
    );
  }

  // ── Main scoring sheet ─────────────────────────────────────────────────────

  const candidato = candidatiList.find((c) => c.id === currentCf.candidatoId);

  function handleSaved() {
    invalidateAll();
  }

  function handleReset() {
    // Clear draft and re-init to defaults by invalidating — the ScoringSheet
    // key will not change so we remove the draft from storage and force re-init.
    clearDraft();
    invalidateAll();
  }

  return (
    <div className="max-w-7xl mx-auto">
      {isPresidenteFase && (
        <PresidentePanel
          concorso={concorso}
          fasi={fasiPresidente}
          commissioni={commissioniList}
          candidatiFase={cfList}
          valutazioni={valsAll}
          onFaseChanged={invalidateAll}
        />
      )}
      <ScoringSheet
        key={`${fase.id}-${currentCf.id}`}
        concorso={concorso}
        fase={faseWithCriteri}
        commissario={commissario}
        cf={currentCf}
        candidato={candidato}
        isPresidente={isPresidenteFase}
        myEvaluated={myEvaluated}
        allCfs={faseCfList}
        candidati={candidatiList}
        valutazioni={valsAll}
        commissioni={commissioniList}
        onSaved={handleSaved}
        onReset={handleReset}
        scoring={scoring}
      />
    </div>
  );
}
