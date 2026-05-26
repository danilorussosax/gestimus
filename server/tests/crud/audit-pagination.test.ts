import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * GET /api/audit-log — contratto lista paginato { items, total, limit, offset }.
 * Verifica forma, echo di limit/offset, total ≥ azioni generate e che l'offset
 * faccia avanzare la finestra (pagina 1 ≠ pagina 2). Pre-requisito: db:seed.
 */
describe('Audit log pagination (contratto items/total/limit/offset)', () => {
  let app: FastifyInstance;
  let cookie: string;
  const hdrs = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie });

  before(async () => {
    app = await createApp();
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    // Genera ≥2 entry di audit (concorso.create) per testare l'offset.
    for (const nome of ['Audit Pag Test A', 'Audit Pag Test B']) {
      await app.inject({ method: 'POST', url: '/api/concorsi', headers: hdrs(), payload: { nome, anno: 2026 } });
    }
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Audit Pag Test%'));
    await app.close();
  });

  const page = async (limit: number, offset: number) =>
    app.inject({ method: 'GET', url: `/api/audit-log?limit=${limit}&offset=${offset}`, headers: hdrs() });

  test('forma del contratto + echo di limit/offset', async () => {
    const res = await page(5, 0);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ['items', 'limit', 'offset', 'total']);
    assert.ok(Array.isArray(body.items));
    assert.equal(body.limit, 5);
    assert.equal(body.offset, 0);
    assert.equal(typeof body.total, 'number');
    assert.ok(body.total >= 2, 'almeno le 2 create generate dal setup');
    assert.ok(body.items.length <= 5);
  });

  test('offset fa avanzare la finestra (pagina 1 ≠ pagina 2)', async () => {
    const p1 = (await page(1, 0)).json();
    const p2 = (await page(1, 1)).json();
    assert.equal(p1.items.length, 1);
    assert.equal(p2.items.length, 1);
    assert.notEqual(p1.items[0].id, p2.items[0].id);
  });
});
