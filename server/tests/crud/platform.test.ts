import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { platformAuditLog, tenants } from '../../src/db/schema.js';

/**
 * Test della Fase 6: backend platform layer.
 * Pre-requisito: `npm run db:seed` (super-admin + ente1 esistono).
 *
 * Copre:
 *  - guard /api/platform/* (404 da subdomain non-platform, 401 senza auth, 403 ruolo errato)
 *  - lista / dettaglio tenants
 *  - lifecycle: create → suspend → reactivate → archive(7gg) → restore → hard-delete
 *  - stats: conteggi per tenant
 *  - audit: platform_audit_log popolato dalle mutazioni
 *  - tenant 'platform' non sospendibile/archiviabile/eliminabile
 */
describe('Platform super-admin (Fase 6)', () => {
  let app: FastifyInstance;
  let superCookie: string;
  let adminEnte1Cookie: string;
  const testSlug = `test-${Date.now()}`;
  let createdTenantId: string | null = null;

  before(async () => {
    app = await createApp();
    await app.ready();

    const superLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'platform.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'super@platform.test', password: 'Super123!' },
    });
    assert.equal(superLogin.statusCode, 200, 'super-admin login deve riuscire');
    superCookie = `gestimus_session=${superLogin.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    assert.equal(adminLogin.statusCode, 200, 'admin ente1 login deve riuscire');
    adminEnte1Cookie = `gestimus_session=${adminLogin.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
  });

  after(async () => {
    // Cleanup difensivo: se il test si è fermato a metà, rimuovo il tenant creato.
    if (createdTenantId) {
      await dbSuper.delete(tenants).where(eq(tenants.id, createdTenantId));
    }
    // Pulisci anche eventuali audit di test rumorosi
    await dbSuper.delete(platformAuditLog).where(eq(platformAuditLog.targetTenantSlug, testSlug));
    await app.close();
  });

  // Header per richieste GET / POST/DELETE senza body
  const platformHdrs = () => ({
    host: 'platform.gestimus.local',
    cookie: superCookie,
  });
  // Header per richieste POST/PATCH CON body JSON
  const platformHdrsJson = () => ({
    ...platformHdrs(),
    'content-type': 'application/json',
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Guard
  // ────────────────────────────────────────────────────────────────────────────

  test('GET /api/platform/tenants da subdomain tenant → 404 (route invisibile)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/tenants',
      headers: { host: 'ente1.gestimus.local', cookie: adminEnte1Cookie },
    });
    assert.equal(res.statusCode, 404);
  });

  test('GET /api/platform/tenants senza cookie → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/tenants',
      headers: { host: 'platform.gestimus.local' },
    });
    assert.equal(res.statusCode, 401);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Lista e dettaglio
  // ────────────────────────────────────────────────────────────────────────────

  test('GET /api/platform/tenants → lista tenants seedati', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/tenants',
      headers: platformHdrs(),
    });
    assert.equal(res.statusCode, 200);
    const list = res.json() as Array<{ slug: string; stato: string }>;
    const slugs = list.map((t) => t.slug);
    assert.ok(slugs.includes('platform'), 'tenant platform presente');
    assert.ok(slugs.includes('ente1'), 'tenant ente1 presente');
  });

  test('GET /api/platform/tenants?stato=archiviato → solo archiviati', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/tenants?stato=archiviato',
      headers: platformHdrs(),
    });
    assert.equal(res.statusCode, 200);
    const list = res.json() as Array<{ stato: string }>;
    assert.ok(list.every((t) => t.stato === 'archiviato'), 'filtro stato applicato');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Create + lifecycle completo
  // ────────────────────────────────────────────────────────────────────────────

  test('POST /api/platform/tenants → crea tenant + admin atomico', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform/tenants',
      headers: platformHdrsJson(),
      payload: {
        slug: testSlug,
        nome: 'Tenant di test Fase 6',
        piano: 'trial',
        cleanupAfterDays: 14,
        adminEmail: `admin@${testSlug}.test`,
        adminPassword: 'TestPass123!',
      },
    });
    assert.equal(res.statusCode, 201);
    const t = res.json();
    assert.equal(t.slug, testSlug);
    assert.equal(t.stato, 'attivo');
    assert.equal(t.piano, 'trial');
    assert.equal(t.cleanupAfterDays, 14);
    createdTenantId = t.id;

    // l'admin appena creato deve poter fare login sul nuovo sottodominio
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: `${testSlug}.gestimus.local`, 'content-type': 'application/json' },
      payload: { email: `admin@${testSlug}.test`, password: 'TestPass123!' },
    });
    assert.equal(login.statusCode, 200, "admin del nuovo tenant deve poter loggare");
  });

  test('POST /api/platform/tenants duplicato → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform/tenants',
      headers: platformHdrsJson(),
      payload: {
        slug: testSlug,
        nome: 'Duplicato',
        piano: 'trial',
        adminEmail: 'x@x.test',
        adminPassword: 'TestPass123!',
      },
    });
    assert.equal(res.statusCode, 409);
  });

  test('PATCH /api/platform/tenants/:id → aggiorna meta', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/platform/tenants/${createdTenantId}`,
      headers: platformHdrsJson(),
      payload: { nome: 'Tenant rinominato', piano: 'starter', note: 'nota di test' },
    });
    assert.equal(res.statusCode, 200);
    const t = res.json();
    assert.equal(t.nome, 'Tenant rinominato');
    assert.equal(t.piano, 'starter');
    assert.equal(t.note, 'nota di test');
  });

  test('lifecycle: suspend → reactivate', async () => {
    const susp = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${createdTenantId}/suspend`,
      headers: platformHdrs(),
    });
    assert.equal(susp.statusCode, 200);
    assert.equal(susp.json().stato, 'sospeso');

    // Tentativo doppio → 409
    const dup = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${createdTenantId}/suspend`,
      headers: platformHdrs(),
    });
    assert.equal(dup.statusCode, 409);

    const react = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${createdTenantId}/reactivate`,
      headers: platformHdrs(),
    });
    assert.equal(react.statusCode, 200);
    assert.equal(react.json().stato, 'attivo');
  });

  test('lifecycle: archive(cleanupAfterDays=7) → restore', async () => {
    const arch = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${createdTenantId}/archive`,
      headers: platformHdrsJson(),
      payload: { cleanupAfterDays: 7 },
    });
    assert.equal(arch.statusCode, 200);
    const archived = arch.json();
    assert.equal(archived.stato, 'archiviato');
    assert.equal(archived.cleanupAfterDays, 7);
    assert.ok(archived.archiviatoAt, 'archiviato_at deve essere settato');
    assert.ok(archived.cleanupScheduledAt, 'cleanup_scheduled_at deve essere calcolato');
    const archDate = new Date(archived.archiviatoAt).getTime();
    const cleanupDate = new Date(archived.cleanupScheduledAt).getTime();
    const diffDays = Math.round((cleanupDate - archDate) / 86400_000);
    assert.equal(diffDays, 7, 'cleanup_scheduled_at = archiviato_at + 7 giorni');

    const rest = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${createdTenantId}/restore`,
      headers: platformHdrs(),
    });
    assert.equal(rest.statusCode, 200);
    const restored = rest.json();
    assert.equal(restored.stato, 'attivo');
    assert.equal(restored.archiviatoAt, null);
    assert.equal(restored.cleanupScheduledAt, null);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Stats
  // ────────────────────────────────────────────────────────────────────────────

  test('GET /api/platform/tenants/:id/stats → conteggi entità', async () => {
    // Stats su ente1 (seedato con concorsi)
    const ente1Row = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'ente1') });
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/tenants/${ente1Row!.id}/stats`,
      headers: platformHdrs(),
    });
    assert.equal(res.statusCode, 200);
    const s = res.json();
    assert.equal(typeof s.concorsi, 'number');
    assert.equal(typeof s.commissari, 'number');
    assert.equal(typeof s.candidati, 'number');
    assert.equal(typeof s.iscrizioni, 'number');
    assert.equal(typeof s.accounts, 'number');
    assert.ok(s.accounts >= 2, 'ente1 ha almeno 2 account (admin + commissario)');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Audit
  // ────────────────────────────────────────────────────────────────────────────

  test('platform_audit_log popolato dalle mutazioni del test', async () => {
    const rows = await dbSuper
      .select()
      .from(platformAuditLog)
      .where(eq(platformAuditLog.targetTenantSlug, testSlug));
    const actions = new Set(rows.map((r) => r.action));
    assert.ok(actions.has('platform.tenant.create'), 'audit create presente');
    assert.ok(actions.has('platform.tenant.update'), 'audit update presente');
    assert.ok(actions.has('platform.tenant.suspend'), 'audit suspend presente');
    assert.ok(actions.has('platform.tenant.reactivate'), 'audit reactivate presente');
    assert.ok(actions.has('platform.tenant.archive'), 'audit archive presente');
    assert.ok(actions.has('platform.tenant.restore'), 'audit restore presente');
  });

  test('GET /api/platform/audit → filtri base', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/audit?tenantId=${createdTenantId}&limit=50`,
      headers: platformHdrs(),
    });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<{ targetTenantId: string }>;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.targetTenantId === createdTenantId));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Protezione tenant 'platform'
  // ────────────────────────────────────────────────────────────────────────────

  test("il tenant 'platform' è protetto da suspend/archive/hard-delete", async () => {
    const platRow = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'platform') });
    const susp = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${platRow!.id}/suspend`,
      headers: platformHdrs(),
    });
    assert.equal(susp.statusCode, 409, 'platform tenant non sospendibile');

    const arch = await app.inject({
      method: 'POST',
      url: `/api/platform/tenants/${platRow!.id}/archive`,
      headers: platformHdrs(),
    });
    assert.equal(arch.statusCode, 409, 'platform tenant non archiviabile');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/platform/tenants/${platRow!.id}`,
      headers: platformHdrs(),
    });
    assert.equal(del.statusCode, 409, 'platform tenant non eliminabile');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Hard-delete finale del tenant di test (chiude il lifecycle)
  // ────────────────────────────────────────────────────────────────────────────

  test('DELETE /api/platform/tenants/:id → hard-delete del tenant di test', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/platform/tenants/${createdTenantId}`,
      headers: platformHdrs(),
    });
    assert.equal(res.statusCode, 204);

    // dopo l'hard-delete il record sparisce
    const check = await dbSuper.query.tenants.findFirst({
      where: eq(tenants.id, createdTenantId!),
    });
    assert.equal(check, undefined, 'tenant rimosso dal DB');

    // platform_audit_log conserva la riga del hard-delete (no cascade)
    const audit = await dbSuper
      .select()
      .from(platformAuditLog)
      .where(eq(platformAuditLog.targetTenantSlug, testSlug));
    const actions = audit.map((r) => r.action);
    assert.ok(actions.includes('platform.tenant.hard_delete'), 'audit hard_delete persistito');

    createdTenantId = null;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Config singleton
  // ────────────────────────────────────────────────────────────────────────────

  test('GET /api/platform/config → singleton id=1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/config',
      headers: platformHdrs(),
    });
    assert.equal(res.statusCode, 200);
    const cfg = res.json();
    assert.ok(cfg, 'config presente');
    assert.equal(cfg.id, 1);
  });

  test('PATCH /api/platform/config → aggiorna defaultCleanupDays', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/platform/config',
      headers: platformHdrsJson(),
      payload: { defaultCleanupDays: 45 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().defaultCleanupDays, 45);

    // ripristina default per non sporcare lo stato globale
    await app.inject({
      method: 'PATCH',
      url: '/api/platform/config',
      headers: platformHdrsJson(),
      payload: { defaultCleanupDays: 30 },
    });
  });
});
