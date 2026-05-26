import type { Candidato } from '@/types';

export function hhmm(s: string | null | undefined) {
  return s ? s.slice(0, 5) : '';
}

export function fmtDay(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  } catch {
    return iso;
  }
}

/** Nome visualizzato del candidato (individuale vs gruppo/orchestra). */
export function displayName(cand: Candidato | null | undefined): string {
  if (!cand) return '—';
  if (cand.tipo === 'gruppo' || cand.tipo === 'orchestra') return cand.nome || '—';
  return `${cand.nome} ${cand.cognome ?? ''}`.trim() || '—';
}

export function publicCalUrl(token: string, display = false) {
  // Router path-based (React Router), non hash: /calendario?token=…[&display=1]
  return `${window.location.origin}/calendario?token=${encodeURIComponent(token)}${display ? '&display=1' : ''}`;
}

export const SALA_NONE = '__none__';
