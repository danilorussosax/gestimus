/**
 * useFaseRuntime.ts
 *
 * React hook that:
 *   1. Fetches the initial runtime state via GET /fasi/:id/runtime.
 *   2. Subscribes to the SSE stream (/realtime/fase/:id) and re-fetches on
 *      every relevant timer event so the component always has fresh DB state.
 *   3. Derives the client-side countdown state on every tick (250 ms).
 *   4. Cleans up the EventSource and interval on unmount / faseId change.
 *
 * The hook is intentionally read-only — timer control actions (pause/resume/
 * bonus/reset) are invoked directly by callers using the functions from
 * api/fase-runtime.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getFaseRuntime,
  subscribeFaseRuntime,
  type FaseRuntimeRecord,
  type FaseSSEPayload,
} from '@/api/fase-runtime';

// ── Derived countdown state ──────────────────────────────────────────────────

export interface TimerState {
  /** Milliseconds remaining (clamped to 0). */
  remainingMs: number;
  /** Total duration in milliseconds (tempoMinuti * 60 * 1000). */
  durationMs: number;
  paused: boolean;
  expired: boolean;
  /** False until the first fetch completes. */
  hasState: boolean;
}

// ── Hook return value ────────────────────────────────────────────────────────

export interface UseFaseRuntimeResult {
  /** Raw DB record (null until loaded). */
  runtime: FaseRuntimeRecord | null;
  /** Derived live countdown — updated every 250 ms. */
  timer: TimerState;
  /** True while the initial fetch is in progress. */
  loading: boolean;
  /** Non-null if the initial fetch failed. */
  error: Error | null;
  /** Manually trigger a re-fetch (useful after performing a timer action). */
  refetch: () => void;
}

// ── Clock-skew correction ────────────────────────────────────────────────────
// M219: the server returns `serverNow` (epoch ms) alongside the runtime so the
// client can compute the offset and correct its countdown for clock drift.

function computeSkewOffset(record: FaseRuntimeRecord): number {
  return record.serverNow - Date.now();
}

// ── Derive countdown from runtime record ────────────────────────────────────

function deriveTimer(record: FaseRuntimeRecord | null, skewOffset: number): TimerState {
  if (!record?.timerStartedAt) {
    return { remainingMs: 0, durationMs: 0, paused: false, expired: false, hasState: !!record };
  }
  const startedMs = new Date(record.timerStartedAt).getTime();
  const durMs = (Number(record.tempoMinuti) || 0) * 60 * 1000;
  const paused = !!record.timerPausedAt;
  const nowMs = Date.now() + skewOffset;
  const elapsedMs = paused
    ? new Date(record.timerPausedAt ?? 0).getTime() - startedMs
    : nowMs - startedMs;
  const bonusMs = (Number(record.timerBonusSeconds) || 0) * 1000;
  const remainingMs = Math.max(0, durMs + bonusMs - elapsedMs);
  return {
    remainingMs,
    durationMs: durMs,
    paused,
    expired: remainingMs === 0,
    hasState: true,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFaseRuntime(faseId: string | null | undefined): UseFaseRuntimeResult {
  const [runtime, setRuntime] = useState<FaseRuntimeRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [timer, setTimer] = useState<TimerState>({
    remainingMs: 0,
    durationMs: 0,
    paused: false,
    expired: false,
    hasState: false,
  });

  // Ref to the latest skew offset — updated on every successful fetch.
  const skewRef = useRef<number>(0);
  // Ref to the latest runtime — used inside the tick interval without
  // needing it as a dependency (avoids tearing down/re-creating interval).
  const runtimeRef = useRef<FaseRuntimeRecord | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const doFetch = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const rec = await getFaseRuntime(id);
      skewRef.current = computeSkewOffset(rec);
      runtimeRef.current = rec;
      setRuntime(rec);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    if (faseId) void doFetch(faseId);
  }, [faseId, doFetch]);

  // ── Initial fetch + SSE subscription ─────────────────────────────────────

  useEffect(() => {
    if (!faseId) {
      setRuntime(null);
      runtimeRef.current = null;
      setLoading(false);
      setError(null);
      return;
    }

    void doFetch(faseId);

    // Subscribe to SSE and re-fetch on every timer-related event.
    const unsub = subscribeFaseRuntime(faseId, (payload: FaseSSEPayload) => {
      // Re-fetch for any timer event so our local state is in sync with DB.
      if (
        payload.action === 'timer.start' ||
        payload.action === 'timer.pause' ||
        payload.action === 'timer.resume' ||
        payload.action === 'timer.reset' ||
        payload.action === 'timer.bonus' ||
        payload.action === 'start' ||
        payload.action === 'conclude'
      ) {
        void doFetch(faseId);
      }
    });

    return () => {
      unsub();
    };
  }, [faseId, doFetch]);

  // ── Tick interval (250 ms) ─────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => {
      setTimer(deriveTimer(runtimeRef.current, skewRef.current));
    }, 250);
    return () => clearInterval(id);
  }, []); // runs once — reads from refs

  // Also update timer immediately whenever runtime changes (no wait for next tick)
  useEffect(() => {
    runtimeRef.current = runtime;
    setTimer(deriveTimer(runtime, skewRef.current));
  }, [runtime]);

  return { runtime, timer, loading, error, refetch };
}
