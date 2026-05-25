import { describe, it, expect } from 'vitest';
import { NATIONALITIES } from '@/lib/nationalities';

describe('NATIONALITIES', () => {
  it('contiene 45 voci (il commento sorgente dice 46 ma l\'array reale è 45)', () => {
    expect(NATIONALITIES).toHaveLength(45);
  });
  it('prima voce è Italiana', () => {
    expect(NATIONALITIES[0]).toBe('Italiana');
  });
  it('include alcune nazionalità note', () => {
    expect(NATIONALITIES).toContain('Francese');
    expect(NATIONALITIES).toContain('Tedesca');
    expect(NATIONALITIES).toContain('Statunitense');
  });
  it('nessun duplicato', () => {
    expect(new Set(NATIONALITIES).size).toBe(NATIONALITIES.length);
  });
  it('nessuna stringa vuota', () => {
    expect(NATIONALITIES.every((n) => n.trim().length > 0)).toBe(true);
  });
});
