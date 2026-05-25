import { useCallback, useEffect, useState } from 'react';

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

function getFsElement(): Element | null {
  const d = document as FullscreenDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? d.msFullscreenElement ?? null;
}

export function useFullscreen(target?: HTMLElement | null) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => !!getFsElement());

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!getFsElement());
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    document.addEventListener('msfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
      document.removeEventListener('msfullscreenchange', handler);
    };
  }, []);

  const enter = useCallback(async () => {
    const el = (target ?? document.documentElement) as FullscreenElement;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen) await el.msRequestFullscreen();
    } catch {
      /* user may have denied */
    }
  }, [target]);

  const exit = useCallback(async () => {
    const d = document as FullscreenDocument;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      else if (d.msExitFullscreen) await d.msExitFullscreen();
    } catch {
      /* noop */
    }
  }, []);

  const toggle = useCallback(() => {
    if (isFullscreen) void exit();
    else void enter();
  }, [isFullscreen, enter, exit]);

  return { isFullscreen, enter, exit, toggle };
}

/**
 * Returns true when the user has been idle (no mouse / key / touch input) for the given timeout.
 */
export function useIdle(ms: number, enabled = true) {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: number | undefined;
    const reset = () => {
      setIdle(false);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIdle(true);
      }, ms);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => {
      window.addEventListener(e, reset, { passive: true });
    });
    reset();
    return () => {
      events.forEach((e) => {
        window.removeEventListener(e, reset);
      });
      if (timer) window.clearTimeout(timer);
    };
  }, [ms, enabled]);

  return idle;
}
