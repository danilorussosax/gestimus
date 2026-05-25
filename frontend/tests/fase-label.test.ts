import { describe, it, expect } from 'vitest';
import { faseFullLabel } from '@/lib/fase-label';

const sezioni = [
  { id: 's1', nome: 'Archi' },
  { id: 's2', nome: 'Fiati' },
];

describe('faseFullLabel', () => {
  it('sezioniIds vuoto → "Globale · <nome>"', () => {
    expect(faseFullLabel({ nome: 'Eliminatoria', sezioniIds: [] }, sezioni)).toBe('Globale · Eliminatoria');
  });
  it('una sezione → "<Sezione> · <nome>"', () => {
    expect(faseFullLabel({ nome: 'Finale', sezioniIds: ['s1'] }, sezioni)).toBe('Archi · Finale');
  });
  it('più sezioni → nomi uniti con " + "', () => {
    expect(faseFullLabel({ nome: 'Semifinale', sezioniIds: ['s1', 's2'] }, sezioni)).toBe('Archi + Fiati · Semifinale');
  });
  it('nome mancante → "—"', () => {
    expect(faseFullLabel({ sezioniIds: [] }, sezioni)).toBe('Globale · —');
    expect(faseFullLabel({ nome: null, sezioniIds: [] }, sezioni)).toBe('Globale · —');
  });
  it('sezioniIds null → trattato come globale', () => {
    expect(faseFullLabel({ nome: 'X', sezioniIds: null }, sezioni)).toBe('Globale · X');
  });
  it('id sezione non trovato → fallback "Sezione"', () => {
    expect(faseFullLabel({ nome: 'X', sezioniIds: ['ghost'] }, sezioni)).toBe('Sezione · X');
  });
  it('mix di id validi e non validi → solo i validi nello scope', () => {
    expect(faseFullLabel({ nome: 'X', sezioniIds: ['s1', 'ghost'] }, sezioni)).toBe('Archi · X');
  });
  it('lista sezioni vuota → fallback "Sezione"', () => {
    expect(faseFullLabel({ nome: 'X', sezioniIds: ['s1'] }, [])).toBe('Sezione · X');
  });
});
