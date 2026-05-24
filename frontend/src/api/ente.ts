/**
 * api/ente.ts — Lettura/aggiornamento impostazioni ente + branding.
 *
 * Routes backend: server/src/routes/ente.ts
 * Base path: /api/ente
 *
 * Il backend espone:
 *   GET  /ente          → settings completi (auth richiesta)
 *   PATCH /ente         → merge su enteSettings (solo admin)
 *   GET  /ente/public   → branding pubblico (no auth — usato per login page)
 *   PATCH /ente/branding → merge su brandingPublic (solo admin)
 */

import { http } from '@/lib/api';

// ─── Tipi locali ─────────────────────────────────────────────────────────────

export interface EnteSettings {
  denominazione?: string;
  sede?: string;
  codiceFiscale?: string;
  partitaIva?: string;
  telefono?: string;
  email?: string;
  pec?: string;
  sitoWeb?: string;
  note?: string;
}

export interface BrandingPublic {
  nomePubblico?: string;
  sottotitolo?: string;
  /** dataURL base64 o URL esterno. Cap ~1MB. */
  logoUrl?: string;
  coloreAccent?: string;
  coloreSfondo?: string;
}

export interface EnteResponse {
  id: string;
  slug: string;
  nome: string;
  dominio: string | null;
  piano: string | null;
  enteSettings: EnteSettings | null;
  brandingPublic: BrandingPublic | null;
}

export interface EntePublicResponse {
  slug: string;
  nome: string;
  brandingPublic: BrandingPublic | null;
  configured?: boolean;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const enteApi = {
  /** GET /ente — settings completi del tenant (auth). */
  getEnte: () => http.get<EnteResponse>('ente'),

  /** PATCH /ente — merge su enteSettings (admin). */
  updateEnte: (body: EnteSettings) => http.patch<{ ok: boolean }>('ente', body),

  /** GET /ente/public — branding pubblico (no auth). */
  getEntePublic: () => http.get<EntePublicResponse>('/api/ente/public'),

  /**
   * PATCH /ente/branding — merge su brandingPublic (admin).
   * logoUrl: dataURL base64 inline (PNG/WebP) o URL esterno, max ~1MB chars.
   */
  updateBranding: (body: BrandingPublic) =>
    http.patch<{ ok: boolean }>('ente/branding', body),
};
