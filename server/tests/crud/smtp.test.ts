import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { tenants } from '../../src/db/schema.js';
import { isEncryptedSmtp } from '../../src/services/crypto-smtp.js';

describe('SMTP config endpoint', () => {
  let app: FastifyInstance;
  let cookie: string;
  let tenantId: string;

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
    tenantId = login.json().account.tenantId;
  });

  after(async () => {
    // Cleanup: rimuovi smtp config residua
    await dbSuper.update(tenants).set({ smtpConfig: null }).where(eq(tenants.id, tenantId));
    await app.close();
  });

  test('GET /tenant/smtp → not configured initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tenant/smtp',
      headers: hdrs(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().configured, false);
  });

  test('PUT /tenant/smtp salva config cifrata', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/tenant/smtp',
      headers: hdrs(),
      payload: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'noreply@ente1.test',
        password: 'my-secret-password',
        from: 'Ente1 <noreply@ente1.test>',
      },
    });
    assert.equal(res.statusCode, 200);

    // Verifica via dbSuper che il valore in DB sia cifrato (no plaintext password)
    const rows = await dbSuper
      .select({ smtpConfig: tenants.smtpConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const stored = rows[0]!.smtpConfig;
    assert.ok(isEncryptedSmtp(stored), 'smtp_config deve essere in formato cifrato');
    assert.ok(
      !JSON.stringify(stored).includes('my-secret-password'),
      'password in plaintext non deve apparire nel DB',
    );
  });

  test('GET /tenant/smtp → encrypted=true dopo PUT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tenant/smtp',
      headers: hdrs(),
    });
    assert.equal(res.json().configured, true);
    assert.equal(res.json().encrypted, true);
  });

  test('DELETE /tenant/smtp rimuove la config', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tenant/smtp',
      headers: { host: 'ente1.gestimus.local', cookie }, // no content-type su request senza body
    });
    assert.equal(res.statusCode, 200);

    const check = await app.inject({
      method: 'GET',
      url: '/api/tenant/smtp',
      headers: hdrs(),
    });
    assert.equal(check.json().configured, false);
  });

  test('commissario NON può configurare SMTP', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' },
    });
    const commCookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const res = await app.inject({
      method: 'PUT',
      url: '/api/tenant/smtp',
      headers: { host: 'ente1.gestimus.local', cookie: commCookie, 'content-type': 'application/json' },
      payload: {
        host: 'smtp.evil.com',
        port: 587,
        user: 'a',
        password: 'b',
        from: 'c@d.e',
      },
    });
    assert.equal(res.statusCode, 403);
  });
});
