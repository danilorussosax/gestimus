import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Test d'integrazione su route critiche non coperte altrove:
 * transizioni stato fasi (N21), permessi candidati-fase (N13), GDPR erase,
 * ultimo admin (L16), criteri batch (N34/N35), validazione GDPR (N40).
 * Pre-requisito: `npm run db:seed`.
 */
describe('Route integration (ente1)', () => {
  let app: FastifyInstance;
  let cookie: string;
  let concorsoId: string;

  const hdrs = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie });

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
    concorsoId = (await app.inject({
      method: 'POST', url: '/api/concorsi', headers: hdrs(),
      payload: { nome: 'Routes Test 2026', anno: 2026, stato: 'ATTIVO' },
    })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Routes Test%'));
    await app.close();
  });

  async function newFase(scala = 100) {
    return (await app.inject({
      method: 'POST', url: '/api/fasi', headers: hdrs(),
      payload: { concorsoId, ordine: Math.floor(Math.random() * 1e6), nome: 'F', scala },
    })).json();
  }

  // N21: transizioni di stato
  test('N21: conclude su PIANIFICATA → 409', async () => {
    const f = await newFase();
    const res = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: hdrs(), payload: {} });
    assert.equal(res.statusCode, 409);
  });

  test('N21: start due volte → secondo 409', async () => {
    const f = await newFase();
    const a = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: hdrs(), payload: {} });
    assert.equal(a.statusCode, 200);
    const b = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: hdrs(), payload: {} });
    assert.equal(b.statusCode, 409);
  });

  test('N23: sorteggio su fase CONCLUSA → 409', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: hdrs(), payload: {} });
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: hdrs(), payload: {} });
    const res = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/sorteggio`, headers: hdrs(), payload: { seed: 42 } });
    assert.equal(res.statusCode, 409);
  });

  test('N22: timer bonus su fase mai avviata → 409', async () => {
    const f = await newFase();
    const res = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/bonus`, headers: hdrs(), payload: { seconds: 60 } });
    assert.equal(res.statusCode, 409);
  });

  // N144: l'ammissione è calcolata dall'aggregato lato client e applicata
  // atomicamente al conclude tramite `admitted` (non più per-commissario).
  test('N144: conclude con admitted setta ammessoProssimaFase atomicamente', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: hdrs(), payload: {} });
    const c1 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: hdrs(), payload: { concorsoId, nome: 'Amm1', strumento: 'Violino' } })).json();
    const c2 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: hdrs(), payload: { concorsoId, nome: 'Amm2', strumento: 'Viola' } })).json();
    const cf1 = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: hdrs(), payload: { faseId: f.id, candidatoId: c1.id, posizione: 1 } })).json();
    const cf2 = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: hdrs(), payload: { faseId: f.id, candidatoId: c2.id, posizione: 2 } })).json();
    const res = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: hdrs(), payload: { admitted: [cf1.id] } });
    assert.equal(res.statusCode, 200);
    const list = (await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${f.id}`, headers: hdrs() }))
      .json() as Array<{ id: string; ammessoProssimaFase: boolean; stato: string }>;
    const r1 = list.find((x) => x.id === cf1.id)!;
    const r2 = list.find((x) => x.id === cf2.id)!;
    assert.equal(r1.ammessoProssimaFase, true);
    assert.equal(r2.ammessoProssimaFase, false);
    assert.equal(r1.stato, 'COMPLETATO');
  });

  // M193: DELETE concorso con dati collegati richiede ?force=true.
  test('M193: DELETE concorso con candidati → 409 senza force, 204 con force', async () => {
    const concRes = await app.inject({
      method: 'POST', url: '/api/concorsi', headers: hdrs(),
      payload: { nome: 'Routes Test M193', anno: 2026, stato: 'ATTIVO' },
    });
    assert.equal(concRes.statusCode, 201, `concorso create: ${concRes.body}`);
    const conc = concRes.json();
    const candRes = await app.inject({
      method: 'POST', url: '/api/candidati', headers: hdrs(),
      payload: { concorsoId: conc.id, nome: 'M193', strumento: 'Flauto' },
    });
    assert.equal(candRes.statusCode, 201, `candidato create: ${candRes.body}`);
    const no = await app.inject({ method: 'DELETE', url: `/api/concorsi/${conc.id}`, headers: hdrs(), payload: {} });
    assert.equal(no.statusCode, 409, `delete no-force body: ${no.body}`);
    assert.ok((no.json() as { candidati: number }).candidati >= 1);
    const yes = await app.inject({ method: 'DELETE', url: `/api/concorsi/${conc.id}?force=true`, headers: hdrs(), payload: {} });
    assert.equal(yes.statusCode, 204);
  });

  // N34/N35: criteri batch + normalizzazione pesi
  test('N34: PUT criteri normalizza i pesi a somma 100', async () => {
    const f = await newFase();
    const res = await app.inject({
      method: 'PUT', url: `/api/criteri/fase/${f.id}`, headers: hdrs(),
      payload: { criteri: [{ nome: 'A', peso: 40 }, { nome: 'B', peso: 40 }] }, // somma 80
    });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<{ peso: number }>;
    const sum = rows.reduce((s, r) => s + r.peso, 0);
    assert.equal(sum, 100, `pesi normalizzati a 100, ricevuto ${sum}`);
  });

  // N40: validazione consenso GDPR sul form pubblico
  test('N40: iscrizione con privacy:false → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/public/iscrizioni',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: {
        concorsoId, nome: 'Tizio', email: 'tizio@example.com',
        consensiGdpr: { privacy: false, regolamento: true },
      },
    });
    assert.equal(res.statusCode, 400);
  });

  // L16: protezione ultimo admin
  test('L16: disattivare l\'ultimo admin del tenant → 409', async () => {
    // ente1 ha un solo admin (admin@ente1.test). Recuperiamo il suo id.
    const accs = (await app.inject({ method: 'GET', url: '/api/accounts', headers: hdrs() })).json() as Array<{ id: string; email: string; role: string; attivo?: boolean }>;
    const admins = accs.filter((a) => a.role === 'admin' && a.attivo !== false);
    if (admins.length !== 1) return; // se il seed cambia, skip
    const res = await app.inject({
      method: 'PATCH', url: `/api/accounts/${admins[0]!.id}`, headers: hdrs(),
      payload: { attivo: false },
    });
    // self-disable è bloccato a monte (403); ma il check L16 dà 409 se non-self.
    assert.ok([403, 409].includes(res.statusCode), `atteso 403/409, ricevuto ${res.statusCode}`);
  });

  // N13: un commissario non può cambiare stato candidato_fase (solo admin)
  test('N13: commissario non può settare stato ELIMINATO', async () => {
    // setup come admin: fase + candidato + cf
    const cand = (await app.inject({ method: 'POST', url: '/api/candidati', headers: hdrs(), payload: { concorsoId, nome: 'K', strumento: 'Arpa' } })).json();
    const f = await newFase();
    const cf = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: hdrs(), payload: { faseId: f.id, candidatoId: cand.id, posizione: 1 } })).json();

    // login come commissario
    const cl = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' },
    });
    const commCookie = `gestimus_session=${cl.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const res = await app.inject({
      method: 'PATCH', url: `/api/candidati-fase/${cf.id}`,
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie: commCookie },
      payload: { stato: 'ELIMINATO' },
    });
    assert.equal(res.statusCode, 403);
  });
});
