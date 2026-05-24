import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { accounts, sessions, tenants } from '../../src/db/schema.js';
import { hashPassword } from '../../src/services/password.js';
import {
  generateTotp,
  verifyTotp,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
} from '../../src/services/totp.js';

const HOST = 'ente1.gestimus.local';
const EMAIL = `totp-test-${Date.now()}@ente1.test`;
const PASSWORD = 'TotpTest123!';

function cookieHeader(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((x) => x.name === 'gestimus_session');
  return c ? `gestimus_session=${c.value}` : '';
}

describe('TOTP — algoritmo (vettori RFC 6238)', () => {
  // Secret RFC 6238: ASCII "12345678901234567890" in base32.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  test('codici a 6 cifre coincidono con i vettori RFC (SHA1)', () => {
    assert.equal(generateTotp(RFC_SECRET, 59_000), '287082');
    assert.equal(generateTotp(RFC_SECRET, 1111111109_000), '081804');
    assert.equal(generateTotp(RFC_SECRET, 1234567890_000), '005924');
  });

  test('verifyTotp accetta il codice corrente e rifiuta uno sbagliato', () => {
    const now = 1111111109_000;
    assert.equal(verifyTotp(RFC_SECRET, '081804', 1, now), true);
    assert.equal(verifyTotp(RFC_SECRET, '000000', 1, now), false);
    assert.equal(verifyTotp(RFC_SECRET, 'abc', 1, now), false);
  });

  test('finestra ±1 step: accetta ±30s, rifiuta ±60s', () => {
    const now = 1111111109_000;
    assert.equal(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 30_000), 1, now), true);
    assert.equal(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now + 30_000), 1, now), true);
    assert.equal(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 60_000), 1, now), false);
  });

  test('hashRecoveryCode normalizza (case/spazi) ed è deterministico', () => {
    assert.equal(hashRecoveryCode('abcde-12345'), hashRecoveryCode('ABCDE12345'));
    assert.notEqual(hashRecoveryCode('AAAA'), hashRecoveryCode('BBBB'));
  });

  test('otpauth URI ben formato', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'a@b.test');
    assert.match(uri, /^otpauth:\/\/totp\/Gestimus:a%40b\.test\?secret=JBSWY3DPEHPK3PXP&issuer=Gestimus/);
  });
});

describe('TOTP — flusso end-to-end (account dedicato)', () => {
  let app: FastifyInstance;
  let accountId: string;

  before(async () => {
    app = await createApp();
    await app.ready();
    const t1 = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'ente1') });
    assert.ok(t1, 'tenant ente1 deve esistere (db:seed)');
    const [acc] = await dbSuper
      .insert(accounts)
      .values({
        tenantId: t1!.id,
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        role: 'admin',
        attivo: true,
      })
      .returning();
    accountId = acc!.id;
  });

  after(async () => {
    if (accountId) {
      await dbSuper.delete(sessions).where(eq(sessions.accountId, accountId));
      await dbSuper.delete(accounts).where(eq(accounts.id, accountId));
    }
    await app.close();
  });

  const login = (payload: object) =>
    app.inject({ method: 'POST', url: '/auth/login', headers: { host: HOST, 'content-type': 'application/json' }, payload });

  test('flusso completo: setup → enable → login challenge → verify → disable', async () => {
    // 1. Login senza 2FA → sessione diretta.
    const r1 = await login({ email: EMAIL, password: PASSWORD });
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.json().mfaRequired, undefined);
    const cookie = cookieHeader(r1);
    assert.ok(cookie, 'cookie di sessione presente');

    // 2. Setup → secret pending.
    const r2 = await app.inject({ method: 'POST', url: '/auth/totp/setup', headers: { host: HOST, cookie } });
    assert.equal(r2.statusCode, 200);
    const secret = r2.json().secret as string;
    assert.ok(secret && secret.length >= 16);

    // 3. Enable con codice valido → recovery codes (una sola volta).
    const r3 = await app.inject({
      method: 'POST', url: '/auth/totp/enable',
      headers: { host: HOST, cookie, 'content-type': 'application/json' },
      payload: { code: generateTotp(secret) },
    });
    assert.equal(r3.statusCode, 200);
    const recoveryCodes = r3.json().recoveryCodes as string[];
    assert.equal(recoveryCodes.length, 10);

    // 4. Login ora richiede 2FA: niente sessione, solo challenge.
    const r4 = await login({ email: EMAIL, password: PASSWORD });
    assert.equal(r4.statusCode, 200);
    assert.equal(r4.json().mfaRequired, true);
    assert.ok(!r4.cookies.find((c) => c.name === 'gestimus_session'), 'nessun cookie prima del 2FA');
    const challenge = r4.json().challenge as string;

    // 5. verify-totp con codice corretto → sessione.
    const r5 = await app.inject({
      method: 'POST', url: '/auth/login/verify-totp',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: { challenge, code: generateTotp(secret) },
    });
    assert.equal(r5.statusCode, 200);
    assert.equal(r5.json().account.email, EMAIL);
    assert.ok(cookieHeader(r5), 'cookie emesso dopo il 2FA');

    // 5b. challenge + codice errato → 401.
    const r5bChallenge = (await login({ email: EMAIL, password: PASSWORD })).json().challenge;
    const r5b = await app.inject({
      method: 'POST', url: '/auth/login/verify-totp',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: { challenge: r5bChallenge, code: '000000' },
    });
    assert.equal(r5b.statusCode, 401);

    // 6. Recovery code: valido una volta sola.
    const rc = recoveryCodes[0]!;
    const chA = (await login({ email: EMAIL, password: PASSWORD })).json().challenge;
    const r6 = await app.inject({
      method: 'POST', url: '/auth/login/verify-totp',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: { challenge: chA, code: rc },
    });
    assert.equal(r6.statusCode, 200, 'recovery code valido');
    const chB = (await login({ email: EMAIL, password: PASSWORD })).json().challenge;
    const r6dup = await app.inject({
      method: 'POST', url: '/auth/login/verify-totp',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: { challenge: chB, code: rc },
    });
    assert.equal(r6dup.statusCode, 401, 'recovery code consumato non riutilizzabile');

    // 7. Disable con password → login torna diretto.
    const loginCookie = cookieHeader(r5);
    const r7 = await app.inject({
      method: 'POST', url: '/auth/totp/disable',
      headers: { host: HOST, cookie: loginCookie, 'content-type': 'application/json' },
      payload: { password: PASSWORD },
    });
    assert.equal(r7.statusCode, 200);
    const r8 = await login({ email: EMAIL, password: PASSWORD });
    assert.equal(r8.statusCode, 200);
    assert.equal(r8.json().mfaRequired, undefined, '2FA disattivato → login diretto');
  });
});
