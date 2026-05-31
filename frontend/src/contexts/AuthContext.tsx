import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { HttpError } from '@/lib/api';
import { setSentryUser } from '@/lib/sentry';
import type { Role, User } from '@/types';

/** Un errore di /auth/me è "non autenticato" solo se è un HttpError 401/403.
 *  Qualsiasi altro caso (5xx, oppure rete/CORS → fetch lancia un TypeError
 *  senza `.status`) è un guasto server e NON va trattato come logout. */
function isUnauthenticatedError(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 401 || err.status === 403);
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  /** Step 1 del login. La sessione cookie viene emessa dal backend; se l'account
   *  ha il 2FA attivo torna { kind:'mfa', challenge } e va completato lo step 2. */
  loginWithCredentials: (
    email: string,
    password: string,
  ) => Promise<{ kind: 'ok'; user: User } | { kind: 'mfa'; challenge: string }>;
  /** Step 2: verifica il codice 2FA, completa la sessione e popola l'utente. */
  completeMfaLogin: (challenge: string, code: string) => Promise<User>;
  refreshUser: () => Promise<User | null>;
  logout: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context colocato col provider
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  const { t } = useTranslation();

  // Bootstrap: la sessione vive in un cookie HttpOnly, quindi proviamo sempre
  // GET /auth/me al mount. 401/403 → nessuna sessione (utente anonimo); un
  // guasto server (5xx/rete) NON deve buttare fuori un utente potenzialmente
  // loggato: lo logghiamo invece di mascherarlo da "logout".
  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.me();
      setState({ user, loading: false });
      return user;
    } catch (err) {
      if (!isUnauthenticatedError(err)) {
        // 5xx / rete / CORS: senza /auth/me non conosciamo l'identità, ma non
        // è un logout. Segnaliamo l'errore invece di silenziarlo.
        console.error('[auth] caricamento sessione fallito (guasto server):', err);
      }
      setState({ user: null, loading: false });
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const loginWithCredentials = useCallback<AuthContextValue['loginWithCredentials']>(
    async (email, password) => {
      const res = await authApi.login(email, password);
      if ('mfaRequired' in res) {
        return { kind: 'mfa', challenge: res.challenge };
      }
      // Sessione emessa (cookie già impostato): carica il profilo da /auth/me.
      // Se /auth/me fallisce per un guasto server (5xx/rete) il login è in
      // realtà riuscito, quindi solleviamo un errore chiaro invece di propagare
      // l'errore grezzo che farebbe sembrare fallito anche il login.
      let user: User;
      try {
        user = await authApi.me();
      } catch (err) {
        if (isUnauthenticatedError(err)) throw err;
        throw new Error(
          t('auth.login_ok_session_failed', {
            defaultValue:
              'Accesso riuscito, ma il caricamento della sessione è fallito. Ricarica la pagina.',
          }),
          { cause: err },
        );
      }
      setState({ user, loading: false });
      return { kind: 'ok', user };
    },
    [t],
  );

  const completeMfaLogin = useCallback<AuthContextValue['completeMfaLogin']>(
    async (challenge, code) => {
      await authApi.verifyTotp(challenge, code);
      const user = await authApi.me();
      setState({ user, loading: false });
      return user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* pulizia locale comunque */
    }
    setState({ user: null, loading: false });
  }, []);

  // Listener globale 'auth:expired' (emesso da lib/api.ts su 401): forza il
  // logout locale senza chiamata di rete, l'utente viene rediretto a /login.
  useEffect(() => {
    const handler = () => {
      setState((prev) => {
        // Notifica solo se c'era davvero una sessione attiva: evita toast
        // duplicati se l'evento viene emesso più volte (es. richieste 401
        // in parallelo) o quando l'utente è già anonimo.
        if (prev.user) {
          toast.error(
            t('auth.session_expired', {
              defaultValue: 'Sessione scaduta. Effettua di nuovo il login.',
            }),
          );
        }
        return { user: null, loading: false };
      });
    };
    window.addEventListener('auth:expired', handler);
    return () => {
      window.removeEventListener('auth:expired', handler);
    };
  }, [t]);

  // Sentry user scope (id anonimizzato via SHA-256 in setSentryUser). No-op senza DSN.
  useEffect(() => {
    setSentryUser(state.user ? { id: state.user.id, role: state.user.role } : null);
  }, [state.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: Boolean(state.user),
      hasRole: (...roles) => Boolean(state.user && roles.includes(state.user.role)),
      loginWithCredentials,
      completeMfaLogin,
      refreshUser,
      logout,
    }),
    [state, loginWithCredentials, completeMfaLogin, refreshUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocato col provider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
