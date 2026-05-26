/**
 * api/accounts.ts — CRUD account tenant + reset password.
 *
 * Routes backend: server/src/routes/accounts.ts
 * Base path: /api/accounts
 */

import { http } from '@/lib/api';
import type { Account, Role } from '@/types';

// ─── Payload types ────────────────────────────────────────────────────────────

export interface AccountCreate {
  email: string;
  /** min 8, max 200 chars */
  password: string;
  role: Exclude<Role, 'superadmin'>;
  commissarioId?: string;
  attivo?: boolean;
}

export interface AccountUpdate {
  email?: string;
  role?: Exclude<Role, 'superadmin'>;
  attivo?: boolean;
  commissarioId?: string | null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const accountsApi = {
  /** GET /accounts → lista account del tenant (solo admin). */
  list: (opts?: { limit?: number; offset?: number }) =>
    http.get<Account[]>('accounts', opts),

  /** GET /accounts/:id */
  get: (id: string) => http.get<Account>(`accounts/${id}`),

  /** POST /accounts → crea account. */
  create: (body: AccountCreate) => http.post<Account>('accounts', body),

  /** PATCH /accounts/:id → aggiorna email/ruolo/attivo/commissarioId. */
  update: (id: string, body: AccountUpdate) =>
    http.patch<Account>(`accounts/${id}`, body),

  /**
   * POST /accounts/:id/reset-password { password } → nuova password.
   * Invalida tutte le sessioni attive dell'account.
   */
  resetPassword: (id: string, password: string) =>
    http.post<{ ok: boolean }>(`accounts/${id}/reset-password`, { password }),

  /** DELETE /accounts/:id → elimina account. */
  remove: (id: string) => http.del<undefined>(`accounts/${id}`),
};
