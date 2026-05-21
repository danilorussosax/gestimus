// Test riproducibilità sorteggio: stesso seed → stesso ordine.
// Esegui con: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, shuffleSeeded } from '../../js/rng.js';

test('mulberry32: stesso seed → stessa sequenza', () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    assert.equal(r1(), r2(), 'divergenza al sample ' + i);
  }
});

test('mulberry32: seed diverso → sequenza diversa', () => {
  const r1 = mulberry32(1);
  const r2 = mulberry32(2);
  let diff = false;
  for (let i = 0; i < 20; i++) {
    if (r1() !== r2()) { diff = true; break; }
  }
  assert.ok(diff, 'le due sequenze sono identiche');
});

test('mulberry32: output in [0, 1)', () => {
  const r = mulberry32(12345);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, 'out of range: ' + v);
  }
});

test('shuffleSeeded: stesso seed → stesso ordine', () => {
  const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const a = shuffleSeeded(input, 7);
  const b = shuffleSeeded(input, 7);
  assert.deepEqual(a, b);
});

test('shuffleSeeded: non muta l\'input', () => {
  const input = ['x', 'y', 'z'];
  const copy = [...input];
  shuffleSeeded(input, 99);
  assert.deepEqual(input, copy);
});

test('shuffleSeeded: contiene esattamente gli stessi elementi (permutazione)', () => {
  const input = ['a', 'b', 'c', 'd', 'e'];
  const shuffled = shuffleSeeded(input, 123);
  assert.equal(shuffled.length, input.length);
  for (const x of input) assert.ok(shuffled.includes(x), 'manca ' + x);
});

test('shuffleSeeded: seed diversi producono ordini diversi (anti-regressione bug seed=0)', () => {
  // Il bug citato nell'audit: Number("abc") >>> 0 = 0 → tutti i seed alfa
  // producevano lo stesso ordine. Qui controlliamo solo che almeno due seed
  // numerici distinti producano output diversi su un array significativo.
  const input = Array.from({ length: 20 }, (_, i) => 'c' + i);
  const a = shuffleSeeded(input, 1);
  const b = shuffleSeeded(input, 2);
  assert.notDeepEqual(a, b);
});

test('shuffleSeeded: array vuoto e singolo elemento', () => {
  assert.deepEqual(shuffleSeeded([], 1), []);
  assert.deepEqual(shuffleSeeded([42], 1), [42]);
});
