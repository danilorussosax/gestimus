import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * GET /api/concorsi/:id/summary — conteggi aggregati per il workspace admin.
 * Verifica: correttezza conteggi (baseline 0 → incrementano per-tabella, scoping
 * sul concorso giusto), isolamento tenant (concorso di ente1 invisibile a ente2
 * → 404) e 404 su id inesistente.
 * Pre-requisito: `npm run db:seed`.
 */
describe('Concorso summary (conteggi + isolamento tenant)', () => {
  let app: FastifyInstance;
  let cookie1: string;
  let cookie2: string;
  let concorsoId: string;

  const h1 = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie: cookie1 });
  const h2 = () => ({ host: 'ente2.gestimus.local', 'content-type': 'application/json', cookie: cookie2 });

  const loginCookie = async (host: string) => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { host, 'content-type': 'application/json' },
      payload: { email: `admin@${host.split('.')[0]}.test`, password: 'Admin123!' },
    });
    return `gestimus_session=${res.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
  };

  before(async () => {
    app = await createApp();
    await app.ready();
    cookie1 = await loginCookie('ente1.gestimus.local');
    cookie2 = await loginCookie('ente2.gestimus.local');
    concorsoId = (await app.inject({
      method: 'POST', url: '/api/concorsi', headers: h1(),
      payload: { nome: 'Summary Test 2026', anno: 2026, stato: 'ATTIVO' },
    })).json().id;
  });

  after(async () => {
    // CASCADE rimuove sezioni/fasi collegate.
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Summary Test%'));
    await app.close();
  });

  const summary = async (id: string, headers = h1()) =>
    app.inject({ method: 'GET', url: `/api/concorsi/${id}/summary`, headers });

  test('concorso vuoto → tutti i contatori a 0', async () => {
    const res = await summary(concorsoId);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      concorsoId, candidati: 0, commissari: 0, commissioni: 0, fasi: 0, sezioni: 0,
    });
  });

  test('i contatori riflettono le righe create e restano scoped al concorso', async () => {
    // 2 sezioni + 1 fase sul concorso.
    for (const nome of ['Sez A', 'Sez B']) {
      const r = await app.inject({ method: 'POST', url: '/api/sezioni', headers: h1(), payload: { concorsoId, nome } });
      assert.equal(r.statusCode, 201);
    }
    const f = await app.inject({
      method: 'POST', url: '/api/fasi', headers: h1(),
      payload: { concorsoId, ordine: 1, nome: 'Eliminatoria', scala: 100 },
    });
    assert.equal(f.statusCode, 201);

    const res = await summary(concorsoId);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.sezioni, 2, 'sezioni contate');
    assert.equal(body.fasi, 1, 'fasi contate');
    // Le altre tabelle restano a 0 → niente conteggi incrociati tra tabelle.
    assert.equal(body.candidati, 0);
    assert.equal(body.commissari, 0);
    assert.equal(body.commissioni, 0);
  });

  test('isolamento tenant: ente2 non vede il summary del concorso di ente1 → 404', async () => {
    const res = await summary(concorsoId, h2());
    assert.equal(res.statusCode, 404);
  });

  test('id inesistente → 404', async () => {
    const res = await summary('00000000-0000-0000-0000-000000000000');
    assert.equal(res.statusCode, 404);
  });
});
