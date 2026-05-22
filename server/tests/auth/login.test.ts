import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';

/**
 * Pre-requisito: `npm run db:seed` deve aver creato gli account demo:
 *   admin@ente1.test / Admin123!         (tenant ente1)
 *   admin@ente2.test / Admin123!         (tenant ente2)
 *   commissario@ente1.test / Demo123!    (tenant ente1)
 *   super@platform.test / Super123!      (tenant platform)
 */
describe('Auth flow', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('login con credenziali corrette → 200 + cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.account.email, 'admin@ente1.test');
    assert.equal(body.account.role, 'admin');
    assert.ok(res.cookies.find((c) => c.name === 'gestimus_session'));
  });

  test('login con password sbagliata → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'wrong-password' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('login con email inesistente → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'nessuno@ente1.test', password: 'qualcosa' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('account di ente1 NON può loggare su subdomain ente2', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    assert.equal(res.statusCode, 401, 'cross-tenant login deve fallire');
  });

  test('/auth/me con cookie valido → 200', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    const cookie = loginRes.cookies.find((c) => c.name === 'gestimus_session')!.value;

    const meRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        host: 'ente1.gestimus.local',
        cookie: `gestimus_session=${cookie}`,
      },
    });
    assert.equal(meRes.statusCode, 200);
    const me = meRes.json();
    assert.equal(me.email, 'admin@ente1.test');
    assert.equal(me.role, 'admin');
  });

  test('/auth/me senza cookie → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { host: 'ente1.gestimus.local' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('logout invalida la sessione', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    const cookie = loginRes.cookies.find((c) => c.name === 'gestimus_session')!.value;

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        host: 'ente1.gestimus.local',
        cookie: `gestimus_session=${cookie}`,
      },
    });
    assert.equal(logoutRes.statusCode, 200);

    // Stesso cookie non funziona più
    const meRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        host: 'ente1.gestimus.local',
        cookie: `gestimus_session=${cookie}`,
      },
    });
    assert.equal(meRes.statusCode, 401);
  });

  test('super-admin login su platform.gestimus.local → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'platform.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'super@platform.test', password: 'Super123!' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.account.role, 'superadmin');
  });

  test('account non-superadmin NON può loggare su platform', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'platform.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    assert.equal(res.statusCode, 401);
  });
});
