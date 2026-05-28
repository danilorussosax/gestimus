/**
 * CadenzaPresidentePanel.tsx — drop-in per PresidentePanel (Commissario.tsx).
 *
 * Stessi props della funzione PresidentePanel attualmente inline in
 * Commissario.tsx. Tutta la logica (handleStart, handleEnd con resolveAdmittedIds,
 * conferma "tutti i commissari hanno valutato") è preservata: cambia solo il
 * layer di presentazione (compatto, dashboard-style con KPI strip + cards fase
 * affiancate orizzontalmente).
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Play, Square, ChevronRight, Users, Flag, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { startFase, concludiFase } from '@/api/fase-runtime';
import type { FaseRecord } from '@/api/fasi';
import { resolveAdmittedIds } from '@/lib/admitted';
import { getCommissariIds } from '@/pages/commissario-utils';
import type {
  Concorso, Fase, Commissione, CandidatoFase, Candidato, Valutazione,
} from '@/types';

export interface CadenzaPresidentePanelProps {
  concorso: Concorso;
  fasi: Fase[];
  commissioni: Commissione[];
  candidatiFase: CandidatoFase[];
  /**
   * N121: candidati del concorso. Necessari per pre-calcolare il count
   * "disponibili" da assegnare al /start: prima dell'avvio `candidatiFase` è
   * vuoto (i record vengono creati dal server in auto-popola), quindi senza
   * questo prop il bottone "Avvia fase" resterebbe sempre disabilitato.
   */
  candidati: Candidato[];
  valutazioni: Valutazione[];
  onFaseChanged: () => void;
}

export function CadenzaPresidentePanel({
  concorso, fasi, commissioni, candidatiFase, candidati, valutazioni, onFaseChanged,
}: CadenzaPresidentePanelProps) {
  const { t } = useTranslation();
  const [confirmEndFaseId, setConfirmEndFaseId] = useState<string | null>(null);
  const [endChecked, setEndChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── KPI ─────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    let totCand = 0, totValutati = 0, presieduteAttive = 0;
    for (const f of fasi) {
      const cfs = candidatiFase.filter((cf) => cf.faseId === f.id);
      const comm = commissioni.find((c) => c.id === f.commissioneId);
      const commIds = getCommissariIds(comm);
      totCand += cfs.length;
      totValutati += cfs.filter((cf) =>
        commIds.every((cid) => valutazioni.some((v) => v.candidatoFaseId === cf.id && v.commissarioId === cid)),
      ).length;
      if (f.stato === 'IN_CORSO') presieduteAttive++;
    }
    const pct = totCand > 0 ? Math.round((totValutati / totCand) * 100) : 0;
    return {
      fasiTotali: fasi.length,
      fasiAttive: presieduteAttive,
      candidatiTotali: totCand,
      valutati: totValutati,
      pctComplete: pct,
    };
  }, [fasi, candidatiFase, valutazioni, commissioni]);

  async function handleStart(faseId: string) {
    setSaving(true);
    try {
      await startFase(faseId);
      toast.success(t('com.pres.phase_started', { defaultValue: 'Fase avviata' }));
      onFaseChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '?');
    } finally {
      setSaving(false);
    }
  }

  async function handleEnd(faseId: string) {
    if (!endChecked) {
      toast.warning(t('com.pres.end_checkbox_required', { defaultValue: 'Conferma richiesta' }));
      return;
    }
    setSaving(true);
    try {
      const faseRec = fasi.find((f) => f.id === faseId);
      const admitted = faseRec
        ? await resolveAdmittedIds(faseRec as unknown as FaseRecord, concorso)
        : null;
      await concludiFase(faseId, admitted ?? undefined);
      toast.success(t('com.pres.phase_ended', { defaultValue: 'Fase conclusa' }));
      setConfirmEndFaseId(null);
      setEndChecked(false);
      onFaseChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '?');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="w-full">
      {/* Context strip */}
      <div className="flex items-center justify-between gap-4 py-2 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
            Controllo sessione
          </span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <h1 className="font-bold text-[18px] tracking-tight truncate">{concorso.nome}</h1>
        </div>
        <Badge variant="default" className="gap-1.5">
          <Users size={11} /> Presidente di commissione
        </Badge>
      </div>

      {/* KPI strip */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Fasi attive"      value={kpi.fasiAttive}      hint={`su ${kpi.fasiTotali} totali`} accent="primary" />
        <KpiTile label="Candidati totali" value={kpi.candidatiTotali} hint="su tutte le fasi"             accent="amber" />
        <KpiTile label="Valutati"         value={kpi.valutati}        hint="completi su tutti i criteri"   accent="emerald" />
        <KpiTile label="Completamento"    value={`${kpi.pctComplete}%`} hint="media fasi"                   accent="info" />
      </div>

      {/* Fasi timeline */}
      <h2 className="mt-6 mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
        Programma · {fasi.length} fasi
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {[...fasi].sort((a, b) => a.ordine - b.ordine).map((f) => (
          <FaseCard
            key={f.id}
            fase={f}
            concorsoAnonimo={concorso.anonimo}
            commissione={commissioni.find((c) => c.id === f.commissioneId) ?? null}
            candidatiFase={candidatiFase.filter((cf) => cf.faseId === f.id)}
            candidatiConcorso={candidati}
            valutazioni={valutazioni}
            confirmingEnd={confirmEndFaseId === f.id}
            endChecked={endChecked}
            saving={saving}
            onStart={() => handleStart(f.id)}
            onAskEnd={() => { setConfirmEndFaseId(f.id); setEndChecked(false); }}
            onConfirmEnd={() => handleEnd(f.id)}
            onCancelEnd={() => { setConfirmEndFaseId(null); setEndChecked(false); }}
            onToggleChecked={(v) => setEndChecked(v)}
          />
        ))}
      </div>
    </section>
  );
}

