/**
 * Catalogo piani SaaS Gestimus — single source of truth (port di js/piani.js).
 * Usato dalla UI super-admin (badge, KPI revenue, modali create/edit/cambio piano).
 * Prezzi IVA inclusa (22%); limiti inclusivi del numero indicato.
 */
import type { TenantPiano } from '@/api/platform';

export interface PianoInfo {
  key: TenantPiano;
  nome: string;
  descrizione: string;
  prezzo: number; // canone annuo in EUR (0 per trial/ppe)
  durata_giorni: number | null; // null = pay-as-you-go / nessuna scadenza
  limit_concorsi: number | null; // null = illimitato
  limit_iscritti_annui: number | null; // null = illimitato
  badge_color: string;
  is_ppe: boolean;
  ppe_setup_per_concorso?: number;
  ppe_per_iscritto?: number;
  featured?: boolean;
}

export const PIANI: Record<TenantPiano, PianoInfo> = {
  trial: {
    key: 'trial',
    nome: 'Trial gratuito',
    descrizione: 'Demo a tempo: 30 giorni per provare il sistema senza impegno.',
    prezzo: 0,
    durata_giorni: 30,
    limit_concorsi: 1,
    limit_iscritti_annui: 5,
    badge_color: 'sky',
    is_ppe: false,
  },
  starter: {
    key: 'starter',
    nome: 'Starter',
    descrizione: "Per chi organizza un paio di concorsi piccoli all'anno.",
    prezzo: 150,
    durata_giorni: 365,
    limit_concorsi: 2,
    limit_iscritti_annui: 100,
    badge_color: 'emerald',
    is_ppe: false,
  },
  pro: {
    key: 'pro',
    nome: 'Pro',
    descrizione:
      'Il piano consigliato — miglior rapporto qualità/prezzo per scuole e conservatori medi.',
    prezzo: 230,
    durata_giorni: 365,
    limit_concorsi: 5,
    limit_iscritti_annui: 500,
    badge_color: 'brand',
    is_ppe: false,
    featured: true,
  },
  ultra: {
    key: 'ultra',
    nome: 'Ultra',
    descrizione: "Volumi alti, fino a 10 concorsi e 2000 iscritti l'anno.",
    prezzo: 350,
    durata_giorni: 365,
    limit_concorsi: 10,
    limit_iscritti_annui: 2000,
    badge_color: 'amber',
    is_ppe: false,
  },
  ppe: {
    key: 'ppe',
    nome: 'Pay-per-Event',
    descrizione:
      'Niente canone: €100 setup per ogni concorso attivato + €1 per ogni iscritto (persona fisica: un quartetto = 4 iscritti).',
    prezzo: 0,
    durata_giorni: null,
    limit_concorsi: null,
    limit_iscritti_annui: null,
    badge_color: 'slate',
    is_ppe: true,
    ppe_setup_per_concorso: 100,
    ppe_per_iscritto: 1,
  },
};

export function getPianoOrDefault(key: string | null | undefined): PianoInfo {
  return PIANI[(key ?? '') as TenantPiano] ?? PIANI.trial;
}

/** Etichetta prezzo human-readable (gestisce PPE e gratis). */
export function pianoPriceLabel(key: string | null | undefined): string {
  const p = getPianoOrDefault(key);
  if (p.is_ppe) {
    return `€${p.ppe_setup_per_concorso}/concorso + €${(p.ppe_per_iscritto ?? 0).toFixed(2)}/iscr`;
  }
  if (p.prezzo === 0) return 'Gratis';
  return `€${p.prezzo}/anno`;
}

/** Etichetta durata (per le anteprime piano). */
export function pianoDurataLabel(key: string | null | undefined): string {
  const p = getPianoOrDefault(key);
  if (p.durata_giorni == null) return 'Pay-as-you-go (nessuna scadenza)';
  return `${p.durata_giorni} giorni`;
}
