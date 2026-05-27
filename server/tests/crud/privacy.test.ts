import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { accounts, auditLog, commissari, concorsi, tenants } from '../../src/db/schema.js';
import { computeAuditLogSig, verifyAuditIntegrity } from '../../src/services/audit.js';

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

  test('#3 self-service: GET /me/data espone i propri dati, POST /me/erase pseudonimizza', async () => {
    // Account commissario isolato (email unica per run → niente collisioni con
    // eventuali residui). NON l'admin del seed.
    const selfEmail = `self-erase-${Date.now()}@test.local`;
    const concorsoId = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: hdrs(), payload: { nome: `Erase Test self ${Date.now()}`, anno: 2026 } })).json().id;
    const comId = (await app.inject({ method: 'POST', url: '/api/commissari', headers: hdrs(), payload: { concorsoId, nome: 'Self', cognome: 'Service', email: selfEmail } })).json().id;
    const accId = (await app.inject({ method: 'POST', url: '/api/accounts', headers: hdrs(), payload: { email: selfEmail, password: 'Selferase123!', role: 'commissario', commissarioId: comId } })).json().id;

    try {
      const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' }, payload: { email: selfEmail, password: 'Selferase123!' } });
      const selfHdrs = { host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie: `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}` };

      const data = await app.inject({ method: 'GET', url: '/api/me/data', headers: selfHdrs });
      assert.equal(data.statusCode, 200);
      assert.equal(data.json().account.email, selfEmail);
      assert.equal(data.json().commissario.id, comId);

      // POST con payload {} (content-type json + body vuoto → Fastify 400).
      const erase = await app.inject({ method: 'POST', url: '/api/me/erase', headers: selfHdrs, payload: {} });
      assert.equal(erase.statusCode, 200);
      const row = (await dbSuper.select().from(commissari).where(eq(commissari.id, comId)))[0]!;
      assert.equal(row.nome, '[ERASED]');
      assert.equal(row.stato, 'INATTIVO');
      const acc = (await dbSuper.select().from(accounts).where(eq(accounts.id, accId)))[0]!;
      assert.equal(acc.attivo, false);
      assert.match(acc.email, /^erased\+/);
    } finally {
      // Rimuovi l'account (FK su commissari) prima del cascade del concorso in after().
      await dbSuper.delete(accounts).where(eq(accounts.id, accId));
    }
  });

  test('N183: erase per email redige la PII (email) dai payload storici dell audit_log', async () => {
    const targetEmail = 'n183-forget@test.local';
    // tenantId di ente1 letto direttamente (robusto: nessuna creazione di
    // risorse che potrebbe fallire sotto carico parallelo dei test).
    const tenantId = (await dbSuper
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, 'ente1')))[0]!.id;

    // Voce audit STORICA con l'email nel payload (come iscrizione.create_public).
    await dbSuper.insert(auditLog).values({
      tenantId,
      action: 'test.n183.audit',
      payload: { email: targetEmail, queued: true },
    });

    const erase = await app.inject({
      method: 'POST', url: '/api/privacy/erase', headers: hdrs(),
      payload: { email: targetEmail, motivo: 'Richiesta GDPR art. 17 (N183)' },
    });
    assert.equal(erase.statusCode, 200);

    const rows = await dbSuper
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'test.n183.audit')));
    const mine = rows.find((r) => (r.payload as Record<string, unknown> | null)?.queued === true);
    assert.ok(mine, 'la voce audit esiste ancora (integrità preservata)');
    const p = mine!.payload as Record<string, unknown>;
    assert.equal(p.email, undefined, 'email rimossa dal payload audit');
    assert.equal(p.queued, true, 'gli altri campi del payload restano');

    // cleanup della voce di test
    await dbSuper.delete(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'test.n183.audit')));
  });

  // M196: tamper-evidence dell'audit_log via HMAC per-riga.
  test('M196: verifyAuditIntegrity rileva manomissioni e valida le firme', async () => {
    const tenantId = (await dbSuper
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, 'ente1')))[0]!.id;

    // Riga firmata correttamente, payload multi-chiave (verifica che il canonical
    // sia stabile rispetto al riordino delle chiavi operato da jsonb).
    const good = { tenantId, actorAccountId: null, action: 'test.m196.ok', targetType: null, targetId: null, payload: { zeta: 'z', alpha: 'a', count: 3 }, ip: null, userAgent: null };
    await dbSuper.insert(auditLog).values({ ...good, sig: computeAuditLogSig(good) });

    // Riga firmata, poi manomessa (payload cambiato senza ri-firmare).
    const bad = { tenantId, actorAccountId: null, action: 'test.m196.bad', targetType: null, targetId: null, payload: { v: 1 }, ip: null, userAgent: null };
    const [badInserted] = await dbSuper.insert(auditLog).values({ ...bad, sig: computeAuditLogSig(bad) }).returning();
    await dbSuper.update(auditLog).set({ payload: { v: 999 } }).where(eq(auditLog.id, badInserted!.id));

    const report = await verifyAuditIntegrity(tenantId);
    assert.ok(report.tampered.some((t) => t.action === 'test.m196.bad'), 'manomissione rilevata');
    assert.ok(!report.tampered.some((t) => t.action === 'test.m196.ok'), 'firma valida non segnalata (canonical stabile)');

    await dbSuper
      .delete(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), inArray(auditLog.action, ['test.m196.ok', 'test.m196.bad'])));
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
