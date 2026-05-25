import { describe, it, expect } from 'vitest';
import {
  getPresidenteForCommissione,
  getPresidenteForFase,
  isPresidenteDiQualcheCommissione,
  getPresidenteForConcorso,
  presidentiFor,
  getPresidenteForFinale,
  type CommissioneLike,
  type CommissarioLike,
  type FaseLike,
} from '@/lib/presidenti';

const commissari: CommissarioLike[] = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];

const commissioni: CommissioneLike[] = [
  { id: 'comm1', concorsoId: 'k1', presidenteCommissarioId: 'm1' },
  { id: 'comm2', concorsoId: 'k1', presidenteCommissarioId: 'm1' },
  { id: 'comm3', concorsoId: 'k1', presidenteCommissarioId: 'm2' },
  { id: 'comm4', concorsoId: 'k2', presidenteCommissarioId: null },
];

describe('getPresidenteForCommissione', () => {
  it('per id commissione → commissario presidente', () => {
    expect(getPresidenteForCommissione('comm1', commissioni, commissari)).toEqual({ id: 'm1' });
  });
  it('per oggetto commissione', () => {
    expect(getPresidenteForCommissione(commissioni[2], commissioni, commissari)).toEqual({ id: 'm2' });
  });
  it('commissione senza presidente → null', () => {
    expect(getPresidenteForCommissione('comm4', commissioni, commissari)).toBeNull();
  });
  it('commissione inesistente → null', () => {
    expect(getPresidenteForCommissione('nope', commissioni, commissari)).toBeNull();
  });
  it('null/undefined → null', () => {
    expect(getPresidenteForCommissione(null, commissioni, commissari)).toBeNull();
    expect(getPresidenteForCommissione(undefined, commissioni, commissari)).toBeNull();
  });
  it('presidente non presente nei commissari → null', () => {
    const comm = [{ id: 'cx', concorsoId: 'k1', presidenteCommissarioId: 'ghost' }];
    expect(getPresidenteForCommissione('cx', comm, commissari)).toBeNull();
  });
});

describe('getPresidenteForFase', () => {
  it('fase con commissioneId → presidente di quella commissione', () => {
    const fase: FaseLike & { commissioneId: string } = { concorsoId: 'k1', commissioneId: 'comm3', ordine: 1 };
    expect(getPresidenteForFase(fase, commissioni, commissari)).toEqual({ id: 'm2' });
  });
  it('fase senza commissioneId → null', () => {
    expect(getPresidenteForFase({ concorsoId: 'k1', commissioneId: null, ordine: 1 }, commissioni, commissari)).toBeNull();
  });
  it('fase null → null', () => {
    expect(getPresidenteForFase(null, commissioni, commissari)).toBeNull();
  });
});

describe('isPresidenteDiQualcheCommissione', () => {
  it('true se presidente di almeno una', () => {
    expect(isPresidenteDiQualcheCommissione('m1', commissioni)).toBe(true);
    expect(isPresidenteDiQualcheCommissione('m2', commissioni)).toBe(true);
  });
  it('false se non presidente di nessuna', () => {
    expect(isPresidenteDiQualcheCommissione('m3', commissioni)).toBe(false);
  });
});

describe('getPresidenteForConcorso', () => {
  it('null se più presidenti distinti', () => {
    expect(getPresidenteForConcorso('k1', commissioni, commissari)).toBeNull();
  });
  it('un unico presidente convergente → quel commissario', () => {
    const comm: CommissioneLike[] = [
      { id: 'a', concorsoId: 'kx', presidenteCommissarioId: 'm1' },
      { id: 'b', concorsoId: 'kx', presidenteCommissarioId: 'm1' },
    ];
    expect(getPresidenteForConcorso('kx', comm, commissari)).toEqual({ id: 'm1' });
  });
  it('nessuna commissione con presidente → null', () => {
    expect(getPresidenteForConcorso('k2', commissioni, commissari)).toBeNull();
  });
});

describe('presidentiFor', () => {
  it('una entry per presidente distinto con le sue commissioni', () => {
    const result = presidentiFor('k1', commissioni, commissari);
    expect(result).toHaveLength(2);
    const m1Entry = result.find((r) => r.presidente.id === 'm1')!;
    expect(m1Entry.commissioni.map((c) => c.id).sort()).toEqual(['comm1', 'comm2']);
    const m2Entry = result.find((r) => r.presidente.id === 'm2')!;
    expect(m2Entry.commissioni.map((c) => c.id)).toEqual(['comm3']);
  });
  it('scarta presidenti non risolti nei commissari', () => {
    const comm: CommissioneLike[] = [{ id: 'x', concorsoId: 'k9', presidenteCommissarioId: 'ghost' }];
    expect(presidentiFor('k9', comm, commissari)).toEqual([]);
  });
  it('concorso senza commissioni → []', () => {
    expect(presidentiFor('zzz', commissioni, commissari)).toEqual([]);
  });
});

describe('getPresidenteForFinale', () => {
  const fasi: FaseLike[] = [
    { concorsoId: 'k1', commissioneId: 'comm1', ordine: 1 },
    { concorsoId: 'k1', commissioneId: 'comm3', ordine: 5 }, // ordine max
    { concorsoId: 'k1', commissioneId: 'comm2', ordine: 3 },
  ];
  it('presidente della commissione della fase con ordine massimo', () => {
    // ordine 5 → comm3 → m2
    expect(getPresidenteForFinale('k1', commissioni, commissari, fasi)).toEqual({ id: 'm2' });
  });
  it('ordini con buchi: prende comunque il massimo', () => {
    const f: FaseLike[] = [
      { concorsoId: 'k1', commissioneId: 'comm1', ordine: 2 },
      { concorsoId: 'k1', commissioneId: 'comm3', ordine: 10 },
    ];
    expect(getPresidenteForFinale('k1', commissioni, commissari, f)).toEqual({ id: 'm2' });
  });
  it('nessuna fase del concorso → null', () => {
    expect(getPresidenteForFinale('vuoto', commissioni, commissari, fasi)).toBeNull();
  });
});
