/**
 * api/fase-runtime.ts
 *
 * Wraps the timer + runtime endpoints for a fase:
 *   GET  /api/fasi/:id/runtime
 *   POST /api/fasi/:id/start          (fase lifecycle)
 *   POST /api/fasi/:id/conclude       (fase lifecycle)
 *   POST /api/fasi/:id/timer/start
 *   POST /api/fasi/:id/timer/pause
 *   POST /api/fasi/:id/timer/resume
 *   POST /api/fasi/:id/timer/bonus
 *   POST /api/fasi/:id/timer/reset
 *   SSE  GET /realtime/fase/:id
 *
 * The `FaseRuntimeRecord` returned by `getFaseRuntime` extends the shared
 * `FaseRuntime` type with `tempoMinuti` and `serverNow` (used for clock-skew
 * correction, matching the server response described in fasi.ts).
 */

import { http } from '@/lib/api';
import type { Fase, FaseRuntime } from '@/types';

// ── Extended runtime record (as returned by GET /fasi/:id/runtime) ──────────

export interface FaseRuntimeRecord extends FaseRuntime {
  tempoMinuti: number | null;
  serverNow: number; // epoch ms from server — used to correct client clock skew
}

// ── SSE event payload emitted by the server via pg_notify ───────────────────

export interface FaseSSEPayload {
  action:
    | 'start'
    | 'conclude'
    | 'timer.start'
    | 'timer.pause'
    | 'timer.resume'
    | 'timer.reset'
    | 'timer.bonus';
  faseId: string;
  startedAt?: string;
  tempoMinuti?: number | null;
  at?: string;
  candidatoFaseId?: string | null;
  seconds?: number;
}

// ── REST helpers ─────────────────────────────────────────────────────────────

/** Fetch the current timer runtime state for a fase. */
export function getFaseRuntime(faseId: string): Promise<FaseRuntimeRecord> {
  return http.get<FaseRuntimeRecord>(`fasi/${faseId}/runtime`);
}

/** Transition a fase from PIANIFICATA → IN_CORSO. */
export function startFase(faseId: string): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/start`);
}

/**
 * Transition a fase from IN_CORSO → CONCLUSA.
 * `admitted` is the list of candidatoFase IDs that are admitted to the next
 * fase; if omitted the server keeps the existing flag (retro-compat).
 */
export function concludiFase(faseId: string, admitted?: string[]): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/conclude`, admitted !== undefined ? { admitted } : {});
}

/**
 * Start (or restart) the per-candidate timer for a fase.
 * `candidatoFaseId` is optional — when provided the server validates that it
 * belongs to the fase (N87 guard).
 */
export function startFaseTimer(faseId: string, candidatoFaseId?: string): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/timer/start`, candidatoFaseId ? { candidatoFaseId } : {});
}

/** Pause the running timer. Returns 409 if not running or already paused. */
export function pauseFaseTimer(faseId: string): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/timer/pause`);
}

/** Resume the paused timer (adjusts timerStartedAt by pause duration). */
export function resumeFaseTimer(faseId: string): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/timer/resume`);
}

/**
 * Add bonus seconds to the running timer (capped at 86400 s by the server).
 * The vanilla app uses 60 s (+1 min button).
 */
export function addFaseTimerBonus(faseId: string, seconds: number): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/timer/bonus`, { seconds });
}

/** Reset the timer (clears timerStartedAt / timerPausedAt / bonus). */
export function resetFaseTimer(faseId: string): Promise<Fase> {
  return http.post<Fase>(`fasi/${faseId}/timer/reset`);
}

// ── SSE subscription helper ──────────────────────────────────────────────────

/**
 * Open a Server-Sent Events stream for `faseId` and call `onChange` whenever
 * the server pushes a `FaseSSEPayload`.  Credentials are sent automatically
 * because the browser includes cookies on same-origin requests.
 *
 * Returns a cleanup function that closes the EventSource.
 *
 * Usage:
 *   const unsub = subscribeFaseRuntime(faseId, (payload) => { ... });
 *   // later:
 *   unsub();
 */
export function subscribeFaseRuntime(
  faseId: string,
  onChange: (payload: FaseSSEPayload) => void,
): () => void {
  // EventSource uses GET, credentials are attached via cookies (same-origin).
  const es = new EventSource(`/realtime/fase/${faseId}`, { withCredentials: true });

  es.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data as string) as FaseSSEPayload;
      onChange(payload);
    } catch {
      // malformed JSON — ignore
    }
  };

  // SSE errors (network drop, 401) — EventSource will auto-reconnect unless
  // we explicitly close. We leave the auto-reconnect in place; consumers
  // react to state derived from payloads rather than connection state.
  es.onerror = () => {
    // intentionally silent — EventSource handles reconnect
  };

  return () => {
    es.close();
  };
}
