// =============================================================================
// MSW request handlers — baseline mocks per il contratto API Gestimus.
//
// Il client HTTP (src/lib/api.ts) usa fetch su path relativi:
//   - path con '/' iniziale → usati verbatim (es. '/auth/login', '/auth/me');
//   - path senza '/' iniziale → prefissati con '/api' (es. '/api/concorsi').
// MSW intercetta su URL assoluti; in jsdom l'origin è http://localhost (vedi
// vitest.config). Usiamo path relativi (`*/...`) così i match restano agnostici
// rispetto all'host.
//
// COME ESTENDERE in un test:
//   import { server } from '../msw/server';
//   import { http, HttpResponse } from 'msw';
//   server.use(
//     http.post('*/auth/login', () => HttpResponse.json({ mfaRequired: true, challenge: 'c1' })),
//   );
// server.use(...) ha priorità sui baseline e viene azzerato da resetHandlers()
// (afterEach in tests/setup.ts), quindi ogni test parte pulito.
// =============================================================================
import { http, HttpResponse } from 'msw';
import type { LoginResponse, LoginSession, User } from '@/types';

/** Utente di default restituito da GET /auth/me. Override-abile nei test. */
export const mockUser: User = {
  id: 'usr_test_1',
  email: 'admin@esempio.it',
  role: 'admin',
  attivo: true,
  tenantId: 'tnt_test',
  commissarioId: null,
  totpEnabled: false,
};

/** Sessione di default per un login senza 2FA. */
export const mockSession: LoginSession = {
  account: {
    id: mockUser.id,
    email: mockUser.email,
    role: mockUser.role,
    tenantId: mockUser.tenantId,
  },
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

// Baseline: anonimo. Volutamente conservativo — la maggior parte dei test
// vuole partire da "nessuna sessione" e attivare l'auth esplicitamente con
// server.use(...). Per AuthProvider questo significa user=null (anonimo).
export const handlers = [
  // GET /auth/me — default: nessuna sessione (401). I test che vogliono un
  // utente loggato fanno override con server.use(authedMeHandler()).
  http.get('*/auth/me', () =>
    HttpResponse.json({ error: 'Non autenticato', code: 'UNAUTHORIZED' }, { status: 401 }),
  ),

  // POST /auth/login — default: credenziali valide, sessione emessa (no 2FA).
  http.post('*/auth/login', () => HttpResponse.json<LoginResponse>(mockSession)),

  // POST /auth/login/verify-totp — default: codice accettato.
  http.post('*/auth/login/verify-totp', () => HttpResponse.json<LoginSession>(mockSession)),

  // POST /auth/logout — default: ok.
  http.post('*/auth/logout', () => HttpResponse.json({ ok: true })),
];

// ─── Helper riusabili per gli override nei singoli test ──────────────────────

/** GET /auth/me che ritorna un utente loggato (override del baseline 401). */
export const authedMeHandler = (user: Partial<User> = {}) =>
  http.get('*/auth/me', () => HttpResponse.json<User>({ ...mockUser, ...user }));

/** POST /auth/login che richiede il 2FA, ritornando una challenge. */
export const mfaLoginHandler = (challenge = 'challenge_test') =>
  http.post('*/auth/login', () =>
    HttpResponse.json<LoginResponse>({ mfaRequired: true, challenge }),
  );
