// Proof test #1 — Login + flusso 2FA (src/pages/auth/Login.tsx + TotpStep).
// Usa l'AuthProvider REALE: loginWithCredentials/completeMfaLogin colpiscono
// davvero gli endpoint /auth/* mockati con MSW. Asserzioni su ruoli/label
// accessibili, non su dettagli implementativi.
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import Login from '@/pages/auth/Login';
import { render, screen, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';
import { mockSession, authedMeHandler } from '../msw/handlers';

describe('Login page', () => {
  beforeEach(() => {
    // L'AuthProvider reale fa GET /auth/me al mount: lasciamolo a 401 (anonimo,
    // baseline) così la pagina di login resta montata.
  });

  it('renders the login form with accessible email/password fields and submit', () => {
    render(<Login />);

    // Heading accessibile della card di login ("Bentornato").
    expect(screen.getByRole('heading', { name: /bentornato/i })).toBeInTheDocument();
    // Campi via label accessibile (le <label> avvolgono gli input).
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accedi/i })).toBeInTheDocument();
  });

  it('advances to the 2FA / TOTP step when login returns an MFA challenge', async () => {
    const user = userEvent.setup();

    // POST /auth/login → richiede 2FA. Verifichiamo anche che riceva le credenziali.
    let receivedBody: { email?: string; password?: string } = {};
    server.use(
      http.post('*/auth/login', async ({ request }) => {
        receivedBody = (await request.json()) as typeof receivedBody;
        return HttpResponse.json({ mfaRequired: true, challenge: 'chal_42' });
      }),
    );

    render(<Login />);

    await user.type(screen.getByLabelText(/email/i), 'admin@esempio.it');
    await user.type(screen.getByLabelText(/password/i), 'segreta123');
    await user.click(screen.getByRole('button', { name: /accedi/i }));

    // La UI deve avanzare allo step TOTP: appare il titolo "Verifica in due passaggi"
    // e il campo Codice. La password non deve più essere presente.
    expect(
      await screen.findByRole('heading', { name: /verifica in due passaggi/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/codice/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    // Le credenziali sono state inviate al backend (trim incluso).
    expect(receivedBody).toEqual({ email: 'admin@esempio.it', password: 'segreta123' });
  });

  it('shows an error alert on invalid credentials', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json(
          { error: 'invalid credentials', code: 'INVALID_CREDENTIALS' },
          { status: 401 },
        ),
      ),
    );

    render(<Login />);
    await user.type(screen.getByLabelText(/email/i), 'admin@esempio.it');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /accedi/i }));

    // role="alert" è renderizzato dal componente al fallimento del login.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/email o password errati|credenziali/i);
  });

  it('completes 2FA: typing a TOTP code and submitting verifies via the API', async () => {
    const user = userEvent.setup();
    let verifyCalled = false;

    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({ mfaRequired: true, challenge: 'chal_42' }),
      ),
      http.post('*/auth/login/verify-totp', async () => {
        verifyCalled = true;
        return HttpResponse.json(mockSession);
      }),
      // dopo verify, AuthContext chiama GET /auth/me → utente loggato.
      authedMeHandler(),
    );

    render(<Login />);
    await user.type(screen.getByLabelText(/email/i), 'admin@esempio.it');
    await user.type(screen.getByLabelText(/password/i), 'segreta123');
    await user.click(screen.getByRole('button', { name: /accedi/i }));

    const codeInput = await screen.findByLabelText(/codice/i);
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: /verifica/i }));

    await waitFor(() => {
      expect(verifyCalled).toBe(true);
    });
  });
});
