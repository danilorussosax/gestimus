// =============================================================================
// test-utils — render harness condiviso per i component test.
//
// Avvolge il componente sotto test negli STESSI provider dell'app reale
// (vedi src/main.tsx): QueryClientProvider + Router + AuthProvider + i18n.
// Differenze volute rispetto a main.tsx:
//   - QueryClient fresco per ogni render con retry:false (test deterministici);
//   - MemoryRouter al posto di BrowserRouter (controllo della rotta iniziale,
//     niente jsdom history globale condivisa tra i test);
//   - AuthProvider iniettabile: o quello REALE (default, guidato da MSW via
//     GET /auth/me) oppure un context value finto per testare consumer che
//     dipendono da useAuth() senza toccare la rete.
//   - ThemeProvider/MotionConfig/ErrorBoundary omessi: non servono al rendering
//     dei componenti e aggiungono solo rumore. Aggiungili qui se un test ne ha
//     bisogno.
//
// USO:
//   import { render, screen, userEvent } from '../test-utils';
//   render(<Login />);                                   // anonimo, rotta '/'
//   render(<X />, { route: '/admin/utenti' });           // rotta iniziale
//   render(<X />, { auth: { user: fakeAdmin } });         // auth finta iniettata
// =============================================================================
import { type ContextType, type ReactElement, type ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';

import { AuthContext, AuthProvider } from '@/contexts/AuthContext';
import i18n from '@/i18n';
import type { User } from '@/types';

// AuthContextValue non è esportato da src/contexts/AuthContext: lo ricaviamo
// dal tipo del context (è `AuthContextValue | undefined`).
type AuthContextValue = NonNullable<ContextType<typeof AuthContext>>;

/**
 * Stato auth iniettabile. Si fornisce un `user` (o null) e, opzionalmente,
 * override delle funzioni del context per spiarne le chiamate. Se `auth` NON
 * è passato, viene usato l'AuthProvider REALE (l'utente arriva da GET /auth/me
 * mockato via MSW — di default 401 → anonimo).
 */
export interface MockAuthOptions {
  user?: User | null;
  loading?: boolean;
  overrides?: Partial<AuthContextValue>;
}

export interface AppRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Rotta iniziale del MemoryRouter (default '/'). */
  route?: string;
  /** Se presente, inietta un AuthContext finto invece del provider reale. */
  auth?: MockAuthOptions;
  /** Permette di riusare lo stesso QueryClient tra render (default: fresco). */
  queryClient?: QueryClient;
}

/** QueryClient deterministico per i test: nessun retry, nessun refetch. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Costruisce un AuthContextValue finto a partire da MockAuthOptions. */
function buildMockAuth(opts: MockAuthOptions): AuthContextValue {
  const user = opts.user ?? null;
  const noopUser = async () => user;
  return {
    user,
    loading: opts.loading ?? false,
    isAuthenticated: Boolean(user),
    hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
    loginWithCredentials: async () =>
      user ? { kind: 'ok', user } : Promise.reject(new Error('mock: no user')),
    completeMfaLogin: async () =>
      user ? user : Promise.reject(new Error('mock: no user')),
    refreshUser: noopUser,
    logout: async () => undefined,
    ...opts.overrides,
  };
}

/** Provider di auth: reale (default) oppure context finto iniettato. */
function AuthWrapper({ auth, children }: { auth?: MockAuthOptions; children: ReactNode }) {
  if (auth) {
    return <AuthContext.Provider value={buildMockAuth(auth)}>{children}</AuthContext.Provider>;
  }
  return <AuthProvider>{children}</AuthProvider>;
}

/**
 * render() custom: monta `ui` dentro lo stack provider dell'app.
 * Ritorna il risultato di Testing Library + il `queryClient` usato.
 */
export function render(ui: ReactElement, options: AppRenderOptions = {}) {
  const { route = '/', auth, queryClient = makeTestQueryClient(), ...rtlOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[route]}>
            <AuthWrapper auth={auth}>{children}</AuthWrapper>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>
    );
  }

  return {
    ...rtlRender(ui, { wrapper: Wrapper, ...rtlOptions }),
    queryClient,
  };
}

// Re-export di tutto Testing Library + userEvent così i test importano da qui.
export * from '@testing-library/react';
export { userEvent };
