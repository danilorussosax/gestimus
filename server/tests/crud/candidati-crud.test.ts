import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione candidati:
 *  - CRUD (create/read/update/delete) + audit
 *  - numeroCandidato auto-incrementale server-side se omesso
 *  - unique numeroCandidato per concorso (23505 → 409)
 *  - validateScope: sezione/categoria devono appartenere al concorso del candidato
 *  - gerarchia categoria→sezione derivata se manca la sezione
 *  - conteggio (GET list filtrato per concorso)
 *  - vincoli ruolo: commissario non può create/patch/delete
 *  - isolamento cross-tenant
 * Pre-requisito: dati seed.
 */
describe('Candidati CRUD + validateScope', () => {
  let app: FastifyInstance;
  let cookie: string;
  let cookie2: string;
  let commCookie: string;
  let concorsoId: string;
  let concorsoEnte2Id: string;
  let sezioneId: string;
  let categoriaId: string;
  let sezioneEnte2Id: string;
  let categoriaEnte2Id: string;

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
      payload: { nome: 'CandTest 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    sezioneId = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'Cand Archi', ordine: 1 } })).json().id;
    categoriaId = (await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId, nome: 'Cand Senior' } })).json().id;

    concorsoEnte2Id = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'CandTest E2 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    sezioneEnte2Id = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H2(),
      payload: { concorsoId: concorsoEnte2Id, nome: 'Cand E2 Sez', ordine: 1 } })).json().id;
    categoriaEnte2Id = (await app.inject({ method: 'POST', url: '/api/categorie', headers: H2(),
      payload: { sezioneId: sezioneEnte2Id, nome: 'Cand E2 Cat' } })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'CandTest%'));
    await app.close();
  });

  // ---------- create ----------
  let candId: string;
  test('POST: crea candidato, numeroCandidato auto-assegnato', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandA', cognome: 'Uno', strumento: 'Violino', sezioneId, categoriaId } });
    assert.equal(r.statusCode, 201, r.body);
    candId = r.json().id;
    assert.equal(typeof r.json().numeroCandidato, 'number');
    assert.ok(r.json().numeroCandidato >= 1);
    assert.equal(r.json().sezioneId, sezioneId);
    assert.equal(r.json().categoriaId, categoriaId);
  });

  test('POST: secondo candidato → numeroCandidato incrementato', async () => {
    const r1 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandB', strumento: 'Viola' } })).json();
    const r2 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandC', strumento: 'Cello' } })).json();
    assert.equal(r2.numeroCandidato, r1.numeroCandidato + 1);
  });

  test('POST: numeroCandidato duplicato esplicito → 409', async () => {
    const first = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, numeroCandidato: 5000, nome: 'CandDup1', strumento: 'X' } })).json();
    assert.equal(first.numeroCandidato, 5000);
    const dup = await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, numeroCandidato: 5000, nome: 'CandDup2', strumento: 'Y' } });
    assert.equal(dup.statusCode, 409);
  });

  // ---------- validateScope ----------
  test('POST: sezione di un altro concorso (ente2) → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandScope1', strumento: 'X', sezioneId: sezioneEnte2Id } });
    assert.equal(r.statusCode, 400);
  });

  test('POST: categoria che non appartiene alla sezione scelta → 400', async () => {
    // Sezione propria + categoria di ente2 (mismatch).
    const r = await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandScope2', strumento: 'X', sezioneId, categoriaId: categoriaEnte2Id } });
    assert.equal(r.statusCode, 400);
  });

  test('POST: solo categoria (senza sezione) → sezione derivata dalla categoria', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandDeriv', strumento: 'X', categoriaId } });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().sezioneId, sezioneId, 'sezione derivata dalla categoria');
    assert.equal(r.json().categoriaId, categoriaId);
  });

  test('POST: sezione inesistente → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandX', strumento: 'X', sezioneId: '00000000-0000-0000-0000-000000000000' } });
    assert.equal(r.statusCode, 400);
  });

  // ---------- read ----------
  test('GET /:id → candidato', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/candidati/${candId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().nome, 'CandA');
  });

  test('GET /:id inesistente → 404', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/candidati/00000000-0000-0000-0000-000000000000', headers: H1() });
    assert.equal(r.statusCode, 404);
  });

  test('GET list filtrato per concorsoId → conteggio coerente', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/candidati?concorsoId=${concorsoId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ concorsoId: string }>;
    assert.ok(rows.length >= 5);
    assert.ok(rows.every((x) => x.concorsoId === concorsoId));
  });

  // ---------- update ----------
  test('PATCH: aggiorna nome/strumento', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati/${candId}`, headers: H1(),
      payload: { nome: 'CandA Mod', strumento: 'Contrabbasso' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().nome, 'CandA Mod');
    assert.equal(r.json().strumento, 'Contrabbasso');
  });

  test('PATCH: categoria di altro concorso → 400 (validateScope su PATCH)', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati/${candId}`, headers: H1(),
      payload: { categoriaId: categoriaEnte2Id } });
    assert.equal(r.statusCode, 400);
  });

  test('PATCH: id inesistente → 404', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/candidati/00000000-0000-0000-0000-000000000000', headers: H1(),
      payload: { nome: 'X' } });
    assert.equal(r.statusCode, 404);
  });

  // ---------- ruolo ----------
  test('commissario non può creare candidati → 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati', headers: HC(),
      payload: { concorsoId, nome: 'CandComm', strumento: 'X' } });
    assert.equal(r.statusCode, 403);
  });

  test('commissario non può PATCHare un candidato → 403', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati/${candId}`, headers: HC(),
      payload: { nome: 'Hack' } });
    assert.equal(r.statusCode, 403);
  });

  // ---------- isolamento cross-tenant ----------
  test('ente2 non vede i candidati di ente1 (filtro per concorso ente1)', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/candidati?concorsoId=${concorsoId}`, headers: H2() });
    assert.equal(r.statusCode, 200);
    assert.equal((r.json() as unknown[]).length, 0);
  });

  test('ente2 non può GET un candidato di ente1 → 404', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/candidati/${candId}`, headers: H2() });
    assert.equal(r.statusCode, 404);
  });

  test('ente2 non può PATCHare un candidato di ente1 → 404', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati/${candId}`, headers: H2(), payload: { nome: 'X' } });
    assert.equal(r.statusCode, 404);
  });

  // ---------- delete ----------
  test('DELETE: admin elimina → 204, poi 404', async () => {
    const c = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CandDel', strumento: 'X' } })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/candidati/${c.id}`, headers: H1(), payload: {} });
    assert.equal(del.statusCode, 204);
    const del2 = await app.inject({ method: 'DELETE', url: `/api/candidati/${c.id}`, headers: H1(), payload: {} });
    assert.equal(del2.statusCode, 404);
  });

  test('commissario non può DELETE candidato → 403', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/candidati/${candId}`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });
});
