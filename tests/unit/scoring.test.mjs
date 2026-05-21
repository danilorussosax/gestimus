// Unit test puri su js/scoring.js — niente PocketBase, niente browser.
// Esegui con: npm run test:unit  (o node --test tests/unit)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAggregate,
  pesato,
  mediaCandidato,
  getCriteri,
  getPesiFor,
  getScala,
  defaultCriteri,
  suggerisciMetodo,
  suggestEliminatoria,
  slugifyKey,
} from '../../js/scoring.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- computeAggregate ----------

test('aritmetica: base', () => {
  assert.equal(computeAggregate([6, 7, 8], 'aritmetica'), 7);
});

test('aritmetica: lista vuota → 0', () => {
  assert.equal(computeAggregate([], 'aritmetica'), 0);
});

test('aritmetica: un solo valore → quel valore', () => {
  assert.equal(computeAggregate([7.5], 'aritmetica'), 7.5);
});

test('olimpica: scarta min e max', () => {
  // [3, 5, 7, 8, 10] → scarta 3 e 10 → media(5,7,8) = 6.666...
  assert.ok(close(computeAggregate([3, 5, 7, 8, 10], 'olimpica'), (5 + 7 + 8) / 3));
});

test('olimpica: n=2 fallback ad aritmetica', () => {
  assert.equal(computeAggregate([4, 8], 'olimpica'), 6);
});

test('olimpica: n=1 fallback', () => {
  assert.equal(computeAggregate([9], 'olimpica'), 9);
});

test('winsorizzata: cap di max e min al secondo estremo', () => {
  // [3, 5, 7, 8, 10] → [5, 5, 7, 8, 8] → media = 33/5 = 6.6
  assert.ok(close(computeAggregate([3, 5, 7, 8, 10], 'winsorizzata'), 6.6));
});

test('winsorizzata: n=2 fallback', () => {
  assert.equal(computeAggregate([4, 8], 'winsorizzata'), 6);
});

test('mediana: n dispari → centrale', () => {
  assert.equal(computeAggregate([5, 7, 9], 'mediana'), 7);
});

test('mediana: n pari → media dei due centrali', () => {
  assert.equal(computeAggregate([4, 6, 8, 10], 'mediana'), 7);
});

test('mediana: insensibile ai valori estremi a parità di mediana', () => {
  assert.equal(computeAggregate([7, 7, 7], 'mediana'), 7);
  assert.equal(computeAggregate([5, 7, 9], 'mediana'), 7);
});

test('deviazione_std: n<3 fallback aritmetica', () => {
  assert.equal(computeAggregate([6, 8], 'deviazione_std'), 7);
});

test('deviazione_std: tutti uguali (σ=0) → media', () => {
  assert.equal(computeAggregate([7, 7, 7, 7], 'deviazione_std'), 7);
});

test('deviazione_std: outlier filtrato', () => {
  // [7,7,7,7,7,1] → mean=6, std≈2.24, soglia 2σ ≈ 4.48
  // |1 - 6| = 5 > 4.48 → escluso → media(7,7,7,7,7) = 7
  assert.equal(computeAggregate([7, 7, 7, 7, 7, 1], 'deviazione_std'), 7);
});

test('metodo sconosciuto → fallback aritmetica', () => {
  assert.equal(computeAggregate([2, 4, 6], 'inesistente'), 4);
});

// ---------- pesato ----------

test('pesato: usa pesi fase ordine 1 (default)', () => {
  // ordine 1: tecnica 0.40, interpretazione 0.30, intonazione 0.20, musicalita 0.10
  const voti = { tecnica: 10, interpretazione: 10, intonazione: 10, musicalita: 10 };
  assert.equal(pesato(voti, { ordine: 1 }), 10);
});

test('pesato: voti mancanti contati come 0', () => {
  const voti = { tecnica: 10 };
  assert.ok(close(pesato(voti, { ordine: 1 }), 4)); // 10 * 0.40
});

test('pesato: supporta criteri dinamici', () => {
  const fase = { criteri: [{ key: 'a', peso: 0.5 }, { key: 'b', peso: 0.5 }] };
  assert.equal(pesato({ a: 6, b: 8 }, fase), 7);
});

// ---------- mediaCandidato ----------

test('mediaCandidato: nessuna valutazione → 0', () => {
  assert.equal(mediaCandidato([], { ordine: 1 }), 0);
});

test('mediaCandidato: un commissario, voti pieni', () => {
  const v = [
    { commissario_id: 'c1', criterio: 'tecnica',         voto: 10 },
    { commissario_id: 'c1', criterio: 'interpretazione', voto: 10 },
    { commissario_id: 'c1', criterio: 'intonazione',     voto: 10 },
    { commissario_id: 'c1', criterio: 'musicalita',      voto: 10 },
  ];
  assert.equal(mediaCandidato(v, { ordine: 1 }), 10);
});

