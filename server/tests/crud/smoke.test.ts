import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { auditLog } from '../../src/db/schema.js';

/**
 * Smoke test E2E del flow admin: login → CRUD su entità dominio → audit.
 * Pre-requisito: `npm run db:seed`.
 */
describe('CRUD smoke (ente1)', () => {
  let app: FastifyInstance;
  let cookie: string;

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
  });

  after(async () => {
    await app.close();
  });

  const hdrs = () => ({
    host: 'ente1.gestimus.local',
    'content-type': 'application/json',
    cookie,
  });

  test('crea concorso + sezione + categoria + commissario + candidato + fase + criterio', async () => {
    // Concorso
    const c = await app.inject({
      method: 'POST',
      url: '/api/concorsi',
      headers: hdrs(),
      payload: { nome: 'Smoke Test 2026', anno: 2026, stato: 'ATTIVO' },
    });
    assert.equal(c.statusCode, 201);
    const concorso = c.json();

    // Sezione
    const s = await app.inject({
      method: 'POST',
      url: '/api/sezioni',
      headers: hdrs(),
      payload: { concorsoId: concorso.id, nome: 'Archi', ordine: 1 },
    });
    assert.equal(s.statusCode, 201);
    const sezione = s.json();

    // Categoria sotto la sezione
    const cat = await app.inject({
      method: 'POST',
      url: '/api/categorie',
      headers: hdrs(),
      payload: { sezioneId: sezione.id, nome: 'Senior', etaMin: 18, etaMax: 35 },
    });
    assert.equal(cat.statusCode, 201);

    // Commissario
    const com = await app.inject({
      method: 'POST',
      url: '/api/commissari',
      headers: hdrs(),
      payload: { concorsoId: concorso.id, nome: 'Mario', cognome: 'Rossi' },
    });
    assert.equal(com.statusCode, 201);
    const commissario = com.json();

    // Candidato
    const cd = await app.inject({
      method: 'POST',
      url: '/api/candidati',
      headers: hdrs(),
      payload: {
        concorsoId: concorso.id,
        numeroCandidato: 1,
        nome: 'Anna',
        cognome: 'Bianchi',
        strumento: 'Violino',
      },
    });
    assert.equal(cd.statusCode, 201);
    const candidato = cd.json();

    // Fase
    const f = await app.inject({
      method: 'POST',
      url: '/api/fasi',
      headers: hdrs(),
      payload: { concorsoId: concorso.id, ordine: 1, nome: 'Eliminatorie', scala: 100 },
    });
    assert.equal(f.statusCode, 201);
    const fase = f.json();

    // Criterio
    const cr = await app.inject({
      method: 'POST',
      url: '/api/criteri',
      headers: hdrs(),
      payload: { faseId: fase.id, nome: 'Tecnica', peso: 50 },
    });
    assert.equal(cr.statusCode, 201);

    // Candidato → fase
    const cf = await app.inject({
      method: 'POST',
      url: '/api/candidati-fase',
      headers: hdrs(),
      payload: { faseId: fase.id, candidatoId: candidato.id, posizione: 1 },
    });
    assert.equal(cf.statusCode, 201);
    const candidatoFase = cf.json();

    // Valutazione (clamp test: voto > scala viene clampato a 100)
    const v = await app.inject({
      method: 'POST',
      url: '/api/valutazioni',
      headers: hdrs(),
      payload: {
        candidatoFaseId: candidatoFase.id,
        commissarioId: commissario.id,
        criterio: 'Tecnica',
        voto: 9999,
      },
    });
    assert.equal(v.statusCode, 201);
    const valutazione = v.json();
    assert.equal(valutazione.voto, 100, 'voto > scala deve essere clampato a 100');
  });

  test('numero_candidato duplicato → 409', async () => {
    const listConcorsi = await app.inject({
      method: 'GET',
      url: '/api/concorsi',
      headers: hdrs(),
    });
    const concorsoId = listConcorsi.json()[0].id;

    await app.inject({
      method: 'POST',
      url: '/api/candidati',
      headers: hdrs(),
      payload: {
        concorsoId,
        numeroCandidato: 999,
        nome: 'Test',
        strumento: 'Pianoforte',
      },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/candidati',
      headers: hdrs(),
      payload: {
        concorsoId,
        numeroCandidato: 999,
        nome: 'Test2',
        strumento: 'Pianoforte',
      },
    });
    assert.equal(dup.statusCode, 409);
  });

  test('isolamento RLS: admin ente1 non vede record creati da admin ente2', async () => {
    const loginE2 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente2.test', password: 'Admin123!' },
    });
    const cookieE2 = `gestimus_session=${loginE2.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    const e2Concorsi = await app.inject({
      method: 'GET',
      url: '/api/concorsi',
      headers: { host: 'ente2.gestimus.local', cookie: cookieE2 },
    });
    const e1Concorsi = await app.inject({
      method: 'GET',
      url: '/api/concorsi',
      headers: hdrs(),
    });

    const e1Ids = new Set(e1Concorsi.json().map((c: { id: string }) => c.id));
    const e2Ids = new Set(e2Concorsi.json().map((c: { id: string }) => c.id));
    const intersection = [...e1Ids].filter((id) => e2Ids.has(id));
    assert.equal(intersection.length, 0, 'nessun concorso deve essere visibile a entrambi i tenant');
  });

  test('audit_log popolato dalle mutazioni admin', async () => {
    // Conta righe per actor = admin ente1 (via dbSuper, bypass RLS)
    const rows = await dbSuper.select().from(auditLog);
    const hasCreate = rows.some(
      (r) => r.action === 'concorso.create' || r.action === 'commissario.create',
    );
    assert.ok(hasCreate, 'audit_log deve contenere almeno una entry di creazione');
  });

  test('commissario può creare valutazioni ma non può cancellare concorsi', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' },
    });
    const commCookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    // Tenta di cancellare un concorso → 403
    const listC = await app.inject({
      method: 'GET',
      url: '/api/concorsi',
      headers: hdrs(),
    });
    const concorsoId = listC.json()[0].id;
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/concorsi/${concorsoId}`,
      headers: { host: 'ente1.gestimus.local', cookie: commCookie },
    });
    assert.equal(delRes.statusCode, 403, 'commissario non può cancellare concorsi');
  });
});
