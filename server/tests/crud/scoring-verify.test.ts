// #1 — Unit test del motore di scoring server-side (port di frontend/src/lib).
// Verifica che il ricalcolo usato per validare la lista `admitted` in conclude
// produca la stessa matematica del frontend. Pure functions → niente DB/app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaCandidato, criteriFromRecords, computeAggregate, type ValutazioneRaw } from '@gestimus/scoring/scoring';
import { rankWithTieBreak, computeAdmittedIds } from '@gestimus/scoring/tiebreak';

const fase2 = {
  criteri: [
    { key: 'tecnica', label: 'Tecnica', peso: 50 },
    { key: 'interpretazione', label: 'Interpretazione', peso: 50 },
  ],
  metodoMedia: 'aritmetica',
};

test('mediaCandidato: media pesata sui voti completi', () => {
  const vals: ValutazioneRaw[] = [
    { commissario_id: 'c1', criterio: 'tecnica', voto: 8 },
    { commissario_id: 'c1', criterio: 'interpretazione', voto: 6 },
  ];
  assert.equal(mediaCandidato(vals, fase2), 7); // (8·50 + 6·50) / 100
});

test('mediaCandidato: criterio non votato conta 0 (design choice esplicita)', () => {
  const vals: ValutazioneRaw[] = [{ commissario_id: 'c1', criterio: 'tecnica', voto: 8 }];
  assert.equal(mediaCandidato(vals, fase2), 4); // (8·50 + 0·50) / 100
});

test('computeAggregate olimpica scarta min e max', () => {
  assert.equal(computeAggregate([1, 5, 6, 10], 'olimpica'), 5.5); // media di [5,6]
});

test('computeAggregate mediana su n dispari', () => {
  assert.equal(computeAggregate([3, 9, 6], 'mediana'), 6);
});

test('rankWithTieBreak ordina per media desc; computeAdmittedIds applica il top-N', () => {
  const rows = [
    { cf: { id: 'A' }, cand: { numeroCandidato: 1 }, media: 9, valutazioni: [] as ValutazioneRaw[] },
    { cf: { id: 'B' }, cand: { numeroCandidato: 2 }, media: 7, valutazioni: [] as ValutazioneRaw[] },
    { cf: { id: 'C' }, cand: { numeroCandidato: 3 }, media: 8, valutazioni: [] as ValutazioneRaw[] },
  ];
  const ranked = rankWithTieBreak(rows, fase2, {});
  assert.deepEqual(ranked.map((r) => (r.cf as { id: string }).id), ['A', 'C', 'B']);
  assert.deepEqual(computeAdmittedIds(ranked, 2), ['A', 'C']);
  assert.equal(computeAdmittedIds(ranked, 0), null, 'soglia <= 0 → nessun top-N');
});

test('criteriFromRecords: chiave da slug del nome + peso', () => {
  const c = criteriFromRecords([{ nome: 'Tecnica', peso: 40 }, { nome: 'Interpretazione', peso: 60 }]);
  assert.equal(c[0]!.key, 'tecnica');
  assert.equal(c[1]!.peso, 60);
});
