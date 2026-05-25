import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione lifecycle fasi:
 *  - transizione PIANIFICATA → IN_CORSO (start), auto-popolamento candidati_fase
 *  - start filtrato per sezioni della fase (solo candidati di quelle sezioni)
 *  - conclude IN_CORSO → CONCLUSA, finalizzazione candidati_fase a COMPLETATO,
 *    ammissione esplicita via `admitted`
 *  - vincoli transizione (start solo da PIANIFICATA, conclude solo da IN_CORSO)
 *  - permessi: admin sempre OK; commissario non presidente → 403
 *  - blocco edit parametri scoring su fase CONCLUSA (409)
 *  - timer pause/resume/reset/bonus invarianti
 *  - isolamento cross-tenant
 * Pre-requisito: dati seed.
 */
describe('Fasi lifecycle', () => {
  let app: FastifyInstance;
  let cookie: string;       // ente1 admin
  let cookie2: string;      // ente2 admin
  let commCookie: string;   // ente1 commissario (non presidente delle fasi di test)
  let concorsoId: string;
  let concorsoEnte2Id: string;

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
    const login2 = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente2.test', password: 'Admin123!' } });
    cookie2 = `gestimus_session=${login2.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const loginC = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' } });
    commCookie = `gestimus_session=${loginC.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    concorsoId = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'FaseLC Test 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    concorsoEnte2Id = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'FaseLC Test E2 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'FaseLC Test%'));
    await app.close();
  });

  let ordineSeq = 1;
  async function newFase(extra: Record<string, unknown> = {}) {
    return (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: ordineSeq++, nome: 'FaseLC F', scala: 100, ...extra } })).json();
  }

  // ---------- creazione + stato iniziale ----------
  test('POST fase → stato iniziale PIANIFICATA', async () => {
    const f = await newFase();
    assert.equal(f.stato, 'PIANIFICATA');
  });

  test('POST fase: ordine duplicato nel concorso → 409', async () => {
    const f = await newFase();
    const dup = await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: f.ordine, nome: 'Dup', scala: 100 } });
    assert.equal(dup.statusCode, 409);
  });

  // ---------- start ----------
  test('start: PIANIFICATA → IN_CORSO + auto-popola candidati del concorso', async () => {
    const f = await newFase();
    // 2 candidati nel concorso, nessun candidato_fase preassegnato.
    await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'LCAuto1', strumento: 'Violino' } });
    await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'LCAuto2', strumento: 'Viola' } });
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().stato, 'IN_CORSO');
    assert.ok(r.json().timerStartedAt, 'timerStartedAt impostato allo start');
    const cfs = (await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${f.id}`, headers: H1() })).json() as unknown[];
    assert.ok(cfs.length >= 2, `auto-popolati almeno 2 candidati, trovati ${cfs.length}`);
  });

  test('start: con sezioni associate popola SOLO i candidati di quelle sezioni', async () => {
    const sezA = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'LC SezA', ordine: 1 } })).json();
    const sezB = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'LC SezB', ordine: 2 } })).json();
    // 2 candidati in A, 1 in B.
    for (const n of ['LCSezA1', 'LCSezA2']) {
      await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
        payload: { concorsoId, nome: n, strumento: 'Flauto', sezioneId: sezA.id } });
    }
    await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'LCSezB1', strumento: 'Tromba', sezioneId: sezB.id } });
    const f = await newFase({ sezioniIds: [sezA.id] });
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 200);
    const cfs = (await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${f.id}`, headers: H1() })).json() as unknown[];
    assert.equal(cfs.length, 2, 'solo i 2 candidati di SezA sono assegnati');
  });

  test('start: ri-start di fase già IN_CORSO → 409', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409);
  });

  // ---------- conclude ----------
  test('conclude: IN_CORSO → CONCLUSA + candidati non eliminati a COMPLETATO', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    const cand = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'LCConc1', strumento: 'Oboe' } })).json();
    const cf = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId: f.id, candidatoId: cand.id, posizione: 1 } })).json();
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().stato, 'CONCLUSA');
    assert.equal(r.json().timerStartedAt, null, 'timer azzerato al conclude');
    const list = (await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${f.id}`, headers: H1() })).json() as Array<{ id: string; stato: string; ammessoProssimaFase: boolean }>;
    const row = list.find((x) => x.id === cf.id)!;
    assert.equal(row.stato, 'COMPLETATO');
    assert.equal(row.ammessoProssimaFase, false, 'default non ammesso senza admitted');
  });

  test('conclude con admitted: marca SOLO i candidati in lista come ammessi', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    const c1 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(), payload: { concorsoId, nome: 'LCadm1', strumento: 'V' } })).json();
    const c2 = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(), payload: { concorsoId, nome: 'LCadm2', strumento: 'V' } })).json();
    const cf1 = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(), payload: { faseId: f.id, candidatoId: c1.id, posizione: 1 } })).json();
    const cf2 = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(), payload: { faseId: f.id, candidatoId: c2.id, posizione: 2 } })).json();
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: { admitted: [cf1.id] } });
    assert.equal(r.statusCode, 200);
    const list = (await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${f.id}`, headers: H1() })).json() as Array<{ id: string; ammessoProssimaFase: boolean }>;
    assert.equal(list.find((x) => x.id === cf1.id)!.ammessoProssimaFase, true);
    assert.equal(list.find((x) => x.id === cf2.id)!.ammessoProssimaFase, false);
  });

  test('conclude: su PIANIFICATA → 409', async () => {
    const f = await newFase();
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409);
  });

  test('conclude: su fase già CONCLUSA → 409', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409);
  });

  // ---------- permessi ----------
  test('start: fase senza commissione + commissario → 403 (gestione admin-only)', async () => {
    const f = await newFase();
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  test('conclude: commissario non presidente → 403', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  // ---------- edit parametri scoring su fase conclusa ----------
  test('PATCH scala su fase CONCLUSA → 409 (parametri scoring congelati)', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'PATCH', url: `/api/fasi/${f.id}`, headers: H1(), payload: { scala: 50 } });
    assert.equal(r.statusCode, 409, r.body);
  });

  test('PATCH nome (non-scoring) su fase CONCLUSA → 200 (consentito)', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/conclude`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'PATCH', url: `/api/fasi/${f.id}`, headers: H1(), payload: { nome: 'FaseLC F rinominata' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'FaseLC F rinominata');
  });

  // ---------- timer ----------
  test('timer: pause su fase mai avviata → 409', async () => {
    const f = await newFase();
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/pause`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409);
  });

  test('timer: start → pause → 409 doppia pausa → resume → reset', async () => {
    const f = await newFase();
    const s = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/start`, headers: H1(), payload: {} });
    assert.equal(s.statusCode, 200);
    const p1 = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/pause`, headers: H1(), payload: {} });
    assert.equal(p1.statusCode, 200);
    const p2 = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/pause`, headers: H1(), payload: {} });
    assert.equal(p2.statusCode, 409, 'timer già in pausa');
    const res = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/resume`, headers: H1(), payload: {} });
    assert.equal(res.statusCode, 200);
    const rst = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/reset`, headers: H1(), payload: {} });
    assert.equal(rst.statusCode, 200);
    assert.equal(rst.json().timerStartedAt, null);
  });

  test('timer: resume senza pausa → 409', async () => {
    const f = await newFase();
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/start`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/timer/resume`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 409);
  });

  test('runtime: GET ritorna stato timer + serverNow', async () => {
    const f = await newFase();
    const r = await app.inject({ method: 'GET', url: `/api/fasi/${f.id}/runtime`, headers: H1() });
    assert.equal(r.statusCode, 200);
    assert.ok(typeof r.json().serverNow === 'number');
    assert.equal(r.json().stato, 'PIANIFICATA');
  });

  // ---------- isolamento cross-tenant ----------
  test('ente2 non può avviare una fase di ente1 → 404', async () => {
    const f = await newFase();
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H2(), payload: {} });
    assert.equal(r.statusCode, 404);
  });

  test('POST fase con sezione di un altro concorso → 400', async () => {
    // crea una sezione in ente2 e prova ad usarla in una fase di ente1.
    const sezE2 = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H2(),
      payload: { concorsoId: concorsoEnte2Id, nome: 'LC SezE2', ordine: 1 } })).json();
    const r = await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: ordineSeq++, nome: 'FaseLC cross', scala: 100, sezioniIds: [sezE2.id] } });
    assert.equal(r.statusCode, 400);
  });

  // ---------- sorteggio (bulk update jsonb_to_recordset) ----------
  // NB: il sorteggio NON è riproducibile sullo stesso seed perché la query base
  // dei candidati non ha ORDER BY (ordine input instabile). Qui verifico solo
  // la regressione del bug 500 (unnest) e che l'esito sia una permutazione valida.
  test('sorteggio: 200 e produce una permutazione valida delle posizioni', async () => {
    // Sezione + 5 candidati, fase avviata (auto-popola candidati_fase).
    const sez = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'FaseLC Sorteggio Sez', ordine: 50 } })).json();
    for (let i = 1; i <= 5; i++) {
      await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
        payload: { concorsoId, numeroCandidato: 500 + i, nome: `Sort${i}`, cognome: `C${i}`, strumento: 'Violino', sezioneId: sez.id } });
    }
    const f = await newFase({ sezioniIds: [sez.id] });
    await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/start`, headers: H1(), payload: {} });

    const r = await app.inject({ method: 'POST', url: `/api/fasi/${f.id}/sorteggio`, headers: H1(),
      payload: { seed: 12345 } });
    assert.equal(r.statusCode, 200, 'sorteggio deve riuscire (regressione bug unnest)');
    assert.equal(r.json().count, 5);

    const posOf = async () => {
      const cf = (await app.inject({ method: 'GET', url: `/api/candidati-fase?faseId=${f.id}&limit=1000`, headers: H1() })).json() as Array<{ posizione: number }>;
      return cf.map((x) => x.posizione).sort((a, b) => a - b);
    };
    // Le posizioni sono una permutazione esatta di 1..5.
    assert.deepEqual(await posOf(), [1, 2, 3, 4, 5]);
  });
});
