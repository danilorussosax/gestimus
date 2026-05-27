// Component test — AccountSecurity (src/pages/AccountSecurity.tsx).
// Copre il flusso 2FA: setup → enable → recovery codes, disattivazione con
// conferma password, e un path d'errore (codice non valido).
//
// Auth iniettata via `auth: { user }` (nessuna rete per l'AuthProvider). Gli
// endpoint TOTP (/auth/totp/setup|enable|disable) sono mockati per-test con
// server.use(...). Asserzioni su label/role/testi accessibili (i18n pinned 'it').
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import AccountSecurity from '@/pages/AccountSecurity';
import { render, screen, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';
import { mockUser } from '../msw/handlers';

const adminNo2fa = { ...mockUser, totpEnabled: false };
const adminWith2fa = { ...mockUser, totpEnabled: true };

const SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Gestimus:admin@esempio.it?secret=JBSWY3DPEHPK3PXP&issuer=Gestimus',
  qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANS',
};
const RECOVERY = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'];

describe('AccountSecurity — 2FA', () => {
  it('mostra lo stato "Non attiva" e il pulsante per avviare il setup', () => {
    render(<AccountSecurity />, { auth: { user: adminNo2fa } });

    expect(
      screen.getByRole('heading', { name: /sicurezza account/i }),
    ).toBeInTheDocument();
    // Badge di stato: non attiva (testo esatto del badge, non la descrizione).
    expect(screen.getByText('Non attiva')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /attiva la verifica in due passaggi/i }),
    ).toBeInTheDocument();
  });

  it('flusso completo: setup → secret/QR + input codice → enable → recovery codes', async () => {
    const user = userEvent.setup();
    let enableBody: { code?: string } = {};

    server.use(
      http.post('*/auth/totp/setup', () => HttpResponse.json(SETUP)),
      http.post('*/auth/totp/enable', async ({ request }) => {
        enableBody = (await request.json()) as typeof enableBody;
        return HttpResponse.json({ ok: true, recoveryCodes: RECOVERY });
      }),
    );

    render(<AccountSecurity />, { auth: { user: adminNo2fa } });

    // 1) Avvia il setup.
    await user.click(
      screen.getByRole('button', { name: /attiva la verifica in due passaggi/i }),
    );

    // 2) La UI mostra il secret manuale, il QR e l'URI otpauth.
    expect(await screen.findByText(SETUP.secret)).toBeInTheDocument();
    const qr = screen.getByRole('img', { name: /qr code/i });
    expect(qr).toHaveAttribute('src', SETUP.qrCode);
    expect(screen.getByText(SETUP.uri)).toBeInTheDocument();

    // 3) Inserisce il codice a 6 cifre e attiva.
    const codeInput = screen.getByLabelText(/codice a 6 cifre/i);
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: /^attiva 2fa$/i }));

    // 4) I recovery codes vengono mostrati una volta sola dopo l'enable.
    expect(await screen.findByText(/verifica in due passaggi attivata/i)).toBeInTheDocument();
    for (const c of RECOVERY) {
      expect(screen.getByText(new RegExp(c))).toBeInTheDocument();
    }
    expect(screen.getByText(/non verranno mostrati di nuovo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ho salvato i codici/i })).toBeInTheDocument();

    // Il codice è stato inviato al backend (trimmato).
    expect(enableBody).toEqual({ code: '123456' });
  });

  it('path d\'errore: enable con codice non valido → alert, niente recovery codes', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('*/auth/totp/setup', () => HttpResponse.json(SETUP)),
      http.post('*/auth/totp/enable', () =>
        HttpResponse.json(
          { error: 'Codice non valido', code: 'INVALID_TOTP' },
          { status: 400 },
        ),
      ),
    );

    render(<AccountSecurity />, { auth: { user: adminNo2fa } });

    await user.click(
      screen.getByRole('button', { name: /attiva la verifica in due passaggi/i }),
    );
    await user.type(await screen.findByLabelText(/codice a 6 cifre/i), '000000');
    await user.click(screen.getByRole('button', { name: /^attiva 2fa$/i }));

    // Alert d'errore visibile.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/codice non valido/i);

    // 2FA NON attivata: restiamo nello step setup (input ancora presente) e i
    // recovery code / la conferma non compaiono.
    expect(screen.getByLabelText(/codice a 6 cifre/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/verifica in due passaggi attivata/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /ho salvato i codici/i }),
    ).not.toBeInTheDocument();
  });

  it('disattivazione: invia la password all\'endpoint disable e segnala il refresh utente', async () => {
    const user = userEvent.setup();
    let disableBody: { password?: string } = {};
    const refreshUser = vi.fn(async () => adminWith2fa);

    server.use(
      http.post('*/auth/totp/disable', async ({ request }) => {
        disableBody = (await request.json()) as typeof disableBody;
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<AccountSecurity />, {
      auth: { user: adminWith2fa, overrides: { refreshUser } },
    });

    // Con 2FA attiva: badge "Attiva" e form di disattivazione con conferma password.
    expect(screen.getByText(/^attiva$/i)).toBeInTheDocument();
    const pwd = screen.getByLabelText(/password/i);
    await user.type(pwd, 'segreta123');
    await user.click(screen.getByRole('button', { name: /disattiva 2fa/i }));

    // La conferma password è richiesta e inviata all'endpoint disable.
    await waitFor(() => {
      expect(disableBody).toEqual({ password: 'segreta123' });
    });
    // La UI riflette la disattivazione richiedendo il refresh dello stato utente.
    await waitFor(() => {
      expect(refreshUser).toHaveBeenCalled();
    });
  });

  it('disattivazione: password errata → alert e refresh NON invocato', async () => {
    const user = userEvent.setup();
    const refreshUser = vi.fn(async () => adminWith2fa);

    server.use(
      http.post('*/auth/totp/disable', () =>
        HttpResponse.json(
          { error: 'Password non valida', code: 'INVALID_PASSWORD' },
          { status: 400 },
        ),
      ),
    );

    render(<AccountSecurity />, {
      auth: { user: adminWith2fa, overrides: { refreshUser } },
    });

    await user.type(screen.getByLabelText(/password/i), 'sbagliata');
    await user.click(screen.getByRole('button', { name: /disattiva 2fa/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/password non valida/i);
    expect(refreshUser).not.toHaveBeenCalled();
  });
});
