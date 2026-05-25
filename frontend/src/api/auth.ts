import { http } from '@/lib/api';
import type { LoginResponse, LoginSession, User } from '@/types';

export interface TotpSetupResponse {
  secret: string;
  /** URI otpauth:// da scansionare o inserire manualmente nell'app. */
  uri: string;
  /** Data-URL PNG del QR code, se il server lo genera (opzionale). */
  qrCode?: string;
}

export const authApi = {
  /** POST /auth/login → { mfaRequired, challenge } | LoginSession. */
  login: (email: string, password: string) =>
    http.post<LoginResponse>('/auth/login', { email, password }),

  /** Step 2 (2FA): POST /auth/login/verify-totp con challenge + codice TOTP/recovery. */
  verifyTotp: (challenge: string, code: string) =>
    http.post<LoginSession>('/auth/login/verify-totp', { challenge, code }),

  /** GET /auth/me — utente loggato (404/401 se sessione assente). */
  me: () => http.get<User>('/auth/me'),

  /** POST /auth/logout — invalida la sessione server-side + cancella cookie. */
  logout: () => http.post<{ ok: boolean }>('/auth/logout'),

  // ───── Gestione 2FA per l'account autenticato ─────

  /**
   * POST /auth/totp/setup — genera il secret pendente, ritorna { secret, uri }.
   * Non attiva ancora il 2FA: serve chiamare totpEnable con un codice valido.
   */
  totpSetup: () => http.post<TotpSetupResponse>('/auth/totp/setup'),

  /**
   * POST /auth/totp/enable { code } — verifica il codice, attiva il 2FA e
   * ritorna i recovery code IN CHIARO una sola volta.
   */
  totpEnable: (code: string) =>
    http.post<{ ok: boolean; recoveryCodes: string[] }>('/auth/totp/enable', { code }),

  /**
   * POST /auth/totp/disable { password } — disattiva il 2FA previa riconferma
   * della password corrente.
   */
  totpDisable: (password: string) =>
    http.post<{ ok: boolean }>('/auth/totp/disable', { password }),
};
