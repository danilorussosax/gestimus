import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { like, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import { dbApp, dbSuper } from '../../src/db/client.js';
import { auditLog, concorsi } from '../../src/db/schema.js';

/**
 * Drizzle ≥ 0.42 wrappa l'errore PG. Cerchiamo il regex nella catena .cause.
 */
function pgErrorMatching(re: RegExp) {
  return (err: unknown) => {
    const msgs: string[] = [];
    let cur: unknown = err;
    let depth = 0;
    while (cur && depth < 5) {
      const c = cur as { message?: string; cause?: unknown };
      if (typeof c.message === 'string') msgs.push(c.message);
      cur = c.cause;
      depth++;
    }
    return re.test(msgs.join(' '));
  };
}

describe('DB triggers (clamp + freeze + audit append-only)', () => {
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
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Trig %'));
    await app.close();
  });

  async function setupFlow(scala = 100) {
    const c = await app.inject({
      method: 'POST',
      url: '/api/concorsi',
      headers: hdrs(),
      payload: { nome: `Trig ${Date.now()}`, anno: 2026 },
    });
    const concorso = c.json();
    const com = await app.inject({
      method: 'POST',
      url: '/api/commissari',
      headers: hdrs(),
      payload: { concorsoId: concorso.id, nome: 'C', cognome: 'Test' },
    });
    const cd = await app.inject({
      method: 'POST',
      url: '/api/candidati',
      headers: hdrs(),
      payload: {
        concorsoId: concorso.id,
        numeroCandidato: Math.floor(Math.random() * 100000) + 1,
        nome: 'X',
        strumento: 'Pianoforte',
      },
    });
    const f = await app.inject({
      method: 'POST',
      url: '/api/fasi',
      headers: hdrs(),
      payload: { concorsoId: concorso.id, ordine: 1, nome: 'F', scala },
    });
    const cf = await app.inject({
      method: 'POST',
      url: '/api/candidati-fase',
      headers: hdrs(),
      payload: { faseId: f.json().id, candidatoId: cd.json().id, posizione: 1 },
    });
    return {
      faseId: f.json().id,
      commissarioId: com.json().id,
      candidatoFaseId: cf.json().id,
    };
  }

  // N15: l'API ora valida voto con zod .min(0).max(1000). Valori entro questo
  // range ma oltre la scala vengono clampati dal trigger DB; valori fuori range
  // sono rifiutati con 400 dall'API prima di toccare il DB.
  test('clamp voto: 1000 (entro zod) > scala (100) → clampato a 100 dal trigger', async () => {
    const { commissarioId, candidatoFaseId } = await setupFlow(100);
    const v = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Tecnica', voto: 1000 },
    });
    assert.equal(v.statusCode, 201);
    assert.equal(v.json().voto, 100);
  });

  test('N15: voto fuori range zod (9999 / -50) → 400 dall\'API', async () => {
    const { commissarioId, candidatoFaseId } = await setupFlow(100);
    const high = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Tecnica', voto: 9999 },
    });
    assert.equal(high.statusCode, 400);
    const low = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Tecnica', voto: -50 },
    });
    assert.equal(low.statusCode, 400);
  });

  test('clamp trigger (defense-in-depth) su INSERT diretto bypassando l\'API', async () => {
    const { commissarioId, candidatoFaseId } = await setupFlow(100);
    // Insert diretto via dbSuper (bypassa zod). Il trigger clamp_voto deve
    // normalizzare: -50 → 0, 9999 → scala (100). Il CHECK voto>=0 (N41) passa
    // perché il trigger BEFORE INSERT clampa prima della validazione.
    const tid = await dbSuper.execute(sql`SELECT id FROM tenants WHERE slug='ente1'`);
    const tenantId = (tid.rows as Array<{ id: string }>)[0]!.id;
    await dbSuper.execute(sql`
      INSERT INTO valutazioni (tenant_id, candidato_fase_id, commissario_id, criterio, voto)
      VALUES (${tenantId}::uuid, ${candidatoFaseId}::uuid, ${commissarioId}::uuid, 'TrigLow', -50)
    `);
    await dbSuper.execute(sql`
      INSERT INTO valutazioni (tenant_id, candidato_fase_id, commissario_id, criterio, voto)
      VALUES (${tenantId}::uuid, ${candidatoFaseId}::uuid, ${commissarioId}::uuid, 'TrigHigh', 9999)
    `);
    const res = await dbSuper.execute(sql`
      SELECT criterio, voto FROM valutazioni
      WHERE candidato_fase_id=${candidatoFaseId}::uuid AND criterio IN ('TrigLow','TrigHigh')
    `);
    const byCrit = Object.fromEntries(
      (res.rows as Array<{ criterio: string; voto: string }>).map((r) => [r.criterio, Number(r.voto)]),
    );
    assert.equal(byCrit['TrigLow'], 0, 'trigger clampa -50 → 0');
    assert.equal(byCrit['TrigHigh'], 100, 'trigger clampa 9999 → scala 100');
  });

  test('clamp voto rispetta scala diversa: scala=10, voto=20 → 10', async () => {
    const { commissarioId, candidatoFaseId } = await setupFlow(10);
    const v = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Tecnica', voto: 20 },
    });
    assert.equal(v.json().voto, 10);
  });

  test('freeze: dopo /fasi/:id/conclude, INSERT valutazione → 409', async () => {
    const { faseId, commissarioId, candidatoFaseId } = await setupFlow(100);
    // N21: la fase va avviata prima di poter essere conclusa.
    await app.inject({ method: 'POST', url: `/api/fasi/${faseId}/start`, headers: hdrs(), payload: {} });
    // Inserisce una valutazione valida
    await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Tecnica', voto: 80 },
    });
    // Conclude la fase
    const concl = await app.inject({
      method: 'POST',
      url: `/api/fasi/${faseId}/conclude`,
      headers: hdrs(),
      payload: {},
    });
    assert.equal(concl.statusCode, 200);
    // Nuova valutazione su criterio diverso → 409 (trigger freeze)
    const v2 = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Interpretazione', voto: 75 },
    });
    assert.equal(v2.statusCode, 409);
  });

  test('freeze: PATCH valutazione su fase CONCLUSA → 409', async () => {
    const { faseId, commissarioId, candidatoFaseId } = await setupFlow(100);
    await app.inject({ method: 'POST', url: `/api/fasi/${faseId}/start`, headers: hdrs(), payload: {} });
    const v = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: { candidatoFaseId, commissarioId, criterio: 'Tecnica', voto: 70 },
    });
    const valId = v.json().id;
    await app.inject({
      method: 'POST',
      url: `/api/fasi/${faseId}/conclude`,
      headers: hdrs(),
      payload: {},
    });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/valutazioni/${valId}`,
      headers: hdrs(),
      payload: { voto: 95 },
    });
    assert.equal(patch.statusCode, 409);
  });

  test('fase CONCLUSA non può tornare a IN_CORSO via /start', async () => {
    const { faseId } = await setupFlow(100);
    await app.inject({ method: 'POST', url: `/api/fasi/${faseId}/start`, headers: hdrs(), payload: {} });
    await app.inject({
      method: 'POST',
      url: `/api/fasi/${faseId}/conclude`,
      headers: hdrs(),
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/fasi/${faseId}/start`,
      headers: hdrs(),
      payload: {},
    });
    // N21: /start su CONCLUSA → 409 (validazione transizione). Comunque non 200.
    assert.notEqual(res.statusCode, 200);
  });

  // C7: gestimus_app non ha più grant su `tenants` → l'id tenant va risolto via
  // dbSuper, poi passato come literal ad app_set_tenant nella tx applicativa.
  async function ente1TenantId(): Promise<string> {
    const r = await dbSuper.execute(sql`SELECT id FROM tenants WHERE slug='ente1'`);
    return (r.rows as Array<{ id: string }>)[0]!.id;
  }

  test('audit_log: UPDATE rifiutato dal grant', async () => {
    const tenantId = await ente1TenantId();
    const rows = await dbApp.transaction(async (tx) => {
      await tx.execute(sql`SELECT app_set_tenant(${tenantId}::uuid)`);
      return tx.select().from(auditLog).limit(1);
    });
    if (rows.length === 0) return; // skip se vuoto

    await assert.rejects(
      async () =>
        dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${tenantId}::uuid)`);
          await tx.execute(sql`UPDATE audit_log SET action='tampered' WHERE id=${rows[0]!.id}`);
        }),
      pgErrorMatching(/permission denied/i),
      'UPDATE su audit_log deve essere rifiutato a gestimus_app',
    );
  });

  test('audit_log: DELETE rifiutato dal grant', async () => {
    const tenantId = await ente1TenantId();
    const rows = await dbSuper.select().from(auditLog).limit(1);
    if (rows.length === 0) return;
    await assert.rejects(
      async () =>
        dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${tenantId}::uuid)`);
          await tx.execute(sql`DELETE FROM audit_log WHERE id=${rows[0]!.id}`);
        }),
      pgErrorMatching(/permission denied/i),
      'DELETE su audit_log deve essere rifiutato a gestimus_app',
    );
  });
});
