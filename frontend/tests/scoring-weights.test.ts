import { describe, it, expect } from 'vitest';
import { pesato, fmtVoto, criteriFromRecords } from '@/lib/scoring';

// Fase con criteri CONFIGURATI (peso percentuale 0-100), attaccati via criteriFromRecords.
const faseRecords = [
  { nome: 'Tecnica', peso: 50 },
  { nome: 'Interpretazione', peso: 50 },
];
const fase100 = { scala: 10, criteri: criteriFromRecords(faseRecords) };
const fase01 = { scala: 10, criteri: [
  { key: 'tecnica', label: 'Tecnica', peso: 0.5 },
  { key: 'interpretazione', label: 'Interpretazione', peso: 0.5 },
] };

describe('media pesata — usa i pesi % dei criteri, scala-invariante', () => {
  it('pesi 50/50 (0-100): media pesata su scala voti', () => {
    const voti = { tecnica: 8, interpretazione: 6 };
    expect(pesato(voti, fase100)).toBeCloseTo(7.0, 6); // (8*50+6*50)/100
  });
  it('pesi 0.5/0.5 (frazioni) → stesso risultato (retro-compat)', () => {
    const voti = { tecnica: 8, interpretazione: 6 };
    expect(pesato(voti, fase01)).toBeCloseTo(7.0, 6);
  });
  it('pesi diversi 80/20: il criterio col peso maggiore conta di più', () => {
    const fase = { scala: 10, criteri: criteriFromRecords([
      { nome: 'Tecnica', peso: 80 }, { nome: 'Interpretazione', peso: 20 },
    ]) };
    const voti = { tecnica: 10, interpretazione: 5 };
    expect(pesato(voti, fase)).toBeCloseTo(9.0, 6); // (10*80+5*20)/100
  });
  it('risultato sempre sulla scala dei voti (≤10), non scala 1000', () => {
    const voti = { tecnica: 10, interpretazione: 10 };
    expect(pesato(voti, fase100)).toBeLessThanOrEqual(10);
  });
});

describe('fmtVoto — due decimali su base 10', () => {
  it('scala 10 → 2 decimali', () => {
    expect(fmtVoto(7, 10)).toBe('7.00');
    expect(fmtVoto(8.5, 10)).toBe('8.50');
    expect(fmtVoto(7.333, 10)).toBe('7.33');
  });
  it('scala 100 → intero', () => {
    expect(fmtVoto(85, 100)).toBe('85');
  });
});