test('mediaCandidato: olimpica scarta estremi', () => {
  // 4 commissari con totale pesato (criteri uguali 25% ciascuno) = 5, 7, 9, 10
  const fase = {
    metodo_media: 'olimpica',
    criteri: [
      { key: 'a', peso: 0.25 }, { key: 'b', peso: 0.25 },
      { key: 'c', peso: 0.25 }, { key: 'd', peso: 0.25 },
    ],
  };
  const mk = (id, v) => ['a','b','c','d'].map(k => ({ commissario_id: id, criterio: k, voto: v }));
  const all = [...mk('c1', 5), ...mk('c2', 7), ...mk('c3', 9), ...mk('c4', 10)];
  // Totali per commissario: 5, 7, 9, 10 → olimpica scarta 5 e 10 → media(7,9) = 8
  assert.equal(mediaCandidato(all, fase), 8);
});

// ---------- getCriteri / getPesiFor / getScala ----------

test('getCriteri: default per ordine 1', () => {
  const c = getCriteri(1);
  assert.equal(c.length, 4);
  assert.equal(c[0].key, 'tecnica');
  assert.equal(c[0].peso, 0.40);
});

test('getCriteri: criteri custom passano per validazione', () => {
  const c = getCriteri({ criteri: [{ label: 'Armonia', peso: 1 }] });
  assert.equal(c.length, 1);
  assert.equal(c[0].key, 'armonia'); // slugify del label
  assert.equal(c[0].peso, 1);
});

test('getPesiFor: somma pesi fase ordine 1 = 1', () => {
  const p = getPesiFor(1);
  const tot = Object.values(p).reduce((s, x) => s + x, 0);
  assert.ok(close(tot, 1));
});

test('getScala: default 10', () => {
  assert.equal(getScala(undefined), 10);
  assert.equal(getScala({}), 10);
  assert.equal(getScala({ scala: 20 }), 20);
  assert.equal(getScala(30), 30);
});

// ---------- suggerisciMetodo ----------

test('suggerisciMetodo: 0/1/2 → aritmetica', () => {
  assert.equal(suggerisciMetodo(0).metodo, 'aritmetica');
  assert.equal(suggerisciMetodo(1).metodo, 'aritmetica');
  assert.equal(suggerisciMetodo(2).metodo, 'aritmetica');
});

test('suggerisciMetodo: 3 → mediana', () => {
  assert.equal(suggerisciMetodo(3).metodo, 'mediana');
});

test('suggerisciMetodo: 5 → olimpica', () => {
  assert.equal(suggerisciMetodo(5).metodo, 'olimpica');
});

test('suggerisciMetodo: 10 → winsorizzata', () => {
  assert.equal(suggerisciMetodo(10).metodo, 'winsorizzata');
});

test('suggerisciMetodo: 15 → deviazione_std', () => {
  assert.equal(suggerisciMetodo(15).metodo, 'deviazione_std');
});

// ---------- suggestEliminatoria ----------

test('suggestEliminatoria: scala 10, media 6.5 → ammesso STANDARD', () => {
  const r = suggestEliminatoria({ media: 6.5, voti: [6, 7, 6.5], scala: 10 });
  assert.equal(r.ammesso, true);
  assert.equal(r.fascia, 'STANDARD');
});

test('suggestEliminatoria: scala 10, media 8 → MERITO', () => {
  const r = suggestEliminatoria({ media: 8, voti: [8, 8, 8], scala: 10 });
  assert.equal(r.ammesso, true);
  assert.equal(r.fascia, 'MERITO');
});

test('suggestEliminatoria: scala 10, media 5 → ELIMINATO', () => {
  const r = suggestEliminatoria({ media: 5, voti: [5, 5, 5], scala: 10 });
  assert.equal(r.ammesso, false);
  assert.equal(r.fascia, 'ELIMINATO');
});

test('suggestEliminatoria: norm-based con scala 20', () => {
  // media 13/20 = 0.65 → ammesso STANDARD
  const r = suggestEliminatoria({ media: 13, voti: [13, 13, 13], scala: 20 });
  assert.equal(r.ammesso, true);
  assert.equal(r.fascia, 'STANDARD');
});

test('suggestEliminatoria: borderline 0.68 con voti sotto 0.60 → ammesso STANDARD', () => {
  // norm 6.8/10 = 0.68; 1 voto sotto 6 → ammesso
  const r = suggestEliminatoria({ media: 6.8, voti: [5, 6.8, 7, 8], scala: 10 });
  assert.equal(r.ammesso, true);
  assert.equal(r.fascia, 'STANDARD');
});

// ---------- slugifyKey ----------

test('slugifyKey: spazi e maiuscole', () => {
  assert.equal(slugifyKey('  Tecnica Esecutiva  '), 'tecnica_esecutiva');
});

test('slugifyKey: input vuoto/null → fallback "crit"', () => {
  assert.equal(slugifyKey(''), 'crit');
  assert.equal(slugifyKey(null), 'crit');
});

test('slugifyKey: chiave max 30 caratteri', () => {
  const k = slugifyKey('a'.repeat(50));
  assert.ok(k.length <= 30);
});

// ---------- defaultCriteri ----------

test('defaultCriteri: pesi somma a 1 per ogni ordine', () => {
  for (const ordine of [1, 2, 3]) {
    const tot = defaultCriteri(ordine).reduce((s, c) => s + c.peso, 0);
    assert.ok(close(tot, 1), `ordine ${ordine}: tot=${tot}`);
  }
});
