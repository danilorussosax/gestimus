import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione candidati-fase (assegnazione) + audit-log:
 *  - assegnazione candidato→fase, vincoli tenant (fase/candidato del tenant)
 *  - doppia assegnazione stesso candidato → 409 (unique)
 *  - PATCH posizione/stato/ammessoProssimaFase admin-only
 *  - DELETE (unassign)
 *  - isolamento cross-tenant
 *  - audit-log: GET admin-only, filtro per action, generazione su create/delete
 * Pre-requisito: dati seed.
 */
describe('Candidati-fase + Audit', () => {
  let app: FastifyInstance;
  let cookie: string;
  let cookie2: string;
  let commCookie: string;
  let concorsoId: string;
  let faseId: string;
  let candId: string;
  let concorsoEnte2Id: string;
  let faseEnte2Id: string;

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
      payload: { nome: 'CFAudit Test 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    faseId = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: 1, nome: 'CFA Fase', scala: 100 } })).json().id;
    candId = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CFACand', strumento: 'Violino' } })).json().id;

    concorsoEnte2Id = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'CFAudit Test E2 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    faseEnte2Id = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H2(),
      payload: { concorsoId: concorsoEnte2Id, ordine: 1, nome: 'CFA E2 Fase', scala: 100 } })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'CFAudit Test%'));
    await app.close();
  });

  // ---------- assegnazione ----------
  let cfId: string;
  test('POST assegna candidato a fase → 201', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId, candidatoId: candId, posizione: 1 } });
    assert.equal(r.statusCode, 201, r.body);
    cfId = r.json().id;
  });

  test('POST: doppia assegnazione stesso candidato alla stessa fase → 409', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId, candidatoId: candId, posizione: 2 } });
    assert.equal(r.statusCode, 409);
  });

  test('POST: fase inesistente → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId: '00000000-0000-0000-0000-000000000000', candidatoId: candId } });
    assert.equal(r.statusCode, 400);
  });

  test('POST: candidato inesistente → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId, candidatoId: '00000000-0000-0000-0000-000000000000' } });
    assert.equal(r.statusCode, 400);
  });

  test('POST: fase di un altro tenant → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId: faseEnte2Id, candidatoId: candId } });
    assert.equal(r.statusCode, 400);
  });

  test('GET filtro per faseId', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${faseId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string }>;
    assert.ok(rows.some((x) => x.id === cfId));
  });

  // ---------- patch admin-only ----------
  test('PATCH: admin cambia stato → IN_ESECUZIONE', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati-fase/${cfId}`, headers: H1(),
      payload: { stato: 'IN_ESECUZIONE' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().stato, 'IN_ESECUZIONE');
  });

  test('PATCH: admin cambia posizione', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati-fase/${cfId}`, headers: H1(),
      payload: { posizione: 9 } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().posizione, 9);
  });

  test('PATCH: commissario non può cambiare stato/posizione/ammissione → 403', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati-fase/${cfId}`, headers: HC(),
      payload: { ammessoProssimaFase: true } });
    assert.equal(r.statusCode, 403);
  });

  // ---------- isolamento ----------
  test('ente2 non vede i candidati-fase di ente1', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${faseId}`, headers: H2() });
    assert.equal(r.statusCode, 200);
    assert.equal((r.json() as unknown[]).length, 0);
  });

  test('ente2 non può PATCHare un candidato-fase di ente1 → 404', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/candidati-fase/${cfId}`, headers: H2(), payload: { posizione: 1 } });
    assert.equal(r.statusCode, 404);
  });

  // ---------- delete ----------
  test('DELETE: admin unassign → 204, poi 404', async () => {
    const cand2 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'CFADel', strumento: 'X' } })).json();
    const cf2 = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId, candidatoId: cand2.id } })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/candidati-fase/${cf2.id}`, headers: H1(), payload: {} });
    assert.equal(del.statusCode, 204);
    const del2 = await app.inject({ method: 'DELETE', url: `/api/candidati-fase/${cf2.id}`, headers: H1(), payload: {} });
    assert.equal(del2.statusCode, 404);
  });

  test('commissario non può unassign (DELETE) → 403', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/candidati-fase/${cfId}`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  // ---------- audit-log ----------
  test('audit-log: admin lista eventi del tenant', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/audit-log?limit=50', headers: H1() });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
    assert.ok((r.json() as unknown[]).length > 0, 'almeno un evento di audit dai setup');
  });

  test('audit-log: filtro per action=fase.create → solo quelle azioni', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/audit-log?action=fase.create&limit=50', headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ action: string }>;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((x) => x.action === 'fase.create'));
  });

  test('audit-log/stats: conteggio per action (30gg)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/audit-log/stats', headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ action: string; count: number }>;
    assert.ok(rows.some((x) => x.action === 'candidato_fase.assign'));
  });

  test('commissario non può leggere l\'audit-log → 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/audit-log', headers: HC() });
    assert.equal(r.statusCode, 403);
  });

  test('audit-log: filtro before/after non valido (datetime malformato) → 400', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/audit-log?before=non-una-data', headers: H1() });
    assert.equal(r.statusCode, 400);
  });
});
