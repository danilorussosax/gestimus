import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { commissari, concorsi } from '../../src/db/schema.js';

describe('GDPR privacy endpoints', () => {
  let app: FastifyInstance;
  let cookie: string;
  const hdrs = () => ({
    host: 'ente1.gestimus.local',
    'content-type': 'application/json',
    cookie,
  });

  before(async () => {
    app = await createApp();
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
  });

  after(async () => {
    // Pulisce i concorsi creati dal test (cascade sui figli).
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Erase Test%'));
    await app.close();
  });

  test('export ritorna struttura completa con password redacted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/privacy/export',
      headers: hdrs(),
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.exportedAt);
    assert.equal(body.tenant.slug, 'ente1');
    assert.ok(Array.isArray(body.accounts));
    for (const a of body.accounts) {
      assert.equal(a.passwordHash, '[REDACTED]');
    }
  });

  test('erase per commissarioId pseudonimizza i dati', async () => {
    // Crea un concorso + commissario da cancellare
    const c = await app.inject({
      method: 'POST',
      url: '/api/concorsi',
      headers: hdrs(),
      payload: { nome: `Erase Test ${Date.now()}`, anno: 2026 },
    });
    const concorsoId = c.json().id;

    const com = await app.inject({
      method: 'POST',
      url: '/api/commissari',
      headers: hdrs(),
      payload: {
        concorsoId,
        nome: 'Privacy',
        cognome: 'Target',
        email: 'erase-me@test.local',
        telefono: '+39123456789',
        bio: 'Da cancellare',
      },
    });
    const comId = com.json().id;

    const erase = await app.inject({
      method: 'POST',
      url: '/api/privacy/erase',
      headers: hdrs(),
      payload: { commissarioId: comId, motivo: 'Richiesta GDPR art. 17' },
    });
    assert.equal(erase.statusCode, 200);
    assert.equal(erase.json().touched.commissari, 1);

    // Verifica via dbSuper (bypass RLS per check rapido)
    const rows = await dbSuper.select().from(commissari).where(eq(commissari.id, comId));
    const row = rows[0]!;
    assert.equal(row.nome, '[ERASED]');
    assert.equal(row.cognome, '[ERASED]');
    assert.equal(row.email, null);
    assert.equal(row.telefono, null);
    assert.equal(row.stato, 'INATTIVO');
  });

  test('erase richiede almeno un identificatore', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/privacy/erase',
      headers: hdrs(),
      payload: { motivo: 'test' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('commissario NON può chiamare /privacy/* (solo admin)', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' },
    });
    const commCookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/privacy/export',
      headers: { host: 'ente1.gestimus.local', cookie: commCookie, 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(res.statusCode, 403);
  });
});
