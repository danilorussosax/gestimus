/**
 * api/platform.ts — Superadmin multi-tenant console API.
 *
 * Routes backend: server/src/routes/platform.ts
 * Base path: /api/platform/*  (solo su subdomain super-admin, cookie-auth)
 *
 * Tutti gli endpoint richiedono auth + ruolo superadmin.
 * Il backend restituisce 404 da altri subdomain (requirePlatformContext).
 */

import { http } from '@/lib/api';

// ─── Tipi locali ─────────────────────────────────────────────────────────────

export const TENANT_STATES = ['attivo', 'sospeso', 'archiviato'] as const;
export const TENANT_PLANS = ['trial', 'starter', 'pro', 'ultra', 'ppe'] as const;
export type TenantStato = (typeof TENANT_STATES)[number];
export type TenantPiano = (typeof TENANT_PLANS)[number];

/** Shape pubblica del tenant (publicTenant() nel backend). */
export interface Tenant {
  id: string;
  slug: string;
  nome: string;
  dominio: string | null;
  stato: TenantStato;
  piano: TenantPiano;
  pianoScadenza: string | null;
  note: string | null;
  archiviatoAt: string | null;
  cleanupAfterDays: number;
  cleanupScheduledAt: string | null;
  require2faAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Conteggi entità per tenant (/tenants/:id/stats). */
export interface TenantStats {
  tenantId: string;
  concorsi: number;
  commissari: number;
  candidati: number;
  iscrizioni: number;
  accounts: number;
  diskUsageBytes: number;
}

/** Stato SMTP tenant (senza password). */
export interface TenantSmtp {
  configured: boolean;
  encrypted?: boolean;
}

/** Snapshot sistema Node + host (/system). */
export interface SystemSnapshot {
  memory: { rss: number; heapUsed: number; heapTotal: number };
  cpu: {
    cores: number;
    processPct: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
  };
  uptimeSec: number;
}

/** Un campione storico delle risorse processo (serie 24h, /system/history). */
export interface SystemSample {
  ts: number; // epoch ms
  rssMb: number;
  heapUsedMb: number;
  cpuPct: number;
  loadAvg1: number;
}

export interface SystemHistory {
  samples: SystemSample[];
  intervalMs: number;
  maxHours: number;
}

/** Aggregato runtime per-tenant (/runtime). */
export interface TenantRuntime {
  reqCountMin: number;
  reqPerSec: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  errorRate: number;
  lastSeenSec: number;
}

export interface RuntimeMetrics {
  tenants: Record<string, TenantRuntime>;
  generatedAt: string;
}

/** Riga audit log (/audit). */
export interface AuditRow {
  id: string;
  action: string;
  targetTenantId: string | null;
  targetTenantSlug: string | null;
  payload: unknown;
  ip: string | null;
  createdAt: string;
}

/** Override limiti per-tenant (tenant_config). */
export interface TenantConfig {
  tenantId: string;
  maxConcorsi: number | null;
  maxCommissari: number | null;
  maxCandidatiPerConcorso: number | null;
  updatedAt: string;
}

/** Singolo backup pre-hard-delete. */
export interface BackupEntry {
  filename: string;
  tenantSlug: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** Configurazione piattaforma singleton. */
export interface PlatformConfig {
  id: number;
  require2faSuperadmin: boolean;
  defaultCleanupDays: number;
  updatedAt: string;
}

// ─── Body types ──────────────────────────────────────────────────────────────

export interface CreateTenantBody {
  slug: string;
  nome: string;
  piano: TenantPiano;
  pianoScadenza?: string | null;
  dominio?: string | null;
  note?: string | null;
  cleanupAfterDays?: number;
  require2faAdmin?: boolean;
  adminEmail: string;
  adminPassword: string;
}

export interface UpdateTenantBody {
  nome?: string;
  piano?: TenantPiano;
  pianoScadenza?: string | null;
  dominio?: string | null;
  note?: string | null;
  cleanupAfterDays?: number;
  require2faAdmin?: boolean;
}

export interface ChangePlanBody {
  piano: TenantPiano;
  pianoScadenza?: string | null;
  overrides?: {
    maxConcorsi?: number | null;
    maxCommissari?: number | null;
    maxCandidatiPerConcorso?: number | null;
  };
}

export interface SmtpBody {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  password: string;
  from: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

const BASE = '/api/platform';

export const platformApi = {
  // ── Tenants ────────────────────────────────────────────────────────────────

  /** GET /api/platform/tenants?stato=all&includePlatform=false */
  listTenants: (params?: { stato?: TenantStato | 'all'; includePlatform?: boolean }) =>
    http.get<Tenant[]>(`${BASE}/tenants`, params),

  /** GET /api/platform/tenants/:id */
  getTenant: (id: string) => http.get<Tenant>(`${BASE}/tenants/${id}`),

  /** GET /api/platform/tenants/:id/stats */
  getTenantStats: (id: string) => http.get<TenantStats>(`${BASE}/tenants/${id}/stats`),

  /** POST /api/platform/tenants */
  createTenant: (body: CreateTenantBody) => http.post<Tenant>(`${BASE}/tenants`, body),

  /** PATCH /api/platform/tenants/:id */
  updateTenant: (id: string, body: UpdateTenantBody) =>
    http.patch<Tenant>(`${BASE}/tenants/${id}`, body),

  /** POST /api/platform/tenants/:id/suspend */
  suspendTenant: (id: string) => http.post<Tenant>(`${BASE}/tenants/${id}/suspend`),

  /** POST /api/platform/tenants/:id/reactivate */
  reactivateTenant: (id: string) => http.post<Tenant>(`${BASE}/tenants/${id}/reactivate`),

  /** POST /api/platform/tenants/:id/archive */
  archiveTenant: (id: string, cleanupAfterDays?: number) =>
    http.post<Tenant>(`${BASE}/tenants/${id}/archive`, cleanupAfterDays != null ? { cleanupAfterDays } : undefined),

  /** POST /api/platform/tenants/:id/restore */
  restoreTenant: (id: string) => http.post<Tenant>(`${BASE}/tenants/${id}/restore`),

  /** DELETE /api/platform/tenants/:id — hard-delete immediato. */
  deleteTenant: (id: string) => http.del<void>(`${BASE}/tenants/${id}`),

  /** POST /api/platform/tenants/:id/change-plan */
  changePlan: (id: string, body: ChangePlanBody) =>
    http.post<Tenant>(`${BASE}/tenants/${id}/change-plan`, body),

  // ── Config tenant + SMTP ───────────────────────────────────────────────────

  /** GET /api/platform/tenants/:id/config */
  getTenantConfig: (id: string) => http.get<TenantConfig | null>(`${BASE}/tenants/${id}/config`),

  /** GET /api/platform/tenants/:id/smtp */
  getTenantSmtp: (id: string) => http.get<TenantSmtp>(`${BASE}/tenants/${id}/smtp`),

  /** PUT /api/platform/tenants/:id/smtp */
  setTenantSmtp: (id: string, body: SmtpBody) =>
    http.put<{ ok: boolean }>(`${BASE}/tenants/${id}/smtp`, body),

  /** DELETE /api/platform/tenants/:id/smtp */
  deleteTenantSmtp: (id: string) => http.del<{ ok: boolean }>(`${BASE}/tenants/${id}/smtp`),

  // ── Sistema + runtime ──────────────────────────────────────────────────────

  /** GET /api/platform/system — snapshot risorse Node (200ms CPU sample). */
  getSystem: () => http.get<SystemSnapshot>(`${BASE}/system`),

  /** Serie temporale 24h di RAM/CPU del processo (card super-admin). */
  getSystemHistory: () => http.get<SystemHistory>(`${BASE}/system/history`),

  /** GET /api/platform/runtime — aggregato per-tenant sliding 60s. */
  getRuntime: () => http.get<RuntimeMetrics>(`${BASE}/runtime`),

  // ── Audit + backup ─────────────────────────────────────────────────────────

  /** GET /api/platform/audit */
  getAudit: (params?: {
    limit?: number;
    before?: string;
    action?: string;
    tenantId?: string;
  }) => http.get<AuditRow[]>(`${BASE}/audit`, params),

  /** GET /api/platform/backups */
  listBackups: () => http.get<BackupEntry[]>(`${BASE}/backups`),

  /** POST /api/platform/jobs/cleanup-tenants */
  runCleanup: () => http.post(`${BASE}/jobs/cleanup-tenants`),

  // ── Platform config ────────────────────────────────────────────────────────

  /** GET /api/platform/config */
  getConfig: () => http.get<PlatformConfig | null>(`${BASE}/config`),

  /** PATCH /api/platform/config */
  updateConfig: (body: { require2faSuperadmin?: boolean; defaultCleanupDays?: number }) =>
    http.patch<PlatformConfig | null>(`${BASE}/config`, body),
};
