import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione scheduling/calendario: CRUD sale/eventi/pubblicazioni,
 * genera-slot + riordina-slot (orari ricalcolati), isolamento cross-tenant
 * (N105 + RLS sul token pubblico), privacy del link pubblico.
 * Pre-requisito: `npm run db:seed`.
 */
describe('Calendario / scheduling', () => {
  let app: FastifyInstance;
  let cookie: string;       // ente1 admin
  let cookie2: string;      // ente2 admin
  let concorsoId: string;
  let sezioneId: string;
  let categoriaId: string;
  let faseId: string;
  let cfIds: string[] = []; // candidati_fase nell'ordine di posizione 1,2,3
  let concorsoEnte2Id: string;

  const H1 = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie });
  const H2 = () => ({ host: 'ente2.gestimus.local', 'content-type': 'application/json', cookie: cookie2 });

  before(async () => {
    app = await createApp();
    await app.ready();

    // Helper: il login DEVE riuscire e restituire il cookie. Un 429 (rate-limit
    // login 10/15min) o un 401 silenzioso lascerebbe il cookie undefined e farebbe
    // fallire l'intero file in modo opaco (richieste successive non autenticate).
    const loginCookie = (
      res: { statusCode: number; payload: string; cookies: Array<{ name: string; value: string }> },
      label: string,
    ): string => {
      assert.equal(res.statusCode, 200, `login ${label} fallito (${res.statusCode}): ${res.payload}`);
      const sc = res.cookies.find((c) => c.name === 'gestimus_session');
      if (!sc) throw new Error(`login ${label}: cookie di sessione assente`);
      return `gestimus_session=${sc.value}`;
    };
    // Helper: ogni create di setup deve dare 201 con id. Fail-fast col body
    // d'errore invece di propagarsi in conteggi sballati downstream (es. slot 2≠3):
    // se un POST falliva, .json().id era undefined e finiva silenziosamente in cfIds.
    const mustCreate = (
      res: { statusCode: number; payload: string; json: () => { id?: string } },
      label: string,
    ): string => {
      assert.equal(res.statusCode, 201, `setup ${label} fallito (${res.statusCode}): ${res.payload}`);
      const id = res.json().id;
      if (!id) throw new Error(`setup ${label}: id mancante (status ${res.statusCode}, body ${res.payload})`);
      return id;
    };

    cookie = loginCookie(await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    }), 'ente1');

    cookie2 = loginCookie(await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente2.test', password: 'Admin123!' },
    }), 'ente2');

    concorsoId = mustCreate(await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'Cal Test 2026', anno: 2026, stato: 'ATTIVO' } }), 'concorso');
    sezioneId = mustCreate(await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'Cal Archi', ordine: 1 } }), 'sezione');
    categoriaId = mustCreate(await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId, nome: 'Cal Senior' } }), 'categoria');
    faseId = mustCreate(await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: 1, nome: 'Cal Eliminatorie', scala: 100 } }), 'fase');

    // 3 candidati in sezione/categoria, assegnati alla fase con posizioni 1,2,3.
    for (let i = 1; i <= 3; i++) {
      const candId = mustCreate(await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
        payload: { concorsoId, numeroCandidato: i, nome: `Cand${i}`, cognome: `Cognome${i}`, strumento: 'Violino', sezioneId, categoriaId } }), `candidato ${i}`);
      cfIds.push(mustCreate(await app.inject({ method: 'POST', url: '/api/candidati-fase', headers: H1(),
        payload: { faseId, candidatoId: candId, posizione: i } }), `candidato-fase ${i}`));
    }

    concorsoEnte2Id = mustCreate(await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'Cal Test E2 2026', anno: 2026, stato: 'ATTIVO' } }), 'concorso ente2');
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Cal Test%'));
    await app.close();
  });

  // ---------- sale ----------
  let salaId: string;
  test('sala: create + list + patch', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/calendario/sale', headers: H1(),
      payload: { concorsoId, nome: 'Sala A', ordine: 1 } });
    assert.equal(c.statusCode, 201);
    salaId = c.json().id;
    const list = await app.inject({ method: 'GET', url: `/api/calendario/sale?concorsoId=${concorsoId}`, headers: H1() });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().some((s: { id: string }) => s.id === salaId));
    const p = await app.inject({ method: 'PATCH', url: `/api/calendario/sale/${salaId}`, headers: H1(), payload: { nome: 'Sala A1' } });
    assert.equal(p.json().nome, 'Sala A1');
  });

  test('N105: sala con concorsoId di un altro tenant → 400', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/calendario/sale', headers: H1(),
      payload: { concorsoId: concorsoEnte2Id, nome: 'Intrusa' } });
    assert.equal(c.statusCode, 400);
  });

  // ---------- eventi + slot ----------
  let eventoId: string;
  test('evento: create blocco ESIBIZIONE', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/calendario/eventi', headers: H1(),
      payload: { concorsoId, faseId, sezioneId, categoriaId, salaId, tipo: 'ESIBIZIONE',
        data: '2026-06-01', oraInizio: '09:00', durataCandidatoMinuti: 15 } });
    assert.equal(c.statusCode, 201);
    eventoId = c.json().id;
  });

  test('genera-slot: orari = ora_inizio + i·durata', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/calendario/eventi/${eventoId}/genera-slot`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 200);
    const slots = r.json() as Array<{ id: string; posizione: number; oraPrevista: string; numeroCandidato: number }>;
    assert.equal(slots.length, 3);
    assert.equal(slots[0]!.oraPrevista, '09:00:00');
    assert.equal(slots[1]!.oraPrevista, '09:15:00');
    assert.equal(slots[2]!.oraPrevista, '09:30:00');
  });

  test('riordina-slot: inverte le posizioni e ricalcola gli orari', async () => {
    const reversed = [cfIds[2]!, cfIds[1]!, cfIds[0]!];
    const r = await app.inject({ method: 'POST', url: `/api/calendario/eventi/${eventoId}/riordina-slot`, headers: H1(),
      payload: { ordine: reversed } });
    assert.equal(r.statusCode, 200);
    const slots = r.json() as Array<{ id: string; oraPrevista: string }>;
    // Ora il primo slot (09:00) è il candidato che prima era ultimo.
    assert.equal(slots[0]!.id, cfIds[2]);
    assert.equal(slots[0]!.oraPrevista, '09:00:00');
    assert.equal(slots[2]!.id, cfIds[0]);
    assert.equal(slots[2]!.oraPrevista, '09:30:00');
  });

  test('riordina-slot: ordine non-permutazione → 400', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/calendario/eventi/${eventoId}/riordina-slot`, headers: H1(),
      payload: { ordine: [cfIds[0]!] } });
    assert.equal(r.statusCode, 400);
  });

  test('PATCH evento (sposta ora_inizio) → orari shiftano', async () => {
    await app.inject({ method: 'PATCH', url: `/api/calendario/eventi/${eventoId}`, headers: H1(), payload: { oraInizio: '14:00' } });
    const r = await app.inject({ method: 'POST', url: `/api/calendario/eventi/${eventoId}/genera-slot`, headers: H1(), payload: {} });
    const slots = r.json() as Array<{ oraPrevista: string }>;
    assert.equal(slots[0]!.oraPrevista, '14:00:00');
    assert.equal(slots[1]!.oraPrevista, '14:15:00');
  });

  // ---------- pre-start: candidati assegnati compaiono senza avvio fase ----------
  test('blocco creato con fase PIANIFICATA → candidati assegnati popolati senza start né candidati-fase', async () => {
    // Sezione/categoria dedicate + 2 candidati assegnati SOLO a sezione/categoria
    // (nessun POST /candidati-fase, nessun /fasi/:id/start).
    const sez = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'Cal Fiati', ordine: 2 } })).json();
    const cat = (await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId: sez.id, nome: 'Cal Junior' } })).json();
    for (const n of [21, 22]) {
      await app.inject({ method: 'POST', url: '/api/candidati', headers: H1(),
        payload: { concorsoId, numeroCandidato: n, nome: `Pre${n}`, cognome: `Cog${n}`, strumento: 'Flauto', sezioneId: sez.id, categoriaId: cat.id } });
    }
    const fase = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId, ordine: 2, nome: 'Cal Semifinale', scala: 100 } })).json();
    assert.equal(fase.stato, 'PIANIFICATA', 'fase non avviata');

    // Creazione blocco: gli slot devono già esistere (recompute alla create).
    const c = await app.inject({ method: 'POST', url: '/api/calendario/eventi', headers: H1(),
      payload: { concorsoId, faseId: fase.id, sezioneId: sez.id, categoriaId: cat.id, tipo: 'ESIBIZIONE',
        data: '2026-06-02', oraInizio: '10:00', durataCandidatoMinuti: 20 } });
    assert.equal(c.statusCode, 201);
    const r = await app.inject({ method: 'POST', url: `/api/calendario/eventi/${c.json().id}/genera-slot`, headers: H1(), payload: {} });
    const slots = r.json() as Array<{ oraPrevista: string; numeroCandidato: number }>;
    assert.equal(slots.length, 2, 'i 2 candidati assegnati compaiono prima dell\'avvio fase');
    assert.deepEqual(slots.map((s) => s.numeroCandidato), [21, 22]);
    assert.equal(slots[0]!.oraPrevista, '10:00:00');
    assert.equal(slots[1]!.oraPrevista, '10:20:00');
  });

  // ---------- pubblicazioni + route pubblica ----------
  let tokenNomi: string;
  let tokenAnon: string;
  test('pubblicazione: CONCORSO con nomi + SEZIONE anonima', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/calendario/pubblicazioni', headers: H1(),
      payload: { concorsoId, scopo: 'CONCORSO', etichetta: 'Generale', mostraNomi: true } });
    assert.equal(a.statusCode, 201);
    tokenNomi = a.json().token;
    const b = await app.inject({ method: 'POST', url: '/api/calendario/pubblicazioni', headers: H1(),
      payload: { concorsoId, scopo: 'SEZIONE', sezioneId, etichetta: 'Archi', mostraNomi: false, mostraCommissione: false } });
    assert.equal(b.statusCode, 201);
    tokenAnon = b.json().token;
  });

  test('pubblicazione SEZIONE senza sezioneId → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/calendario/pubblicazioni', headers: H1(),
      payload: { concorsoId, scopo: 'SEZIONE' } });
    assert.equal(r.statusCode, 400);
  });

  test('public: token valido con nomi → blocchi + slot con nomi', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/public/calendario/${tokenNomi}`, headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.concorso.nome, 'Cal Test 2026');
    const blocco = body.giorni[0].blocchi.find((b: { tipo: string }) => b.tipo === 'ESIBIZIONE');
    assert.ok(blocco, 'blocco esibizione presente');
    assert.equal(blocco.slot.length, 3);
    assert.ok(blocco.slot.some((s: { etichetta: string }) => /Cand/.test(s.etichetta)), 'mostra nomi candidati');
  });

  test('public: token anonimo → niente nomi, solo numero', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/public/calendario/${tokenAnon}`, headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.pubblicazione.mostraNomi, false);
    const blocco = body.giorni[0].blocchi.find((b: { tipo: string }) => b.tipo === 'ESIBIZIONE');
    for (const s of blocco.slot) {
      assert.match(s.etichetta, /^N\. \d{3}$/, 'etichetta = numero, niente nome');
      assert.doesNotMatch(s.etichetta, /Cand/);
    }
  });

  test('public: token inesistente → 404', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/public/calendario/nonesistexyz', headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 404);
  });

  test('public: token disattivato → 404', async () => {
    // Crea, disattiva, poi richiede.
    const created = (await app.inject({ method: 'POST', url: '/api/calendario/pubblicazioni', headers: H1(),
      payload: { concorsoId, scopo: 'CONCORSO', mostraNomi: true } })).json();
    await app.inject({ method: 'PATCH', url: `/api/calendario/pubblicazioni/${created.id}`, headers: H1(), payload: { attivo: false } });
    const r = await app.inject({ method: 'GET', url: `/api/public/calendario/${created.token}`, headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 404);
  });

  test('public: token cross-tenant (host ente2) → 404 (RLS)', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/public/calendario/${tokenNomi}`, headers: { host: 'ente2.gestimus.local' } });
    assert.equal(r.statusCode, 404);
  });
});
