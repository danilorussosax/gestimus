import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione valutazioni (scoring):
 *  - upsert voto per criterio (POST = 201, secondo POST stesso criterio = update 200)
 *  - filtri GET per candidatoFaseId / commissarioId
 *  - clamp del voto sul bound applicativo (>1000 → 400)
 *  - vincoli ruolo: commissario non membro della commissione → 403,
 *    commissario membro può valutare a proprio nome, mai a nome altrui
 *  - freeze: fase CONCLUSA → upsert 409
 *  - isolamento cross-tenant (ente2 non vede/valuta dati di ente1)
 *  - PATCH/DELETE
 * Pre-requisito: dati seed (commissario@ente1.test bindato al 1° commissario del
 * concorso seed "Concorso Solisti 2026").
 */
describe('Valutazioni / scoring', () => {
  let app: FastifyInstance;
  let cookie: string;       // ente1 admin
  let cookie2: string;      // ente2 admin
  let commCookie: string;   // ente1 commissario (bindato a Maria Rossi, concorso seed)

  // Setup nel concorso SEED (l'account commissario è bindato a un commissario di
  // quel concorso → solo lì il commissario può valutare a proprio nome).
  let seedConcorsoId: string;
  let seedCommissarioId: string; // = account.commissarioId di commissario@ente1.test
  let faseSeed: string;
  let commissioneSeed: string;
  let cfSeed: string;            // candidato_fase nel concorso seed

  // Setup nel concorso di TEST (admin-only scenari)
  let concorsoId: string;
  let faseId: string;
  let candId: string;
  let cfId: string;
  let altroCommissarioId: string;

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

    // Profilo commissario dell'account loggato (commissarioId bindato).
    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: HC() })).json();
    seedCommissarioId = me.commissarioId;
    assert.ok(seedCommissarioId, 'account commissario deve essere bindato a un commissario (seed)');

    // Trova il concorso seed a cui appartiene quel commissario.
    const commProfile = (await app.inject({ method: 'GET', url: `/api/commissari/${seedCommissarioId}`, headers: H1() })).json();
    seedConcorsoId = commProfile.concorsoId;
    assert.ok(seedConcorsoId, 'commissario seed deve avere un concorso');

    // Commissione nel concorso seed con il commissario come membro.
    commissioneSeed = (await app.inject({ method: 'POST', url: '/api/commissioni', headers: H1(),
      payload: { concorsoId: seedConcorsoId, nome: 'Val Test Commissione Seed' } })).json().id;
    await app.inject({ method: 'POST', url: `/api/commissioni/${commissioneSeed}/commissari/${seedCommissarioId}`, headers: H1(), payload: {} });

    // Fase nel concorso seed, assegnata a quella commissione.
    faseSeed = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId: seedConcorsoId, ordine: 900001, nome: 'Val Test Fase Seed', scala: 100, commissioneId: commissioneSeed } })).json().id;

    // Candidato + candidato_fase nel concorso seed.
    const candSeed = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId: seedConcorsoId, nome: 'ValSeedCand', strumento: 'Violino' } })).json();
    cfSeed = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId: faseSeed, candidatoId: candSeed.id, posizione: 1 } })).json().id;

    // ---- concorso di TEST (verrà cancellato in after) ----
    concorsoId = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'Val Test 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
    faseId = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: 1, nome: 'Val Fase', scala: 100 } })).json().id;
    candId = (await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
      payload: { concorsoId, nome: 'ValCand', strumento: 'Viola' } })).json().id;
    cfId = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId, candidatoId: candId, posizione: 1 } })).json().id;
    altroCommissarioId = (await app.inject({ method: 'POST', url: '/api/commissari', headers: H1(),
      payload: { concorsoId, nome: 'AltroComm', cognome: 'X' } })).json().id;

    concorsoEnte2Id = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'Val Test E2 2026', anno: 2026, stato: 'ATTIVO' } })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Val Test%'));
    // Cleanup dei dati creati nel concorso seed (la fase/commissione/cf/cand
    // hanno prefisso identificabile su nome fase/commissione; i candidatiFase e
    // valutazioni cascadeano dalla fase).
    // Le fasi/commissioni seed-test sono nominate 'Val Test %' o 'Val Test Fase Seed'
    // ma il concorso seed NON va cancellato. Le cancelliamo per id via dbSuper.
    const { fasi, commissari, commissioni } = await import('../../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    if (faseSeed) await dbSuper.delete(fasi).where(eq(fasi.id, faseSeed));
    if (commissioneSeed) await dbSuper.delete(commissioni).where(eq(commissioni.id, commissioneSeed));
    await dbSuper.delete(commissari).where(like(commissari.nome, 'ValSeed%'));
    // candidato 'ValSeedCand' nel concorso seed:
    const { candidati } = await import('../../src/db/schema.js');
    await dbSuper.delete(candidati).where(like(candidati.nome, 'ValSeedCand%'));
    await app.close();
  });

  // ---------- admin upsert (concorso di test) ----------
  let valId: string;
  test('POST upsert: admin crea voto per criterio → 201', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfId, commissarioId: altroCommissarioId, criterio: 'Tecnica', voto: 80 } });
    assert.equal(r.statusCode, 201, r.body);
    valId = r.json().id;
    assert.equal(r.json().voto, 80);
  });

  test('POST upsert: stesso (cf, commissario, criterio) → update 200, non duplica', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfId, commissarioId: altroCommissarioId, criterio: 'Tecnica', voto: 90 } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().voto, 90);
    assert.equal(r.json().id, valId, 'stesso record aggiornato (upsert)');
  });

  test('POST: criterio diverso → nuovo record 201', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfId, commissarioId: altroCommissarioId, criterio: 'Musicalita', voto: 70 } });
    assert.equal(r.statusCode, 201);
    assert.notEqual(r.json().id, valId);
  });

  test('GET filtro per candidatoFaseId → tutte le valutazioni del cf', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/valutazioni?candidatoFaseId=${cfId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ criterio: string }>;
    assert.ok(rows.length >= 2);
    assert.ok(rows.some((x) => x.criterio === 'Tecnica'));
    assert.ok(rows.some((x) => x.criterio === 'Musicalita'));
  });

  test('GET filtro per commissarioId → solo voti di quel commissario', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/valutazioni?commissarioId=${altroCommissarioId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ commissarioId: string }>;
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((x) => x.commissarioId === altroCommissarioId));
  });

  test('POST: voto fuori bound applicativo (1001) → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfId, commissarioId: altroCommissarioId, criterio: 'X', voto: 1001 } });
    assert.equal(r.statusCode, 400);
  });

  test('POST: voto negativo → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfId, commissarioId: altroCommissarioId, criterio: 'X', voto: -1 } });
    assert.equal(r.statusCode, 400);
  });

  test('PATCH: admin aggiorna voto e note', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/valutazioni/${valId}`, headers: H1(),
      payload: { voto: 55, note: 'rivisto' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().voto, 55);
    assert.equal(r.json().note, 'rivisto');
  });

  test('PATCH: id inesistente → 404', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/valutazioni/00000000-0000-0000-0000-000000000000', headers: H1(),
      payload: { voto: 10 } });
    assert.equal(r.statusCode, 404);
  });

  // ---------- vincoli ruolo commissario ----------
  test('commissario membro: può valutare a proprio nome → 201/200', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: HC(),
      payload: { candidatoFaseId: cfSeed, commissarioId: seedCommissarioId, criterio: 'Tecnica', voto: 75 } });
    assert.ok([200, 201].includes(r.statusCode), `atteso 200/201, ricevuto ${r.statusCode}: ${r.body}`);
    assert.equal(r.json().voto, 75);
  });

  test('commissario: non può valutare a nome di un altro commissario → 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: HC(),
      payload: { candidatoFaseId: cfSeed, commissarioId: altroCommissarioId, criterio: 'Tecnica', voto: 50 } });
    assert.equal(r.statusCode, 403);
  });

  test('commissario non membro della commissione di QUESTA fase → 403', async () => {
    // cfId è nel concorso di test, la cui fase non ha commissione assegnata e il
    // commissario seed non ne fa parte → 403.
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: HC(),
      payload: { candidatoFaseId: cfId, commissarioId: seedCommissarioId, criterio: 'Tecnica', voto: 60 } });
    assert.equal(r.statusCode, 403);
  });

  // ---------- freeze fase CONCLUSA ----------
  test('fase CONCLUSA: upsert valutazione → 409', async () => {
    // start + conclude della fase di test, poi prova un upsert (come admin).
    await app.inject({ method: 'POST', url: `/api/fasi/${faseId}/start`, headers: H1(), payload: {} });
    await app.inject({ method: 'POST', url: `/api/fasi/${faseId}/conclude`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfId, commissarioId: altroCommissarioId, criterio: 'Postchiusura', voto: 30 } });
    assert.equal(r.statusCode, 409, r.body);
  });

  // ---------- isolamento cross-tenant ----------
  test('ente2 non vede le valutazioni di ente1 (RLS)', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/valutazioni?candidatoFaseId=${cfId}`, headers: H2() });
    assert.equal(r.statusCode, 200);
    assert.equal((r.json() as unknown[]).length, 0);
  });

  test('ente2 non può PATCHare una valutazione di ente1 → 404', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/valutazioni/${valId}`, headers: H2(), payload: { voto: 1 } });
    assert.equal(r.statusCode, 404);
  });

  // ---------- DELETE ----------
  test('DELETE: admin elimina valutazione → 204, poi 404', async () => {
    // Crea una valutazione fresca su una fase non conclusa per cancellarla.
    const fNew = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: 5, nome: 'Val Fase Del', scala: 100 } })).json();
    const cfNew = (await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
      payload: { faseId: fNew.id, candidatoId: candId, posizione: 1 } })).json();
    const v = (await app.inject({ method: 'POST', url: '/api/valutazioni', headers: H1(),
      payload: { candidatoFaseId: cfNew.id, commissarioId: altroCommissarioId, criterio: 'Z', voto: 40 } })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/valutazioni/${v.id}`, headers: H1(), payload: {} });
    assert.equal(del.statusCode, 204);
    const del2 = await app.inject({ method: 'DELETE', url: `/api/valutazioni/${v.id}`, headers: H1(), payload: {} });
    assert.equal(del2.statusCode, 404);
  });

  test('commissario non può DELETE (solo admin) → 403', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/valutazioni/${valId}`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });
});
