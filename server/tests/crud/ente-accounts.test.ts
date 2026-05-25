import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { accounts } from '../../src/db/schema.js';

/**
 * Integrazione ente (settings/branding) + accounts (gestione utenti tenant):
 *  - PATCH ente merge JSONB delle impostazioni (no overwrite)
 *  - PATCH branding pubblico + GET /ente/public senza auth
 *  - accounts CRUD: create admin/commissario, vincolo role↔commissarioId,
 *    email duplicata 409, reset password, self-protection, ultimo admin (L16)
 *  - vincoli ruolo: commissario non può gestire ente/accounts
 *  - isolamento cross-tenant
 * Pre-requisito: dati seed.
 */
describe('Ente settings + Accounts', () => {
  let app: FastifyInstance;
  let cookie: string;       // ente1 admin
  let cookie2: string;      // ente2 admin
  let commCookie: string;   // ente1 commissario
  let adminAccountId: string;

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
    adminAccountId = login.json().account.id;
    const login2 = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente2.test', password: 'Admin123!' } });
    cookie2 = `gestimus_session=${login2.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const loginC = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' } });
    commCookie = `gestimus_session=${loginC.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
  });

  after(async () => {
    // Rimuove gli account di test creati (prefisso email identificabile).
    await dbSuper.delete(accounts).where(like(accounts.email, 'ea-test-%'));
    await app.close();
  });

  // ---------- ente settings ----------
  test('GET /ente → settings del tenant corrente', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/ente', headers: H1() });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().slug, 'ente1');
  });

  test('PATCH /ente: merge JSONB (un secondo PATCH non azzera il primo campo)', async () => {
    const a = await app.inject({ method: 'PATCH', url: '/api/ente', headers: H1(), payload: { denominazione: 'EA Denom' } });
    assert.equal(a.statusCode, 200);
    const b = await app.inject({ method: 'PATCH', url: '/api/ente', headers: H1(), payload: { sede: 'EA Sede' } });
    assert.equal(b.statusCode, 200);
    const get = await app.inject({ method: 'GET', url: '/api/ente', headers: H1() });
    const settings = get.json().enteSettings;
    assert.equal(settings.denominazione, 'EA Denom', 'primo campo preservato dopo il secondo PATCH');
    assert.equal(settings.sede, 'EA Sede');
  });

  test('PATCH /ente/branding + GET /ente/public (no auth) riflette il branding', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/ente/branding', headers: H1(),
      payload: { nomePubblico: 'EA Public Name', coloreAccent: '#112233' } });
    assert.equal(r.statusCode, 200);
    const pub = await app.inject({ method: 'GET', url: '/api/ente/public', headers: { host: 'ente1.gestimus.local' } });
    assert.equal(pub.statusCode, 200);
    assert.equal(pub.json().brandingPublic.nomePubblico, 'EA Public Name');
  });

  test('PATCH /ente/branding: coloreAccent non esadecimale → 400', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/ente/branding', headers: H1(), payload: { coloreAccent: 'rosso' } });
    assert.equal(r.statusCode, 400);
  });

  test('commissario non può PATCH /ente → 403', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/ente', headers: HC(), payload: { denominazione: 'hack' } });
    assert.equal(r.statusCode, 403);
  });

  // ---------- accounts ----------
  let newAdminId: string;
  test('POST account admin → 201', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: H1(),
      payload: { email: 'ea-test-admin@example.com', password: 'Passw0rd!', role: 'admin' } });
    assert.equal(r.statusCode, 201, r.body);
    newAdminId = r.json().id;
    assert.equal(r.json().role, 'admin');
    assert.equal(r.json().email, 'ea-test-admin@example.com');
  });

  test('POST account: email duplicata → 409', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: H1(),
      payload: { email: 'ea-test-admin@example.com', password: 'Passw0rd!', role: 'admin' } });
    assert.equal(r.statusCode, 409);
  });

  test('POST account commissario senza commissarioId valido → eventuale rifiuto su patch role', async () => {
    // create commissario richiede un commissarioId valido per coerenza role↔binding;
    // senza, il create passa ma il modello impone l'invariante sui PATCH.
    // Qui verifichiamo solo che un commissarioId di altro tenant venga rifiutato.
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: H1(),
      payload: { email: 'ea-test-comm@example.com', password: 'Passw0rd!', role: 'commissario',
        commissarioId: '00000000-0000-0000-0000-000000000000' } });
    assert.equal(r.statusCode, 400, 'commissarioId inesistente → 400');
  });

  test('GET /accounts → lista include il nuovo admin', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/accounts', headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string; passwordHash?: string }>;
    assert.ok(rows.some((a) => a.id === newAdminId));
    assert.ok(rows.every((a) => a.passwordHash === undefined), 'passwordHash mai esposto');
  });

  test('PATCH account: demote admin→commissario senza commissarioId → 400', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/accounts/${newAdminId}`, headers: H1(),
      payload: { role: 'commissario' } });
    assert.equal(r.statusCode, 400);
  });

  test('PATCH account: disattiva un secondo admin (non self) → 200', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/accounts/${newAdminId}`, headers: H1(), payload: { attivo: false } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().attivo, false);
  });

  test('reset-password di un account → 200', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/accounts/${newAdminId}/reset-password`, headers: H1(),
      payload: { password: 'NewPassw0rd!' } });
    assert.equal(r.statusCode, 200);
  });

  test('self-protection: admin non può disattivare sé stesso → 403', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/accounts/${adminAccountId}`, headers: H1(), payload: { attivo: false } });
    assert.equal(r.statusCode, 403);
  });

  test('self-protection: admin non può cancellare sé stesso → 403', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/accounts/${adminAccountId}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  test('commissario non può listare accounts → 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/accounts', headers: HC() });
    assert.equal(r.statusCode, 403);
  });

  test('commissario non può creare accounts → 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: HC(),
      payload: { email: 'ea-test-x@example.com', password: 'Passw0rd!', role: 'admin' } });
    assert.equal(r.statusCode, 403);
  });

  test('DELETE account (disattivato, non ultimo admin) → 204', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/accounts/${newAdminId}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 204);
  });

  // ---------- isolamento cross-tenant ----------
  test('ente2 non vede l\'account admin di ente1 (per id) → 404', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/accounts/${adminAccountId}`, headers: H2() });
    assert.equal(r.statusCode, 404);
  });

  test('ente2 lista accounts → solo i propri (admin di ente1 assente)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/accounts', headers: H2() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string }>;
    assert.ok(!rows.some((a) => a.id === adminAccountId));
  });
});
