import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione flusso iscrizioni:
 *  - public GET concorsi aperti + dettaglio (sezioni/categorie)
 *  - public POST iscrizione → INVIATA (consensi GDPR obbligatori)
 *  - tutore obbligatorio per minorenni
 *  - admin approve → crea candidato (con sezione/categoria copiate) + stato APPROVATA
 *  - admin reject → stato RIFIUTATA; reject di APPROVATA → 409
 *  - isolamento cross-tenant + PII solo admin
 *
 * ATTENZIONE rate-limit: POST /public/iscrizioni è 3/ora per IP. Questo file usa
 * un'app dedicata (createApp → store rate-limit fresco) e fa AL MASSIMO 3 submit
 * pubblici andati a buon fine (gli altri scenari usano insert diretti via dbSuper
 * con tenant context, evitando di consumare budget).
 * Pre-requisito: dati seed.
 */
describe('Iscrizioni flow (public → approve/reject)', () => {
  let app: FastifyInstance;
  let cookie: string;       // ente1 admin
  let cookie2: string;      // ente2 admin
  let commCookie: string;   // ente1 commissario
  let tenantId: string;
  let concorsoId: string;
  let sezioneId: string;
  let categoriaId: string;
  let concorsoEnte2Id: string;

  const H1 = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie });
  const H2 = () => ({ host: 'ente2.gestimus.local', 'content-type': 'application/json', cookie: cookie2 });
  const HC = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json', cookie: commCookie });
  const PUB = () => ({ host: 'ente1.gestimus.local', 'content-type': 'application/json' });

  before(async () => {
    app = await createApp();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' } });
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    tenantId = login.json().account.tenantId;
    const login2 = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente2.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'admin@ente2.test', password: 'Admin123!' } });
    cookie2 = `gestimus_session=${login2.cookies.find((c) => c.name === 'gestimus_session')!.value}`;
    const loginC = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { host: 'ente1.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'commissario@ente1.test', password: 'Demo123!' } });
    commCookie = `gestimus_session=${loginC.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    // Concorso con iscrizioni APERTE + sezione/categoria.
    concorsoId = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'Iscr Test 2026', anno: 2026, stato: 'ATTIVO', iscrizioniAperte: true } })).json().id;
    sezioneId = (await app.inject({ method: 'POST', url: '/api/sezioni', headers: H1(),
      payload: { concorsoId, nome: 'Iscr Sez', ordine: 1 } })).json().id;
    categoriaId = (await app.inject({ method: 'POST', url: '/api/categorie', headers: H1(),
      payload: { sezioneId, nome: 'Iscr Cat' } })).json().id;

    concorsoEnte2Id = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H2(),
      payload: { nome: 'Iscr Test E2 2026', anno: 2026, stato: 'ATTIVO', iscrizioniAperte: true } })).json().id;
  });

  after(async () => {
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'Iscr Test%'));
    await app.close();
  });

  // Helper: inserisce direttamente un'iscrizione INVIATA via dbSuper (tenant
  // context) per gli scenari admin senza consumare il budget rate-limit del
  // POST pubblico.
  async function seedIscrizione(overrides: Record<string, unknown> = {}): Promise<string> {
    const { iscrizioni } = await import('../../src/db/schema.js');
    const [row] = await dbSuper
      .insert(iscrizioni)
      .values({
        tenantId,
        concorsoId,
        stato: 'INVIATA',
        nome: 'IscrSeed',
        cognome: 'Cog',
        email: `iscrseed-${Math.random().toString(36).slice(2)}@example.com`,
        strumento: 'Violino',
        sezioneId,
        categoriaId,
        consensiGdpr: { privacy: true, regolamento: true },
        ...overrides,
      })
      .returning();
    return row!.id;
  }

  // ---------- public read ----------
  test('public GET /concorsi → concorso con iscrizioni aperte visibile', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/public/concorsi', headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string }>;
    assert.ok(rows.some((c) => c.id === concorsoId), 'concorso aperto presente');
  });

  test('public GET /concorsi/:id → dettaglio con sezioni e categorie', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/public/concorsi/${concorsoId}`, headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.ok(body.sezioni.some((s: { id: string }) => s.id === sezioneId));
    assert.ok(body.categorie.some((c: { id: string }) => c.id === categoriaId));
  });

  test('public GET /concorsi/:id con iscrizioni chiuse → 404', async () => {
    const closed = (await app.inject({ method: 'POST', url: '/api/concorsi', headers: H1(),
      payload: { nome: 'Iscr Test Chiuso', anno: 2026, stato: 'ATTIVO', iscrizioniAperte: false } })).json();
    const r = await app.inject({ method: 'GET', url: `/api/public/concorsi/${closed.id}`, headers: { host: 'ente1.gestimus.local' } });
    assert.equal(r.statusCode, 404);
  });

  // ---------- public submit (consuma budget rate-limit: 1) ----------
  let submittedIscrizioneId: string;
  test('public POST iscrizione valida → 201 INVIATA + uploadToken', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/public/iscrizioni', headers: PUB(),
      payload: {
        concorsoId, nome: 'Pubblico', cognome: 'Iscritto', email: 'pubblico.iscritto@example.com',
        strumento: 'Pianoforte', sezioneId, categoriaId,
        consensiGdpr: { privacy: true, regolamento: true },
      } });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().ok, true);
    submittedIscrizioneId = r.json().iscrizioneId;
    assert.ok(r.json().uploadToken, 'uploadToken capability restituito');
  });

  test('public POST: consenso privacy false → 400 (no budget consumato sul submit valido)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/public/iscrizioni', headers: PUB(),
      payload: {
        concorsoId, nome: 'X', email: 'x@example.com',
        consensiGdpr: { privacy: false, regolamento: true },
      } });
    assert.equal(r.statusCode, 400);
  });

  test('public POST: minorenne senza tutore → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/public/iscrizioni', headers: PUB(),
      payload: {
        concorsoId, nome: 'Minore', email: 'minore@example.com', dataNascita: '2015-01-01',
        consensiGdpr: { privacy: true, regolamento: true },
      } });
    assert.equal(r.statusCode, 400);
  });

  test('admin vede l\'iscrizione inviata in lista (stato INVIATA)', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/iscrizioni?concorsoId=${concorsoId}`, headers: H1() });
    assert.equal(r.statusCode, 200);
    const rows = r.json() as Array<{ id: string; stato: string }>;
    const found = rows.find((x) => x.id === submittedIscrizioneId)!;
    assert.ok(found, 'iscrizione presente per admin');
    assert.equal(found.stato, 'INVIATA');
  });

  test('commissario NON può listare le iscrizioni (PII admin-only) → 403', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/iscrizioni?concorsoId=${concorsoId}`, headers: HC() });
    assert.equal(r.statusCode, 403);
  });

  // ---------- approve ----------
  test('approve: crea candidato con sezione/categoria copiate + stato APPROVATA', async () => {
    const iscId = await seedIscrizione({ nome: 'ApproveMe', strumento: 'Tromba' });
    const r = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/approve`, headers: H1(), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ok, true);
    assert.equal(r.json().iscrizione.stato, 'APPROVATA');
    const cand = r.json().candidato;
    assert.ok(cand.id, 'candidato creato');
    assert.equal(cand.nome, 'ApproveMe');
    assert.equal(cand.sezioneId, sezioneId, 'sezione copiata sul candidato');
    assert.equal(cand.categoriaId, categoriaId, 'categoria copiata sul candidato');
    assert.ok(cand.numeroCandidato >= 1);
    // l'iscrizione punta al candidato creato.
    assert.equal(r.json().iscrizione.candidatoId, cand.id);
  });

  test('approve idempotente: seconda approve → alreadyApproved', async () => {
    const iscId = await seedIscrizione({ nome: 'ApproveTwice' });
    const a = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/approve`, headers: H1(), payload: {} });
    assert.equal(a.statusCode, 200);
    const b = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/approve`, headers: H1(), payload: {} });
    assert.equal(b.statusCode, 200);
    assert.equal(b.json().alreadyApproved, true);
  });

  test('commissario non può approvare → 403', async () => {
    const iscId = await seedIscrizione({ nome: 'NoCommApprove' });
    const r = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/approve`, headers: HC(), payload: {} });
    assert.equal(r.statusCode, 403);
  });

  // ---------- reject ----------
  test('reject: INVIATA → RIFIUTATA con reason', async () => {
    const iscId = await seedIscrizione({ nome: 'RejectMe' });
    const r = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/reject`, headers: H1(), payload: { reason: 'fuori categoria' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().iscrizione.stato, 'RIFIUTATA');
  });

  test('reject di un\'iscrizione APPROVATA → 409', async () => {
    const iscId = await seedIscrizione({ nome: 'ApprovedThenReject' });
    await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/approve`, headers: H1(), payload: {} });
    const r = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/reject`, headers: H1(), payload: { reason: 'x' } });
    assert.equal(r.statusCode, 409);
  });

  test('reject id inesistente → 404', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/iscrizioni/00000000-0000-0000-0000-000000000000/reject', headers: H1(), payload: {} });
    assert.equal(r.statusCode, 404);
  });

  // ---------- isolamento cross-tenant ----------
  test('ente2 non vede le iscrizioni di ente1', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/iscrizioni?concorsoId=${concorsoId}`, headers: H2() });
    assert.equal(r.statusCode, 200);
    assert.equal((r.json() as unknown[]).length, 0);
  });

  test('ente2 non può approvare un\'iscrizione di ente1 → 404', async () => {
    const iscId = await seedIscrizione({ nome: 'CrossApprove' });
    const r = await app.inject({ method: 'POST', url: `/api/iscrizioni/${iscId}/approve`, headers: H2(), payload: {} });
    assert.equal(r.statusCode, 404);
  });
});
