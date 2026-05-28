/**
 * CadenzaRailTimer.tsx — timer del candidato corrente come card nel rail.
 *
 * Drop-in replacement per FloatingTimer (vecchia .fixed bottom-6 right-6).
 * Logica invariata:
 *   - usa useFaseRuntime per timer/SSE
 *   - se isPresidente, mostra controlli (pause/resume/+1min/reset) e
 *     fa auto-start sul cambio di candidatoFaseId
 *   - beep all'esaurimento (deduplicato per faseId)
 */

import { useEffect, useRef } from 'react';
import { Pause, Play, Plus, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useFaseRuntime } from '@/hooks/useFaseRuntime';
import {
  startFaseTimer, pauseFaseTimer, resumeFaseTimer,
  addFaseTimerBonus, resetFaseTimer,
} from '@/api/fase-runtime';

interface Props {
  faseId: string;
  isPresidente: boolean;
  candidatoFaseId?: string | null;
  /** Durata totale fase (per il calcolo del ring di progresso). */
  tempoMinuti: number;
}

function fmt(ms: number): string {
  const tot = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.06;
    osc.start(); osc.stop(ctx.currentTime + 0.18);
  } catch { /* no audio */ }
}

export function CadenzaRailTimer({ faseId, isPresidente, candidatoFaseId, tempoMinuti }: Props) {
  const { t } = useTranslation();
  const { timer, refetch } = useFaseRuntime(faseId);
  const beepedRef = useRef<string | null>(null);
  const qc = useQueryClient();

  // Auto-start del timer quando cambia il candidato (solo presidente).
  useEffect(() => {
    if (!isPresidente || !candidatoFaseId) return;
    void startFaseTimer(faseId, candidatoFaseId).then(() => refetch()).catch(() => { /* noop */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faseId, candidatoFaseId, isPresidente]);

  // Beep una sola volta a scadenza.
  useEffect(() => {
    if (!timer.expired || !timer.hasState) return;
    const k = `${faseId}:expired`;
    if (beepedRef.current === k) return;
    beepedRef.current = k;
    beep();
  }, [timer.expired, timer.hasState, faseId]);

  async function timerAction(action: 'pause' | 'resume' | 'bonus' | 'reset') {
    try {
      if (action === 'pause') await pauseFaseTimer(faseId);
      else if (action === 'resume') await resumeFaseTimer(faseId);
      else if (action === 'bonus') await addFaseTimerBonus(faseId, 60);
      else if (action === 'reset') {
        await resetFaseTimer(faseId);
        beepedRef.current = null;
      }
      void qc.invalidateQueries({ queryKey: ['fase-runtime', faseId] });
      void refetch();
    } catch (err) {
      toast.error(t('com.timer.action_error', {
        defaultValue: 'Azione timer fallita',
        msg: err instanceof Error ? err.message : '?',
      }));
    }
  }

  // Ring di progresso
  const totalMs = tempoMinuti * 60 * 1000;
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, (timer.remainingMs / totalMs) * 100)) : 0;
  const r = 38, c = 2 * Math.PI * r;
  const dash = c * (pct / 100);

  // Colore stato (urgente <1m, warning <5m)
  const tone =
    timer.remainingMs <= 60_000 ? 'urgent' :
    timer.remainingMs <= 5 * 60_000 ? 'warn' : 'ok';
  const ringClass =
    tone === 'urgent' ? 'stroke-destructive' :
    tone === 'warn'   ? 'stroke-amber-500'   : 'stroke-primary';
  const numClass =
    tone === 'urgent' ? 'text-destructive' :
    tone === 'warn'   ? 'text-amber-700'   : 'text-foreground';

  const statusLabel = !timer.hasState
    ? t('com.timer.no_state', { defaultValue: 'In attesa' })
    : timer.expired ? t('com.timer.expired', { defaultValue: 'Scaduto' })
    : timer.paused  ? t('com.timer.paused',  { defaultValue: 'In pausa' })
    :                 t('com.timer.running', { defaultValue: 'In esecuzione' });

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-xs p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
          {t('com.timer.label', { defaultValue: 'Timer fase' })} · {tempoMinuti}′
        </span>
        {timer.hasState && !timer.paused && !timer.expired && (
          <Badge variant="default" className="h-5 px-2 text-[10px] uppercase tracking-wider">
            Live
          </Badge>
        )}
        {timer.paused && (
          <Badge variant="warning" className="h-5 px-2 text-[10px] uppercase tracking-wider">
            Pausa
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-[88px] h-[88px] shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96" aria-hidden>
            <circle cx="48" cy="48" r={r} fill="none" className="stroke-border" strokeWidth="4" />
            <circle
              cx="48" cy="48" r={r} fill="none"
              className={cn('transition-all duration-300', ringClass)}
              strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground font-medium">
                {statusLabel}
              </div>
              <div className={cn('font-bold text-[24px] leading-none mt-0.5 tabular-nums tracking-tight', numClass)}>
                {fmt(timer.remainingMs)}
              </div>
            </div>
          </div>
        </div>

        {isPresidente && (
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <Button
              size="sm"
              variant={timer.paused ? 'default' : 'secondary'}
              className="h-7 px-2 text-[11px]"
              onClick={() => timerAction(timer.paused ? 'resume' : 'pause')}
            >
              {timer.paused ? <Play /> : <Pause />}
              {timer.paused ? t('com.timer.resume', { defaultValue: 'Riprendi' })
                             : t('com.timer.pause',  { defaultValue: 'Pausa' })}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => timerAction('bonus')}>
              <Plus /> +1 min
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => timerAction('reset')}>
              <RotateCcw /> Reset
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
