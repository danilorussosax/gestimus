import { describe, it, expect } from 'vitest';
import {
  suggerisciMetodo,
  prettyStato,
  iconaPerSezione,
  sharedValue,
  computeDrift,
  gruppoFasi,
} from '@/components/admin/fasi-utils';
import type { FaseRecord } from '@/api/fasi';
import type { SezioneRecord } from '@/api/sezioni';

// Fixture minimale: solo i campi letti dagli helper (id/ordine/sezioniIds +
// SHARED_FIELDS). Cast perché FaseRecord ha molti altri campi non rilevanti.
const fase = (p: Partial<FaseRecord>): FaseRecord =>
  ({
    id: 'f', ordine: 0, sezioniIds: [], scala: 10, metodoMedia: 'aritmetica',
    modoValutazione: 'autonoma', tempoMinuti: 0, commissioneId: null, pesi: null,
    ...p,
  }) as unknown as FaseRecord;

const sez = (id: string, nome: string): SezioneRecord => ({ id, nome }) as unknown as SezioneRecord;

describe('suggerisciMetodo', () => {
  it('soglie per numero commissari', () => {
    expect(suggerisciMetodo(0).metodo).toBe('aritmetica');
    expect(suggerisciMetodo(2).metodo).toBe('aritmetica');
    expect(suggerisciMetodo(3).metodo).toBe('mediana');
    expect(suggerisciMetodo(4).metodo).toBe('olimpica');
    expect(suggerisciMetodo(5).metodo).toBe('olimpica');
    expect(suggerisciMetodo(6).metodo).toBe('mediana');
    expect(suggerisciMetodo(7).metodo).toBe('mediana');
    expect(suggerisciMetodo(10).metodo).toBe('winsorizzata');
    expect(suggerisciMetodo(20).metodo).toBe('deviazione_std');
  });
});

describe('prettyStato', () => {
  it('sostituisce gli underscore con spazi', () => {
    expect(prettyStato('IN_CORSO')).toBe('IN CORSO');
    expect(prettyStato('PIANIFICATA')).toBe('PIANIFICATA');
  });
});

describe('iconaPerSezione', () => {
  it('deduce l\'emoji dalla categoria strumentale', () => {
    expect(iconaPerSezione('Violino')).toBe('🎻');
    expect(iconaPerSezione('Pianoforte')).toBe('🎹');
    expect(iconaPerSezione('Canto lirico')).toBe('🎤');
    expect(iconaPerSezione('Chitarra')).toBe('🎸');
    expect(iconaPerSezione(undefined)).toBe('🎵');
    expect(iconaPerSezione('Qualcosa di ignoto')).toBe('🎵');
  });
});

describe('sharedValue', () => {
  it('ritorna il valore se tutte le fasi concordano, altrimenti undefined', () => {
    const a = fase({ scala: 10 });
    const b = fase({ scala: 10 });
    expect(sharedValue([a, b], 'scala')).toBe(10);
    const c = fase({ scala: 20 });
    expect(sharedValue([a, c], 'scala')).toBeUndefined();
    expect(sharedValue([], 'scala')).toBeUndefined();
  });
});

describe('computeDrift', () => {
  it('elenca i campi condivisi divergenti', () => {
    const a = fase({ scala: 10, tempoMinuti: 5 });
    const b = fase({ scala: 20, tempoMinuti: 5 });
    const drift = computeDrift([a, b]);
    expect(drift).toContain('scala');
    expect(drift).not.toContain('tempoMinuti');
  });
  it('< 2 fasi → nessun drift', () => {
    expect(computeDrift([fase({})])).toEqual([]);
  });
});

describe('gruppoFasi', () => {
  it('raggruppa shared/single e garantisce una card per ogni sezione', () => {
    const fGlobale = fase({ id: 'g', ordine: 1, sezioniIds: [] });
    const fArchi = fase({ id: 'a', ordine: 2, sezioniIds: ['s1'] });
    const sezioni = [sez('s1', 'Archi'), sez('s2', 'Fiati')];

    const groups = gruppoFasi([fGlobale, fArchi], sezioni);

    // shared in cima.
    expect(groups[0]!.type).toBe('shared');
    expect(groups[0]!.fasi.map((f) => f.id)).toEqual(['g']);

    // ogni sezione ha un gruppo, anche quella senza fasi (CTA "Configura fasi").
    const s1 = groups.find((g) => g.key === 's:s1')!;
    const s2 = groups.find((g) => g.key === 's:s2')!;
    expect(s1.fasi.map((f) => f.id)).toEqual(['a']);
    expect(s2.fasi).toEqual([]);
  });

  it('ordina le sotto-fasi per ordine globale', () => {
    const f2 = fase({ id: 'f2', ordine: 2, sezioniIds: ['s1'] });
    const f1 = fase({ id: 'f1', ordine: 1, sezioniIds: ['s1'] });
    const groups = gruppoFasi([f2, f1], [sez('s1', 'Archi')]);
    const s1 = groups.find((g) => g.key === 's:s1')!;
    expect(s1.fasi.map((f) => f.id)).toEqual(['f1', 'f2']);
  });
});
