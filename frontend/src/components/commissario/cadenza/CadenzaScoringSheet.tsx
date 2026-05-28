/**
 * CadenzaScoringSheet.tsx — drop-in replacement per ScoringSheet (Commissario.tsx).
 *
 * Stessi props del ScoringSheet attualmente inline in Commissario.tsx. Tutta
 * la logica (draft state + persistDraft, save mutation, countdown confirm,
 * navigazione tra candidatoFase) resta IDENTICA. Cambia solo il layer di
 * presentazione:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ Context strip (concorso, fase, scala, modalità)                       │
 *   ├──────────┬──────────────────────────────────────┬───────────────────┤
 *   │ Queue +  │ Candidato + totale pesato              │ Stato commissari │
 *   │ Storico  │ Programma in esecuzione                │ + nota sincrona  │
 *   │ ─────    │ Valutazione rapida (set tutto)         │                  │
 *   │ Timer    │ 4 score lanes (criteri)                │                  │
 *   │          │ Note                                   │                  │
 *   │          │ Footer: reset + Salva e prossimo       │                  │
 *   └──────────┴──────────────────────────────────────┴───────────────────┘
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, ChevronRight, Flag, Clock, Music2, Zap, Star, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { saveValutazione } from '@/api/valutazioni';
import { CountdownConfirm } from '@/components/commissario/CountdownConfirm';
import { ageFromDate, displayName, loadDraft, persistDraft, type DraftState } from '@/pages/commissario-utils';
import type {
  Concorso, Fase, Commissario as CommissarioT, CandidatoFase, Candidato,
  Valutazione, Commissione,
} from '@/types';

import { CadenzaScoreLane } from './CadenzaScoreLane';
import { CadenzaQueueRail } from './CadenzaQueueRail';
import { CadenzaRailTimer } from './CadenzaRailTimer';
import { CadenzaProgramma } from './CadenzaProgramma';
import { CadenzaCommissariStatus } from './CadenzaCommissariStatus';

// Tipo del modulo @gestimus/scoring — coerente con Commissario.tsx attuale.
interface ScoringModule {
  getScala: (fase: Fase) => number;
  getCriteri: (fase: Fase) => { key: string; label: string; peso: number }[];
  getModoValutazione: (fase: Fase) => 'autonoma' | 'sincrona';
  pesato: (voti: Record<string, number>, fase: Fase) => number;
  fmtVoto: (n: number, scala: number) => string;
  voteStep: (scala: number) => number;
}

export interface CadenzaScoringSheetProps {
  concorso: Concorso;
  fase: Fase;
  commissario: CommissarioT;
  cf: CandidatoFase;
  candidato: Candidato | null;
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

export function CadenzaScoringSheet(props: CadenzaScoringSheetProps) {
  const {
    concorso, fase, commissario, cf, candidato, isPresidente,
    myEvaluated, allCfs, candidati, valutazioni, commissioni,
    onSaved, scoring,
  } = props;

  const { t } = useTranslation();
  const scala = scoring.getScala(fase);
  const criteri = scoring.getCriteri(fase);
  const modo = scoring.getModoValutazione(fase);
  const step = scoring.voteStep(scala);

  // ── Draft state (persistito in sessionStorage) ───────────────────────────
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
  useEffect(() => {
    const d = initDraft();
    setDraft(d);
    persistDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase.id, cf.id]);

  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // 5s undo: il bottone Salva apre il CountdownConfirm, che invoca doSave dopo
  // 5 secondi (o subito se l'utente conferma) — niente verdetto di merito.
  const [showConfirm, setShowConfirm] = useState(false);

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

  async function doSave() {
    setSaving(true);
    try {
      await saveValutazione({
        candidatoFaseId: cf.id,
        commissarioId: commissario.id,
        voti: draft.voti,
        note: draft.note || undefined,
      });
      toast.success(t('com.save.success', { defaultValue: 'Valutazione salvata' }));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 800);
      onSaved();
    } catch (err) {
      toast.error(t('com.save.error', { msg: err instanceof Error ? err.message : '?' }));
    } finally {
      setSaving(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const totale = scoring.pesato(draft.voti, fase);
  const eta = ageFromDate(candidato?.dataNascita ?? null);
  const myProgressPct = allCfs.length ? Math.round((myEvaluated.length / allCfs.length) * 100) : 0;
  const currentStarLevel = Math.round((totale / scala) * 5);
  const min = scala >= 30 ? 0 : 1;
  const allSet = criteri.every((c) => draft.voti[c.key] != null);

  // Iniziali per Avatar
  const iniziali = useMemo(() => {
    if (!candidato) return '?';
    if (candidato.isGruppo && candidato.gruppoNome) {
      return candidato.gruppoNome.trim().slice(0, 2).toUpperCase();
    }
    const parts = [candidato.cognome, candidato.nome].filter(Boolean).join(' ');
    return parts.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
  }, [candidato]);

  return (
    <>
      {showConfirm && (
        <CountdownConfirm
          candidato={candidato}
          anonimo={concorso.anonimo}
          totale={totale}
          scala={scala}
          fmtVoto={scoring.fmtVoto}
          onConfirm={async () => { setShowConfirm(false); await doSave(); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
      <section className="w-full">
      {/* ── Context strip ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 py-2 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
            {fase.nome}
          </span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <h1 className="font-bold text-[18px] tracking-tight truncate">{concorso.nome}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="gap-1.5"><Flag size={11} /> Fase {fase.ordine}</Badge>
          <Badge variant="outline" className="tabular-nums">Scala /{scala}</Badge>
          {fase.tempoMinuti != null && (
            <Badge variant="outline" className="gap-1.5"><Clock size={11} /> {fase.tempoMinuti}′</Badge>
          )}
          <Badge variant={modo === 'sincrona' ? 'warning' : 'secondary'}>
            {modo === 'sincrona' ? 'Sincrona' : 'Autonoma'}
          </Badge>
        </div>
      </div>

      {/* ── Three-column grid ─────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_280px] gap-4 items-start">

        {/* LEFT rail: queue + timer */}
        <aside className="flex flex-col gap-3 md:sticky md:top-[68px]">
          <CadenzaQueueRail
            allCfs={allCfs}
            candidati={candidati}
            myEvaluated={myEvaluated}
            myValutazioni={valutazioni.filter((v) => v.commissarioId === commissario.id)}
            currentCfId={cf.id}
            fase={fase}
            anonimo={concorso.anonimo}
            scoring={scoring}
            canNavigate={modo === 'autonoma'}
          />
          <CadenzaRailTimer
            faseId={fase.id}
            isPresidente={isPresidente}
            candidatoFaseId={cf.id}
            tempoMinuti={fase.tempoMinuti ?? 0}
          />
        </aside>

        {/* CENTER scoring sheet */}
        <section className="rounded-xl border border-border bg-card text-card-foreground shadow-xs overflow-hidden">
          {/* Candidate header */}
          <header className="flex flex-wrap items-center gap-4 px-5 py-3.5 border-b border-border">
            <div className="flex items-center gap-3 shrink-0">
              <div className="font-bold tabular-nums tracking-tight text-[36px] text-primary leading-none">
                {cf.posizione != null ? String(cf.posizione).padStart(3, '0') : '---'}
              </div>
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground grid place-items-center font-semibold tabular-nums">
                {iniziali}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <Badge variant="default" className="gap-1.5">
                  <span className="relative w-1.5 h-1.5">
                    <span className="absolute inset-0 rounded-full bg-current opacity-30 animate-ping" />
                    <span className="absolute inset-0 rounded-full bg-current" />
                  </span>
                  In esecuzione
                </Badge>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Pos. {cf.posizione ?? '—'}/{allCfs.length}
                  {isPresidente && ' · Presidente'}
                </span>
              </div>
              <h2 className="font-bold text-[22px] leading-tight tracking-tight truncate">
                {concorso.anonimo ? `Candidato #${cf.posizione ?? '—'}` : (candidato ? displayName(candidato) : '—')}
              </h2>
              <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
                {candidato?.strumento && <span>{candidato.strumento}</span>}
                {eta != null && <span> · {eta} anni</span>}
                {candidato?.nazionalita && <span> · {candidato.nazionalita}</span>}
              </div>
            </div>
            {/* Totale pesato */}
            <div className="text-right shrink-0 border-l border-border pl-4">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium block">
                Totale pesato
              </span>
              <div className="flex items-baseline gap-1 justify-end mt-0.5">
                <span className="font-bold tabular-nums tracking-tight text-[34px] leading-none">
                  {scoring.fmtVoto(totale, scala)}
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums">/{scala}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                {/* Indicatore neutro: nessun verdetto durante il voto */}
                {criteri.map((c) => `${c.label.charAt(0).toUpperCase()}${Math.round(c.peso)}`).join(' / ')}
              </div>
            </div>
          </header>

          {/* Programma (da iscrizione) */}
          <CadenzaProgramma concorsoId={concorso.id} candidatoId={candidato?.id ?? null} />

          {/* Quick set bar */}
          <div className="px-5 py-2.5 border-b border-border flex items-center justify-between bg-amber-50/40 dark:bg-amber-950/20">
            <div className="flex items-center gap-3">
              <Zap size={14} className="text-amber-500" />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                Valutazione rapida
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                Imposta tutti i criteri (scala 1–5)
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = n <= currentStarLevel;
                return (
                  <button
                    key={n}
                    onClick={() => setAllVoti((n / 5) * scala)}
                    className={cn(
                      'w-7 h-7 grid place-items-center rounded-md transition',
                      filled ? 'text-amber-500 hover:bg-amber-100/60' : 'text-muted-foreground/40 hover:text-amber-500 hover:bg-accent',
                    )}
                    aria-label={`Imposta ${n}/5`}
                    title={`Imposta tutti i criteri a ${Math.round((n / 5) * scala * 10) / 10}/${scala}`}
                  >
                    <Star size={16} fill={filled ? 'currentColor' : 'none'} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Criteri lanes */}
          <div className="px-5 pt-1 pb-3">
            {criteri.map((c) => {
              const v = draft.voti[c.key];
              return (
                <div key={c.key} className="grid grid-cols-[180px_1fr_84px] gap-4 items-center py-2.5 border-b border-border/50 last:border-b-0">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-[17px] tracking-tight truncate">{c.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{Math.round(c.peso)}%</span>
                    </div>
                  </div>
                  <CadenzaScoreLane
                    value={v}
                    scala={scala}
                    step={step}
                    min={min}
                    onChange={(next) => updateVoto(c.key, next)}
                    ariaLabel={c.label}
                    disabled={saving}
                  />
                  <div className="flex items-baseline justify-end gap-1">
                    <span className={cn(
                      'font-bold tabular-nums tracking-tight text-[28px] leading-none',
                      v == null ? 'text-muted-foreground/40' : 'text-foreground',
                    )}>
                      {v == null ? '—' : scoring.fmtVoto(v, scala)}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">/{scala}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Notes */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                Note del commissario
              </span>
              <span className="text-[10.5px] text-muted-foreground/80 italic ml-auto">
                bozza salvata automaticamente
              </span>
            </div>
            <Textarea
              value={draft.note}
              onChange={(e) => updateNote(e.target.value)}
              rows={2}
              placeholder="Osservazioni interpretative, raccomandazioni…"
              className="resize-none text-[13px]"
              disabled={saving}
            />
          </div>

          {/* Footer */}
          <footer className="px-5 py-3 border-t border-border bg-muted/40 flex items-center justify-between">
            <Button
              variant="ghost" size="sm"
              onClick={() => {
                const defaultVal = Math.round(scala * 0.7 * 10) / 10;
                const voti: Record<string, number> = {};
                criteri.forEach((c) => { voti[c.key] = defaultVal; });
                setDraft((prev) => {
                  const next = { ...prev, voti, note: '' };
                  persistDraft(next);
                  return next;
                });
              }}
              disabled={saving}
            >
              <RotateCcw /> Azzera
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground hidden sm:block">
                <span className="font-semibold text-foreground tabular-nums">{myEvaluated.length}</span>
                <span className="text-muted-foreground"> / {allCfs.length} valutati</span>
                <span className="text-muted-foreground"> · {myProgressPct}%</span>
              </span>
              <Button
                onClick={() => setShowConfirm(true)}
                disabled={!allSet || saving}
                className="min-w-[180px]"
              >
                {saving ? 'Salvataggio…' : savedFlash ? <><Check /> Salvato</> : <><Check /> Salva e prossimo <ChevronRight /></>}
              </Button>
            </div>
          </footer>
        </section>

        {/* RIGHT rail: commissari status + modalità */}
        <aside className="hidden xl:flex flex-col gap-3 sticky top-[68px]">
          <CadenzaCommissariStatus
            fase={fase}
            commissione={commissioni.find((c) => c.id === fase.commissioneId) ?? null}
            allCfs={allCfs}
            valutazioni={valutazioni}
          />
          {modo === 'sincrona' && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 text-primary-foreground-dark p-3 text-[11.5px] text-foreground leading-relaxed">
              <div className="flex items-center gap-2 mb-1 text-primary">
                <Music2 size={12} />
                <span className="font-mono uppercase tracking-wider text-[10px] font-semibold">
                  Modalità sincrona
                </span>
              </div>
              La valutazione passa al candidato successivo solo quando <strong>tutti</strong> i commissari hanno inviato.
            </div>
          )}
        </aside>
      </div>
    </section>
    </>
  );
}
