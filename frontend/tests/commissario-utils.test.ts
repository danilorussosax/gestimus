import { describe, it, expect, beforeEach } from 'vitest';
import {
  persistDraft,
  loadDraft,
  clearDraft,
  getCommissariIds,
  displayName,
  ageFromDate,
  formatTime,
  type DraftState,
} from '@/pages/commissario-utils';
import type { Commissione } from '@/types';

describe('formatTime', () => {
  it('ms → MM:SS, clampa a 0', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65_000)).toBe('01:05');
    expect(formatTime(600_000)).toBe('10:00');
    expect(formatTime(-5000)).toBe('00:00');
  });
});

describe('ageFromDate', () => {
  it('null/invalid → null', () => {
    expect(ageFromDate(null)).toBeNull();
    expect(ageFromDate(undefined)).toBeNull();
    expect(ageFromDate('non-una-data')).toBeNull();
  });
  it('data nel passato → età in anni interi', () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 30);
    expect(ageFromDate(d.toISOString())).toBe(30);
  });
});

describe('displayName', () => {
  it('"Cognome Nome", gestisce parziali e null', () => {
    expect(displayName({ nome: 'Anna', cognome: 'Rossi' })).toBe('Rossi Anna');
    expect(displayName({ nome: 'Anna' })).toBe('Anna');
    expect(displayName({ cognome: 'Rossi' })).toBe('Rossi');
    expect(displayName(null)).toBe('');
    expect(displayName({})).toBe('');
  });
});

describe('getCommissariIds', () => {
  it('estrae l\'array commissari, fallback []', () => {
    expect(getCommissariIds({ commissari: ['a', 'b'] } as unknown as Commissione)).toEqual(['a', 'b']);
    expect(getCommissariIds(null)).toEqual([]);
    expect(getCommissariIds({} as unknown as Commissione)).toEqual([]);
  });
});

describe('draft persistence (sessionStorage)', () => {
  beforeEach(() => clearDraft());

  const draft: DraftState = { voti: { tecnica: 8 }, note: 'ok', faseId: 'f1', candidatoFaseId: 'cf1' };

  it('round-trip solo se faseId + candidatoFaseId combaciano', () => {
    persistDraft(draft);
    expect(loadDraft('f1', 'cf1')).toEqual(draft);
    expect(loadDraft('f1', 'cf-altro')).toBeNull();
    expect(loadDraft('f-altro', 'cf1')).toBeNull();
  });

  it('clearDraft rimuove il draft', () => {
    persistDraft(draft);
    clearDraft();
    expect(loadDraft('f1', 'cf1')).toBeNull();
  });
});
