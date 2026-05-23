import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Test di concorrenza: provano che i punti critici non producono race.
 * Pre-requisito: `npm run db:seed` (admin@ente1.test / Admin123!).
 */
describe('Concorrenza (ente1)', () => {
  let app: FastifyInstance;
  let cookie: string;
  let concorsoId: string;

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
    assert.equal(login.statusCode, 200);
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    const c = await app.inject({
      method: 'POST',
      url: '/api/concorsi',
      headers: hdrs(),
      payload: { nome: 'Concurrency Test 2026', anno: 2026, stato: 'ATTIVO' },
    });
    assert.equal(c.statusCode, 201);
    concorsoId = c.json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Concurrency Test%'));
    await app.close();
  });

  test('N24: create candidati concorrenti → numeriCandidato tutti distinti', async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/candidati',
          headers: hdrs(),
          // numeroCandidato omesso → calcolato server-side sotto advisory lock
          payload: { concorsoId, nome: `Cand${i}`, strumento: 'Violino' },
        }),
      ),
    );
    const numeri = results.map((r) => {
      assert.equal(r.statusCode, 201, `create ${r.statusCode}: ${r.body}`);
      return r.json().numeroCandidato as number;
    });
    const distinti = new Set(numeri);
    assert.equal(distinti.size, N, `numeriCandidato duplicati: ${numeri.sort((a, b) => a - b).join(',')}`);
  });

  test('C2: upsert valutazioni concorrenti stesso (cf,comm,criterio) → niente errore, una sola riga', async () => {
    // setup: commissario + candidato + fase + criterio + candidato_fase
    const com = (await app.inject({ method: 'POST', url: '/api/commissari', headers: hdrs(), payload: { concorsoId, nome: 'C', cognome: 'X' } })).json();
    const cand = (await app.inject({ method: 'POST', url: '/api/candidati', headers: hdrs(), payload: { concorsoId, nome: 'V', strumento: 'Flauto' } })).json();
    const fase = (await app.inject({ method: 'POST', url: '/api/fasi', headers: hdrs(), payload: { concorsoId, ordine: 1, nome: 'F', scala: 100 } })).json();
    // assegna il commissario tramite una commissione presieduta? No: per il test
    // valutazioni serve membership commissione. Usiamo admin (bypassa il check).
    const cf = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: hdrs(), payload: { faseId: fase.id, candidatoId: cand.id, posizione: 1 } })).json();

    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/valutazioni',
          headers: hdrs(),
          payload: { candidatoFaseId: cf.id, commissarioId: com.id, criterio: 'Tecnica', voto: 50 + i },
        }),
      ),
    );
    for (const r of results) {
      assert.ok([200, 201].includes(r.statusCode), `upsert ${r.statusCode}: ${r.body}`);
    }
    // una sola riga finale per (cf, comm, criterio)
    const list = await app.inject({
      method: 'GET',
      url: `/api/valutazioni?candidatoFaseId=${cf.id}&commissarioId=${com.id}`,
      headers: hdrs(),
    });
    const rows = (list.json() as Array<{ criterio: string }>).filter((v) => v.criterio === 'Tecnica');
    assert.equal(rows.length, 1, 'deve esistere esattamente una valutazione per (cf,comm,criterio)');
  });
});
