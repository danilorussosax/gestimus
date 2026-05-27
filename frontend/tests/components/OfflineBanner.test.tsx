// Proof test #2 — OfflineBanner (src/components/OfflineBanner.tsx).
// Componente "reale" e importante: avvisa l'utente quando la connettività cade.
// Dipende dall'hook useOnline (navigator.onLine + eventi online/offline) e da
// i18n. Asserzione su ruolo accessibile (role="status"), non su markup interno.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';

import { OfflineBanner } from '@/components/OfflineBanner';
import { render, screen, waitForElementToBeRemoved } from '../test-utils';

/** Imposta navigator.onLine e notifica l'app via evento, come farebbe il browser. */
function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

describe('OfflineBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not shown while the browser is online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OfflineBanner />);
    // role="status" + aria-live="polite" → niente banner quando online.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears with role="status" when connectivity drops, and hides on recovery', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OfflineBanner />);

    // Connettività persa → il banner di stato compare.
    setOnline(false);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();

    // Connettività ripristinata → il banner si smonta (dopo l'exit di
    // AnimatePresence, da cui il waitForElementToBeRemoved).
    setOnline(true);
    await waitForElementToBeRemoved(() => screen.queryByRole('status'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
