import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like, eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi, fasi, commissioni, commissari, candidati } from '../../src/db/schema.js';

/**
 * Integrazione permessi commissario presidente sulle fasi:
 *  - un commissario PRESIDENTE della commissione assegnata può start/conclude/
 *    sorteggio/timer della fase
 *  - un commissario MEMBRO (non presidente) non può gestire la fase → 403
 *  - vincoli commissione: presidente/membro devono appartenere allo stesso
 *    concorso
 *
 * Setup nel concorso SEED perché l'account commissario@ente1.test è bindato a un
 * commissario di quel concorso (Maria Rossi); solo lì può agire a proprio nome.
 * I dati creati (fase/commissione/cf/candidato) sono cancellati per id in after().
 * Pre-requisito: dati seed.
 */
describe('Commissione / presidente fase', () => {
  let app: FastifyInstance;
  let cookie: string;       // ente1 admin
  let commCookie: string;   // ente1 commissario (= Maria Rossi nel concorso seed)
  let seedConcorsoId: string;
  let seedCommissarioId: string; // commissarioId dell'account commissario

  let commissione: string;  // commissione con presidente = commissario seed
  let fasePresidente: string;
  let commissioneMembro: string; // commissario seed solo membro, non presidente
  let faseMembro: string;
  let altroPresidenteId: string; // altro commissario, presidente di commissioneMembro

  const H1 = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie });
  const HC = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie: commCookie });

  const createdFasi: string[] = [];
  const createdCommissioni: string[] = [];
  const createdCommissari: string[] = [];

  before(async () => {
    app = await createApp();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' } });
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const loginC = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' } });
    commCookie = `gestimus_session=${loginC.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: HC() })).json();
    seedCommissarioId = me.commissarioId;
    assert.ok(seedCommissarioId, 'account commissario deve essere bindato (seed)');
    const commProfile = (await app.inject({ method: 'GET', url: `/api/commissari/${seedCommissarioId}`, headers: H1() })).json();
    seedConcorsoId = commProfile.concorsoId;

    // ---- Commissione con il commissario seed come PRESIDENTE ----
    commissione = (await app.inject({ method: 'POST', url: '/api/commissioni', headers: H1(),
      payload: { concorsoId: seedConcorsoId, nome: 'CP Pres Commissione', presidenteCommissarioId: seedCommissarioId } })).json().id;
    createdCommissioni.push(commissione);
    await app.inject({ method: 'POST', url: `/api/commissioni/${commissione}/commissari/${seedCommissarioId}`, headers: H1(), payload: {} });
    fasePresidente = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId: seedConcorsoId, ordine: 910001, nome: 'CP Fase Pres', scala: 100, commissioneId: commissione } })).json().id;
    createdFasi.push(fasePresidente);

    // ---- Commissione con il commissario seed solo MEMBRO (presidente = altro) ----
    altroPresidenteId = (await app.inject({ method: 'POST', url: '/api/commissari', headers: H1(),
      payload: { concorsoId: seedConcorsoId, nome: 'CPAltroPres', cognome: 'Z' } })).json().id;
    createdCommissari.push(altroPresidenteId);
    commissioneMembro = (await app.inject({ method: 'POST', url: '/api/commissioni', headers: H1(),
      payload: { concorsoId: seedConcorsoId, nome: 'CP Membro Commissione', presidenteCommissarioId: altroPresidenteId } })).json().id;
    createdCommissioni.push(commissioneMembro);
    await app.inject({ method: 'POST', url: `/api/commissioni/${commissioneMembro}/commissari/${altroPresidenteId}`, headers: H1(), payload: {} });
    await app.inject({ method: 'POST', url: `/api/commissioni/${commissioneMembro}/commissari/${seedCommissarioId}`, headers: H1(), payload: {} });
    faseMembro = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId: seedConcorsoId, ordine: 910002, nome: 'CP Fase Membro', scala: 100, commissioneId: commissioneMembro } })).json().id;
    createdFasi.push(faseMembro);
  });

  after(async () => {
    for (const id of createdFasi) await dbSuper.delete(fasi).where(eq(fasi.id, id));
    for (const id of createdCommissioni) await dbSuper.delete(commissioni).where(eq(commissioni.id, id));
    for (const id of createdCommissari) await dbSuper.delete(commissari).where(eq(commissari.id, id));
    await dbSuper.delete(candidati).where(like(candidati.nome, 'CPCand%'));
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'CP Test%')); // nessuno, ma per sicurezza
    await app.close();
  });

  // ---------- presidente può gestire ----------
  test('presidente: può avviare la fase (start) → 200', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${fasePresidente}/start`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().stato, 'IN_CORSO');
  });

  test('presidente: è autorizzato al sorteggio (supera il gate permessi)', async () => {
    // Fase dedicata SENZA candidati: il presidente supera il check permessi
    // (assertCanManageFase) e raggiunge l'handler, che risponde 409 "nessun
    // candidato". Questo verifica l'autorizzazione del presidente in contrasto
    // col membro non-presidente (test sotto, 403) senza dipendere dal bulk-update
    // del riordino (vedi nota sotto).
    const faseVuota = (await app.inject({ method: 'POST', url: '/api/fasi', headers: H1(),
      payload: { concorsoId: seedConcorsoId, ordine: 910003, nome: 'CP Fase Sorteggio', scala: 100, commissioneId: commissione } })).json();
    createdFasi.push(faseVuota.id);
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${faseVuota.id}/sorteggio`, headers: HC(), payload: { seed: 7 } });
    // 409 = autorizzato ma nessun candidato; NON 403/404 (che indicherebbero
    // permesso negato). NB: con candidati assegnati il sorteggio attualmente
    // fallisce con 500 per un bug pre-esistente nel bulk UPDATE (unnest array
    // binding) di src/routes/fasi.ts — non riproducibile da questi test.
    assert.equal(r.statusCode, 409, r.body);
  });

  test('presidente: può gestire il timer (start) → 200', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${fasePresidente}/timer/start`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 200);
  });

  test('presidente: può concludere la fase → 200', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${fasePresidente}/conclude`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().stato, 'CONCLUSA');
  });

  // ---------- membro non presidente → 403 ----------
  test('membro non presidente: start → 403', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${faseMembro}/start`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  test('membro non presidente: timer start → 403', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${faseMembro}/timer/start`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  test('membro non presidente: sorteggio → 403', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${faseMembro}/sorteggio`, headers: HC(), payload: { seed: 1 } });
    assert.equal(r.statusCode, 403);
  });

  // ---------- admin resta sempre autorizzato ----------
  test('admin: può avviare la fase membro (bypassa il check presidente)', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/fasi/${faseMembro}/start`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 200);
  });

  // ---------- vincoli commissione ----------
  test('PATCH commissione: presidente di un altro concorso → 400', async () => {
    // crea un commissario in un concorso diverso (di test) e prova a metterlo
    // presidente della commissione seed.
    const altroConcorso = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'CP Test Altro 2026', anno: 2026, stato: 'ATTIVO' } })).json();
    const commAltro = (await app.inject({ method: 'POST', url: '/api/commissari', headers: H1(),
      payload: { concorsoId: altroConcorso.id, nome: 'CPEstraneo', cognome: 'Q' } })).json();
    const r = await app.inject({ method: 'PATCH', url: `/api/commissioni/${commissione}`, headers: H1(),
      payload: { presidenteCommissarioId: commAltro.id } });
    assert.equal(r.statusCode, 400);
  });

  test('add commissario di un altro concorso alla commissione → 400', async () => {
    const altroConcorso = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'CP Test Altro2 2026', anno: 2026, stato: 'ATTIVO' } })).json();
    const commAltro = (await app.inject({ method: 'POST', url: '/api/commissari', headers: H1(),
      payload: { concorsoId: altroConcorso.id, nome: 'CPEstraneo2', cognome: 'Q' } })).json();
    const r = await app.inject({ method: 'POST', url: `/api/commissioni/${commissione}/commissari/${commAltro.id}`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 400);
  });
});
