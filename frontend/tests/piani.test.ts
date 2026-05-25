import { describe, it, expect } from 'vitest';
import { PIANI, getPianoOrDefault, pianoPriceLabel, pianoDurataLabel } from '@/lib/piani';

describe('PIANI — catalogo', () => {
  it('contiene tutte le chiavi piano attese', () => {
    expect(Object.keys(PIANI).sort()).toEqual(['ppe', 'pro', 'starter', 'trial', 'ultra']);
  });
  it('ogni piano ha key coerente con la chiave del record', () => {
    for (const [k, p] of Object.entries(PIANI)) {
      expect(p.key).toBe(k);
    }
  });
  it('pro è il piano consigliato (featured)', () => {
    expect(PIANI.pro.featured).toBe(true);
  });
  it('ppe è pay-per-event con setup e per-iscritto', () => {
    expect(PIANI.ppe.is_ppe).toBe(true);
    expect(PIANI.ppe.ppe_setup_per_concorso).toBe(100);
    expect(PIANI.ppe.ppe_per_iscritto).toBe(1);
    expect(PIANI.ppe.durata_giorni).toBeNull();
  });
});

describe('getPianoOrDefault', () => {
  it('chiave valida → quel piano', () => {
    expect(getPianoOrDefault('pro')).toBe(PIANI.pro);
  });
  it('chiave sconosciuta → trial', () => {
    expect(getPianoOrDefault('inesistente')).toBe(PIANI.trial);
  });
  it('null/undefined → trial', () => {
    expect(getPianoOrDefault(null)).toBe(PIANI.trial);
    expect(getPianoOrDefault(undefined)).toBe(PIANI.trial);
  });
  it('stringa vuota → trial', () => {
    expect(getPianoOrDefault('')).toBe(PIANI.trial);
  });
});

describe('pianoPriceLabel', () => {
  it('piano a canone', () => {
    expect(pianoPriceLabel('starter')).toBe('€150/anno');
    expect(pianoPriceLabel('pro')).toBe('€230/anno');
  });
  it('piano gratis (trial)', () => {
    expect(pianoPriceLabel('trial')).toBe('Gratis');
  });
  it('ppe → label setup + per iscritto', () => {
    expect(pianoPriceLabel('ppe')).toBe('€100/concorso + €1.00/iscr');
  });
  it('chiave sconosciuta → fallback trial (Gratis)', () => {
    expect(pianoPriceLabel('xxx')).toBe('Gratis');
  });
});

describe('pianoDurataLabel', () => {
  it('piano a durata fissa', () => {
    expect(pianoDurataLabel('pro')).toBe('365 giorni');
    expect(pianoDurataLabel('trial')).toBe('30 giorni');
  });
  it('ppe → pay-as-you-go', () => {
    expect(pianoDurataLabel('ppe')).toBe('Pay-as-you-go (nessuna scadenza)');
  });
});
