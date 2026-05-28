/**
 * CadenzaScoreLane.tsx — score input compatto, single-row.
 *
 * Track graduata con drag/click che imposta il voto step-by-step
 * (scoring.voteStep(scala)). Sostituisce il vecchio <input type="range" .vote-range>
 * mantenendo step semantics + accessibilità keyboard.
 */

import { useRef, useState, useCallback, useId } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: number;
  scala: number;
  step: number;
  /** Min value (0 for scale ≥30, 1 otherwise — Gestimus convention). */
  min?: number;
  onChange: (next: number) => void;
  /** Label letta dagli screen reader (es. "Tecnica"). */
  ariaLabel: string;
  /** Disabilita interazione (es. mentre `saving`). */
  disabled?: boolean;
}

export function CadenzaScoreLane({
  value, scala, step, min = 1, onChange, ariaLabel, disabled,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();

  const ratioFromX = useCallback((clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  const snap = useCallback((raw: number): number => {
    const steps = Math.round((raw - min) / step);
    const clamped = Math.max(0, Math.min(Math.round((scala - min) / step), steps));
    return min + clamped * step;
  }, [scala, step, min]);

  const setFromEvent = useCallback((e: PointerEvent | React.PointerEvent) => {
    const ratio = ratioFromX(e.clientX);
    const raw = min + ratio * (scala - min);
    onChange(snap(raw));
  }, [ratioFromX, scala, min, onChange, snap]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setFromEvent(e);
    const move = (ev: PointerEvent) => setFromEvent(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setHover(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (disabled) return;
    const ratio = ratioFromX(e.clientX);
    setHover(snap(min + ratio * (scala - min)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    let next = value;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = scala;
    else if (e.key === 'PageDown') next = value - step * 5;
    else if (e.key === 'PageUp') next = value + step * 5;
    else return;
    e.preventDefault();
    onChange(Math.max(min, Math.min(scala, Math.round(next / step) * step)));
  };

  const pct = ((value - min) / (scala - min)) * 100;
  const hovPct = hover != null ? ((hover - min) / (scala - min)) * 100 : 0;
  const majors: number[] = [];
  // major ticks every ~scala/5
  const tickStep = Math.max(1, Math.round((scala - min) / 5));
  for (let t = min; t <= scala; t += tickStep) majors.push(t);
  if (majors[majors.length - 1] !== scala) majors.push(scala);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={scala}
      aria-valuenow={value}
      id={id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      className={cn(
        'relative h-7 cursor-pointer select-none rounded-md outline-hidden',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {/* track */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-secondary border border-border" />
      {/* fill */}
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary/30 transition-[width] duration-100"
        style={{ width: `${pct}%` }}
      />
      {/* major ticks */}
      {majors.map((t) => (
        <div
          key={t}
          className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-muted-foreground/40"
          style={{ left: `${((t - min) / (scala - min)) * 100}%` }}
        >
          <span className="absolute top-3.5 left-1/2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground tabular-nums">
            {t}
          </span>
        </div>
      ))}
      {/* hover ghost */}
      {hover != null && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-background border border-muted-foreground -translate-x-1/2 opacity-50 pointer-events-none"
          style={{ left: `${hovPct}%` }}
        />
      )}
      {/* thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-background border-[2px] border-primary shadow-xs transition-[left] duration-150 pointer-events-none"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
