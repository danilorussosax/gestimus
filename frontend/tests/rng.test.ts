import { describe, it, expect } from 'vitest';
import { mulberry32, shuffleSeeded } from '@/lib/rng';

describe('mulberry32', () => {
  it('deterministico per seed dato', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });
  it('seed diversi → sequenze diverse', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
  it('valori sempre in [0, 1)', () => {
    const rand = mulberry32(999);
    for (let i = 0; i < 200; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffleSeeded', () => {
  it('stesso seed → stessa permutazione', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffleSeeded(arr, 42)).toEqual(shuffleSeeded(arr, 42));
  });
  it('seed diversi → (in genere) permutazioni diverse', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(shuffleSeeded(arr, 1)).not.toEqual(shuffleSeeded(arr, 2));
  });
  it('non muta l\'array originale', () => {
    const arr = [1, 2, 3];
    const copy = [...arr];
    shuffleSeeded(arr, 7);
    expect(arr).toEqual(copy);
  });
  it('conserva tutti gli elementi (permutazione)', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleSeeded(arr, 123);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
    expect(shuffled).toHaveLength(arr.length);
  });
  it('array vuoto → []', () => {
    expect(shuffleSeeded([], 5)).toEqual([]);
  });
  it('singolo elemento → identico', () => {
    expect(shuffleSeeded(['x'], 5)).toEqual(['x']);
  });
});
