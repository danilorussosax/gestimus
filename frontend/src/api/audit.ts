/**
 * api/audit.ts — Lettura audit log del tenant.
 *
 * Routes backend: server/src/routes/audit.ts
 * Base path: /api/audit-log
 *
 * Il server restituisce gli entry con RLS applicata al tenant corrente.
 * Ordinamento: desc createdAt.
 */

import { http } from '@/lib/api';
import type { AuditEntry, Paginated } from '@/types';

export interface AuditQuery {
  /** Max entry da restituire (default 200, max 1000). */
  limit?: number;
  /** Offset di paginazione (default 0). */
  offset?: number;
  /** Filtra per action esatta (es. 'account.create'). */
  action?: string;
  /** Filtra per actorAccountId (UUID). */
  actor?: string;
  /** ISO datetime: solo entry prima di questa data. */
  before?: string;
  /** ISO datetime: solo entry da questa data in poi. */
  after?: string;
}

export interface AuditStat {
  action: string;
  count: number;
}

export const auditApi = {
  /**
   * GET /audit-log?limit=&offset=&action=&actor=&before=&after=
   * Solo admin. Contratto paginato `{ items, total, limit, offset }`, entry
   * ordinate per createdAt desc.
   */
  list: (query?: AuditQuery) =>
    http.get<Paginated<AuditEntry>>('audit-log', query as Record<string, unknown>),

  /**
   * GET /audit-log/stats → conteggio per action negli ultimi 30gg.
   */
  stats: () => http.get<AuditStat[]>('audit-log/stats'),
};