// ── KPI tile ────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, hint, accent,
}: {
  label: string; value: number | string; hint: string;
  accent: 'primary' | 'amber' | 'emerald' | 'info';
}) {
  const stripe = {
    primary: 'bg-primary',
    amber:   'bg-amber-400',
    emerald: 'bg-emerald-600',
    info:    'bg-sky-500',
  }[accent];
  return (
    <div className="relative bg-card border border-border rounded-xl px-4 py-3 shadow-xs overflow-hidden">
      <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', stripe)} />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{label}</span>
      <div className="font-bold text-[28px] leading-none mt-1 tabular-nums tracking-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

// ── Fase card ───────────────────────────────────────────────────────────────

interface FaseCardProps {
  fase: Fase;
  concorsoAnonimo: boolean;
  commissione: Commissione | null;
  candidatiFase: CandidatoFase[];
  candidatiConcorso: Candidato[];
  valutazioni: Valutazione[];
  confirmingEnd: boolean;
  endChecked: boolean;
  saving: boolean;
  onStart: () => void;
  onAskEnd: () => void;
  onConfirmEnd: () => void;
  onCancelEnd: () => void;
  onToggleChecked: (v: boolean) => void;
}

function FaseCard({
  fase, commissione, candidatiFase, candidatiConcorso, valutazioni,
  confirmingEnd, endChecked, saving,
  onStart, onAskEnd, onConfirmEnd, onCancelEnd, onToggleChecked,
}: FaseCardProps) {
  const isPlanned = fase.stato === 'PIANIFICATA';
  const isRunning = fase.stato === 'IN_CORSO';
  const isDone = fase.stato === 'CONCLUSA';

  const commIds = useMemo(() => commissione?.commissari ?? [], [commissione]);
  // N121: pre-start `candidatiFase` è vuoto (popolato dal server in /start) →
  // come proxy del "ci saranno candidati su cui votare" usiamo i candidati del
  // concorso filtrati per le sezioni della fase (lo stesso filtro che il
  // server applica in auto-popola, sezioneId IN fase.sezioniIds, con
  // fallback all-concorso quando la fase è globale).
  const availablePreStart = useMemo(() => {
    if (fase.sezioniIds && fase.sezioniIds.length > 0) {
      const set = new Set(fase.sezioniIds);
      return candidatiConcorso.filter((c) => c.sezioneId != null && set.has(c.sezioneId)).length;
    }
    return candidatiConcorso.length;
  }, [candidatiConcorso, fase.sezioniIds]);
  // Per i KPI/avanzamento usiamo i `candidati_fase` reali (solo dopo lo start),
  // mentre per `canStart` ci serve la stima pre-start. `total` rappresenta il
  // numero "atteso" sulla card: pre-start = pool disponibile, post-start = pool
  // effettivo.
  const total = isPlanned ? availablePreStart : candidatiFase.length;

  const fullyVoted = useMemo(() => candidatiFase.filter((cf) =>
    commIds.every((cid) => valutazioni.some((v) => v.candidatoFaseId === cf.id && v.commissarioId === cid)),
  ).length, [candidatiFase, commIds, valutazioni]);

  const partial = useMemo(() => candidatiFase.filter((cf) =>
    valutazioni.some((v) => v.candidatoFaseId === cf.id),
  ).length - fullyVoted, [candidatiFase, valutazioni, fullyVoted]);

  const passed = candidatiFase.filter((cf) => cf.ammessoProssimaFase).length;

  const numCriteri = Array.isArray(fase.criteri) && fase.criteri.length > 0
    ? fase.criteri.length
    : 4;
  const canStart = numCriteri > 0 && commIds.length > 0 && total > 0;
  const allFullyVoted = total > 0 && fullyVoted === total;

  const stateBadge =
    isRunning ? <Badge variant="success" className="uppercase tracking-wider gap-1.5">
                  <span className="relative w-1.5 h-1.5">
                    <span className="absolute inset-0 rounded-full bg-current opacity-30 animate-ping" />
                    <span className="absolute inset-0 rounded-full bg-current" />
                  </span>
                  In corso
                </Badge>
    : isDone   ? <Badge variant="muted" className="uppercase tracking-wider">Conclusa</Badge>
    :            <Badge variant="warning" className="uppercase tracking-wider">Programmata</Badge>;

  const nodeColor =
    isDone    ? 'bg-primary text-primary-foreground' :
    isRunning ? 'bg-amber-400 text-amber-950' :
                'bg-secondary text-muted-foreground border border-border';

  return (
    <article className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-xs overflow-hidden',
      isRunning && 'border-amber-400 shadow-[0_8px_20px_-12px_rgba(184,137,58,.4)]',
    )}>
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-7 h-7 rounded-full grid place-items-center font-bold tabular-nums text-[13px]', nodeColor)}>
            {fase.ordine}
          </div>
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium block">
              Fase {fase.ordine}
            </span>
            <h3 className="font-bold text-[16px] tracking-tight leading-tight truncate">{fase.nome}</h3>
          </div>
        </div>
        {stateBadge}
      </header>

      <dl className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-border">
        {[
          { label: 'Iscritti', value: total },
          { label: 'Ammessi', value: passed || (fase.ammessi ?? '—') },
          { label: 'Scala',   value: `/${fase.scala}` },
          { label: 'Tempo',   value: fase.tempoMinuti != null ? `${fase.tempoMinuti}′` : '—' },
        ].map((s) => (
          <div key={s.label}>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{s.label}</dt>
            <dd className="font-bold text-[17px] mt-0.5 tabular-nums tracking-tight">{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* Avanzamento (solo se IN_CORSO) */}
      {isRunning && total > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="font-mono uppercase tracking-[0.14em] text-muted-foreground font-medium">Avanzamento</span>
            <span className="text-foreground font-semibold tabular-nums">
              {fullyVoted}/{total} <span className="text-muted-foreground font-normal">({Math.round((fullyVoted / total) * 100)}%)</span>
            </span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden flex">
            <div className="bg-emerald-600" style={{ width: `${(fullyVoted / total) * 100}%` }} />
            <div className="bg-amber-500" style={{ width: `${(partial / total) * 100}%` }} />
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
          Mod. {fase.modoValutazione ?? 'autonoma'}
        </span>

        {isPlanned && (
          <Button size="sm" disabled={!canStart || saving} onClick={onStart} className="gap-1.5">
            <Play /> Avvia fase
          </Button>
        )}
        {isRunning && !confirmingEnd && (
          <Button
            size="sm"
            variant={allFullyVoted ? 'default' : 'outline'}
            disabled={saving}
            onClick={onAskEnd}
            className="gap-1.5"
          >
            <Square /> Concludi
          </Button>
        )}
        {isDone && (
          <Button size="sm" variant="ghost" className="gap-1">
            Esiti <ChevronRight />
          </Button>
        )}
      </footer>

      {/* Conferma conclusione */}
      {isRunning && confirmingEnd && (
        <div className="px-4 pb-4 border-t border-border bg-muted/40">
          <p className="text-[12.5px] text-foreground mt-3 mb-2 leading-relaxed">
            La fase verrà conclusa e gli ammessi calcolati con il tie-break configurato.
            {!allFullyVoted && (
              <span className="block mt-1 text-amber-700 dark:text-amber-400">
                ⚠ Non tutti i commissari hanno completato le valutazioni ({fullyVoted}/{total}).
              </span>
            )}
          </p>
          <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card cursor-pointer text-[12px] mb-2">
            <Checkbox checked={endChecked} onCheckedChange={(v) => onToggleChecked(!!v)} />
            <span>Confermo la conclusione della fase</span>
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onCancelEnd}>Annulla</Button>
            <Button size="sm" disabled={!endChecked || saving} onClick={onConfirmEnd} className="flex-1">
              <Square /> Concludi fase
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
