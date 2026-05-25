import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione sezioni/categorie:
 *  - CRUD sezioni + vincolo concorsoId nel tenant (cross-tenant → 400)
 *  - gerarchia categoria→sezione (sezioneId deve appartenere al tenant)
 *  - vincolo etaMin <= etaMax sulle categorie
 *  - delete sezione/categoria bloccato (409) se referenziata da candidati/fasi
 *  - vincoli ruolo: commissario non può create/patch/delete
 *  - isolamento cross-tenant
 * Pre-requisito: dati seed.
 */
describe('Sezioni / Categorie', () => {
  let app: FastifyInstance;
  let cookie: string;
  let cookie2: string;
  let commCookie: string;
  let concorsoId: string;
  let concorsoEnte2Id: string;
  let sezioneEnte2Id: string;

  const H1 = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie });
  const H2 = () => ({ host: 'ente2.gestimus.local', 'content-type': 'application/json', cookie: cookie2 });
  const HC = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie: commCookie });

  before(async () => {
    app = await createApp();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' } });
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const login2 = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente2.test', password: 'Admin123!' } });
    cookie2 = `gestimus_session=${login2.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const loginC = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' } });
    commCookie = `gestimus_session=${loginC.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    concorsoId = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'SezCat Test 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    concorsoEnte2Id = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'SezCat Test E2 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    sezioneEnte2Id = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H2(),
      payload: { concorsoId: concorsoEnte2Id, nome: 'SezCat E2 Sez', ordine: 1 } })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'SezCat Test%'));
    await app.close();
  });

  // ---------- sezioni ----------
  let sezId: string;
  test('POST sezione → 201', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'SC Sezione 1', descrizione: 'desc', ordine: 1 } });
    assert.equal(r.statusCode, 201, r.body);
    sezId = r.json().id;
    assert.equal(r.json().nome, 'SC Sezione 1');
  });

  test('POST sezione: concorso di un altro tenant → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId: concorsoEnte2Id, nome: 'Intrusa', ordine: 1 } });
    assert.equal(r.statusCode, 400);
  });

  test('POST sezione: concorso inesistente → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId: '00000000-0000-0000-0000-000000000000', nome: 'X' } });
    assert.equal(r.statusCode, 400);
  });

  test('GET sezioni filtrato per concorsoId', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/sezioni?concorsoId=${concorsoId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string }>;
    assert.ok(rows.some((s) => s.id === sezId));
  });

  test('PATCH sezione: aggiorna nome', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/sezioni/${sezId}`, headers: H1(), payload: { nome: 'SC Sezione 1b' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().nome, 'SC Sezione 1b');
  });

  // ---------- categorie + gerarchia ----------
  let catId: string;
  test('POST categoria sotto la sezione → 201', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId: sezId, nome: 'SC Cat A', etaMin: 10, etaMax: 20 } });
    assert.equal(r.statusCode, 201, r.body);
    catId = r.json().id;
    assert.equal(r.json().sezioneId, sezId);
  });

  test('POST categoria: sezione di un altro tenant → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId: sezioneEnte2Id, nome: 'Intrusa Cat' } });
    assert.equal(r.statusCode, 400);
  });

  test('POST categoria: sezione inesistente → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId: '00000000-0000-0000-0000-000000000000', nome: 'X' } });
    assert.equal(r.statusCode, 400);
  });

  test('POST categoria: etaMin > etaMax → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId: sezId, nome: 'SC Cat Bad', etaMin: 50, etaMax: 20 } });
    assert.equal(r.statusCode, 400);
  });

  test('GET categorie filtrato per sezioneId', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/categorie?sezioneId=${sezId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string }>;
    assert.ok(rows.some((c) => c.id === catId));
  });

  test('PATCH categoria: etaMin > etaMax → 400', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/categorie/${catId}`, headers: H1(),
      payload: { etaMin: 99, etaMax: 1 } });
    assert.equal(r.statusCode, 400);
  });

  test('PATCH categoria: aggiorna nome', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/categorie/${catId}`, headers: H1(), payload: { nome: 'SC Cat A2' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().nome, 'SC Cat A2');
  });

  // ---------- delete con riferimenti ----------
  test('DELETE categoria referenziata da un candidato → 409', async () => {
    // crea candidato che usa questa categoria → poi il delete deve fallire.
    await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'SCRefCand', strumento: 'X', sezioneId: sezId, categoriaId: catId } });
    const r = await app.inject({ method: 'DELETE', url: `/api/categorie/${catId}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409, r.body);
    assert.ok((r.json() as { candidati: number }).candidati >= 1);
  });

  test('DELETE sezione referenziata da candidati → 409', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/sezioni/${sezId}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409, r.body);
    assert.ok((r.json() as { candidati: number }).candidati >= 1);
  });

  test('DELETE sezione referenziata da una fase → 409', async () => {
    // sezione vuota (no candidati) ma associata a una fase via sezioniIds.
    const sezF = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'SC Sez Fase', ordine: 9 } })).json();
    await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: 700, nome: 'SC Fase', scala: 100, sezioniIds: [sezF.id] } });
    const r = await app.inject({ method: 'DELETE', url: `/api/sezioni/${sezF.id}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409, r.body);
    assert.ok((r.json() as { fasi: number }).fasi >= 1);
  });

  test('DELETE categoria libera → 204', async () => {
    const sezLibera = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'SC Sez Libera', ordine: 8 } })).json();
    const catLibera = (await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId: sezLibera.id, nome: 'SC Cat Libera' } })).json();
    const r = await app.inject({ method: 'DELETE', url: `/api/categorie/${catLibera.id}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 204);
  });

  // ---------- ruolo ----------
  test('commissario non può creare sezioni → 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sezioni', headers: HC(),
      payload: { concorsoId, nome: 'SC Comm Sez' } });
    assert.equal(r.statusCode, 403);
  });

  test('commissario non può creare categorie → 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/categorie', headers: HC(),
      payload: { sezioneId: sezId, nome: 'SC Comm Cat' } });
    assert.equal(r.statusCode, 403);
  });

  // ---------- isolamento cross-tenant ----------
  test('ente2 non vede le sezioni di ente1', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/sezioni?concorsoId=${concorsoId}`, headers: H2() });
    assert.equal(r.statusCode, 200);
    assert.equal((r.json() as unknown[]).length, 0);
  });

  test('ente2 non può GET una sezione di ente1 → 404', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/sezioni/${sezId}`, headers: H2() });
    assert.equal(r.statusCode, 404);
  });

  test('ente2 non può PATCHare una categoria di ente1 → 404', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/categorie/${catId}`, headers: H2(), payload: { nome: 'X' } });
    assert.equal(r.statusCode, 404);
  });
});
