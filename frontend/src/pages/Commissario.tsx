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
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';
import { getPresidenteForFase, type CommissioneLike } from '@/lib/presidenti';

import type {
  Fase,
  Commissario,
  Commissione,
  CandidatoFase,
  Candidato,
  Valutazione,
} from '@/types';
import {
  clearDraft,
  getCommissariIds,
  ageFromDate,
  resolveSyncCurrentCf,
} from './commissario-utils';

import { useFaseRuntime } from '@/hooks/useFaseRuntime';
import { useCommissarioData } from '@/hooks/useCommissarioData';
import { WaitingPanel } from '@/components/commissario/WaitingPanel';
import { AllDonePanel } from '@/components/commissario/AllDonePanel';
import { FasiConcluseSummary } from '@/components/commissario/FasiConcluseSummary';
import { ScoringSheet } from '@/components/commissario/ScoringSheet';
import { PresidentePanel } from '@/components/commissario/PresidentePanel';

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


// ── FaseEventToaster ──────────────────────────────────────────────────────────
// Mostra un toast ai commissari quando il presidente avvia o conclude una fase
// (eventi SSE `start`/`conclude`). Componente "headless": non renderizza nulla,
// si limita a sottoscrivere il runtime della fase tramite useFaseRuntime e a
// inoltrare l'evento a un toast. Va montato SOLO per i commissari NON presidenti
// (il presidente ha già il proprio toast.success quando clicca Avvia/Concludi),
// così evitiamo il doppio avviso.

function FaseEventToaster({ faseId }: { faseId: string }) {
  const { t } = useTranslation();
  // Guard per dedup: alcuni stream possono riemettere lo stesso evento → mostra
  // il toast una sola volta per (faseId + action).
  const lastActionRef = useRef<string | null>(null);

  const onEvent = useCallback(
    (action: string) => {
      if (action !== 'start' && action !== 'conclude') return;
      const key = `${faseId}:${action}`;
      if (lastActionRef.current === key) return;
      lastActionRef.current = key;
      if (action === 'start') {
        toast.info(t('com.event.phase_started'));
      } else {
        toast.info(t('com.event.phase_concluded'));
      }
    },
    [faseId, t],
  );

  useFaseRuntime(faseId, { onEvent });
  return null;
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
  const fasiPresidenteIds = new Set(fasiPresidente.map((f) => f.id));

  // ── Toast SSE start/conclude ────────────────────────────────────────────────
  // Sottoscriviamo gli eventi runtime delle fasi NON ancora concluse cui questo
  // commissario è assegnato, ESCLUSE quelle che presiede (il presidente vede già
  // il proprio toast.success cliccando Avvia/Concludi → niente doppione). Così
  // quando il presidente avvia/conclude una fase, gli altri commissari ricevono
  // un avviso visivo. Montiamo un FaseEventToaster (headless) per ciascuna fase.
  const fasiDaNotificare = fasiList.filter((f) => {
    if (f.stato === 'CONCLUSA') return false;
    if (fasiPresidenteIds.has(f.id)) return false;
    const comm = commissioniList.find((c) => c.id === f.commissioneId);
    return getCommissariIds(comm).includes(commissarioId);
  });
  const eventToasters = fasiDaNotificare.map((f) => (
    <FaseEventToaster key={f.id} faseId={f.id} />
  ));

  // Fasi CONCLUSA cui questo commissario era assegnato (presidente o membro):
  // mostrate come riepilogo con classifica + esito finale (PROMOSSO/ELIMINATO
  // da `cf.ammessoProssimaFase`). Senza questo il commissario non vedeva mai
  // le fasi già concluse.
  const fasiConcluseAssegnate = fasiList.filter((f) => {
    if (f.stato !== 'CONCLUSA') return false;
    const comm = commissioniList.find((c) => c.id === f.commissioneId);
    return getCommissariIds(comm).includes(commissarioId);
  });

  // ── No active fase ─────────────────────────────────────────────────────────

  if (!faseAttiva) {
    return (
      <section className="view-fade c-page max-w-7xl mx-auto" data-pres-fullpage="1">
        {eventToasters}
        {isPresidenteFase ? (
          <PresidentePanel
            concorso={concorso}
            fasi={fasiPresidente}
            commissioni={commissioniList}
            candidatiFase={cfList}
            candidati={candidatiList}
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
        <FasiConcluseSummary
          concorso={concorso}
          fasi={fasiConcluseAssegnate}
          cfList={cfList}
          valutazioni={valsAll}
          candidati={candidatiList}
        />
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
          {eventToasters}
          <PresidentePanel
            concorso={concorso}
            fasi={fasiPresidente}
            commissioni={commissioniList}
            candidatiFase={cfList}
            candidati={candidatiList}
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
        {eventToasters}
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
      <>
        {eventToasters}
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
              candidati={candidatiList}
              valutazioni={valsAll}
              onFaseChanged={invalidateAll}
            />
          }
        />
      </>
    );
  }

  // ── All done ───────────────────────────────────────────────────────────────

  if (!currentCf) {
    return (
      <>
        {eventToasters}
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
              candidati={candidatiList}
              valutazioni={valsAll}
              onFaseChanged={invalidateAll}
            />
          }
        />
      </>
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
      {eventToasters}
      {isPresidenteFase && (
        <PresidentePanel
          concorso={concorso}
          fasi={fasiPresidente}
          commissioni={commissioniList}
          candidatiFase={cfList}
          candidati={candidatiList}
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
        candidato={candidato ?? null}
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
