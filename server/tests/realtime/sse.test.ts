import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { concorsi } from '../../src/db/schema.js';

/**
 * Integrazione SSE realtime: GET /api/realtime/fase/:id (text/event-stream).
 *
 * app.inject() bufferizza tutta la risposta → inadatto a uno stream long-lived.
 * Qui si fa `app.listen({ port: 0 })` e si aprono richieste HTTP reali sul socket
 * effimero, leggendo il body in streaming. Ogni richiesta usa AbortController +
 * timeout così il test non può mai restare appeso.
 *
 * Pre-requisito: dati seed (`npm run db:seed`):
 *   admin@ente1.test / Admin123!   (tenant ente1)
 *
 * Setup: si crea via API un concorso + una fase (per avere un id reale che
 * appartiene a ente1 e supera il check RLS dello stream). Teardown: drop del
 * concorso di test (cascade sulle fasi) + app.close().
 */
describe('Realtime SSE GET /api/realtime/fase/:id', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let cookie: string;        // ente1 admin (es. "gestimus_session=...")
  let faseId: string;        // fase reale di ente1

  const HOST = 'ente1.gestimus.local';
  // Tutti i controller aperti: abortiti in `after` PRIMA di app.close(), così
  // nessun socket SSE keep-alive resta appeso a far attendere lo shutdown.
  const openControllers: AbortController[] = [];

  /**
   * Apre una richiesta SSE reale e raccoglie i chunk fino al primo dei due
   * eventi: arriva `frameMarker` nel body, oppure scade `timeoutMs`.
   * Ritorna { statusCode, contentType, body, controller }. La connessione resta
   * aperta (per i test di cleanup) finché il chiamante non chiama controller.abort().
   */
  function openStream(
    opts: { path: string; cookie?: string; host?: string; timeoutMs?: number; frameMarker?: string },
  ): Promise<{
    statusCode: number;
    contentType: string;
    body: string;
    controller: AbortController;
    closed: Promise<void>;
  }> {
    const { path, cookie: ck, host = HOST, timeoutMs = 3000, frameMarker } = opts;
    const controller = new AbortController();
    openControllers.push(controller);
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { host, accept: 'text/event-stream' };
      if (ck) headers.cookie = ck;

      const req = http.request(
        `${baseUrl}${path}`,
        { method: 'GET', headers, signal: controller.signal },
        (res) => {
          let body = '';
          let settled = false;
          let resolveClosed: () => void;
          const closed = new Promise<void>((r) => (resolveClosed = r));

          const settle = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
              statusCode: res.statusCode ?? 0,
              contentType: String(res.headers['content-type'] ?? ''),
              body,
              controller,
              closed,
            });
          };

          // Per le risposte non-stream (es. 401 JSON) basta attendere 'end'.
          const isStream = String(res.headers['content-type'] ?? '').includes('text/event-stream');

          const timer = setTimeout(settle, timeoutMs);

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
            if (!isStream) return;
            if (frameMarker ? body.includes(frameMarker) : body.length > 0) settle();
          });
          res.on('end', () => {
            settle();
            resolveClosed();
          });
          res.on('close', () => {
            settle();
            resolveClosed();
          });
          res.on('error', () => {
            settle();
            resolveClosed();
          });
        },
      );
      // AbortError quando chiudiamo il client di proposito: non è un fallimento.
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.name === 'AbortError' || err.code === 'ECONNRESET') return;
        reject(err);
      });
      req.end();
    });
  }

  before(async () => {
    app = await createApp();
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: { email: 'admin@ente1.test', password: 'Admin123!' },
    });
    assert.equal(login.statusCode, 200, 'login admin ente1 deve riuscire (seed presente?)');
    cookie = `gestimus_session=${login.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    const H = { host: HOST, 'content-type': 'application/json', cookie };
    const concorsoId = (
      await app.inject({
        method: 'POST',
        url: '/api/concorsi',
        headers: H,
        payload: { nome: 'SSE Test 2026', anno: 2026, stato: 'ATTIVO' },
      })
    ).json().id as string;
    faseId = (
      await app.inject({
        method: 'POST',
        url: '/api/fasi',
        headers: H,
        payload: { concorsoId, ordine: 1, nome: 'SSE Fase', scala: 100 },
      })
    ).json().id as string;
    assert.ok(faseId, 'fase di test creata');
  });

  after(async () => {
    // Chiudi ogni stream client rimasto aperto + distruggi i socket residui,
    // così app.close() (che attende le connessioni in volo) non resta appeso.
    for (const c of openControllers) c.abort();
    await new Promise((r) => setTimeout(r, 100));
    app.server.closeAllConnections?.();
    await dbSuper.delete(concorsi).where(like(concorsi.nome, 'SSE Test%'));
    await app.close();
  });

  // ---------- auth richiesta ----------
  test('senza cookie di sessione → 401 (nessuno stream)', async () => {
    const res = await openStream({ path: `/api/realtime/fase/${faseId}`, timeoutMs: 3000 });
    assert.equal(res.statusCode, 401);
    assert.ok(!res.contentType.includes('text/event-stream'), 'non deve aprire uno stream');
    res.controller.abort();
  });

  // ---------- connect ----------
  test('con cookie valido + Host tenant → 200 text/event-stream + heartbeat ": connected"', async () => {
    const res = await openStream({
      path: `/api/realtime/fase/${faseId}`,
      cookie,
      frameMarker: ': connected',
      timeoutMs: 4000,
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.contentType.includes('text/event-stream'), `content-type=${res.contentType}`);
    assert.ok(res.body.includes(': connected'), `heartbeat iniziale assente, body=${JSON.stringify(res.body)}`);
    res.controller.abort();
  });

  // ---------- disconnect cleanup ----------
  test('abort del client → il server chiude lo stream senza appendere (il test termina)', async () => {
    const res = await openStream({
      path: `/api/realtime/fase/${faseId}`,
      cookie,
      frameMarker: ': connected',
      timeoutMs: 4000,
    });
    assert.equal(res.statusCode, 200);

    // Chiudiamo il lato client: il server riceve 'close' su req.raw e fa teardown
    // (clearInterval/unsubscribe/reply.raw.end). Verifichiamo che la promise di
    // chiusura si risolva entro un tempo breve → niente connessione zombie.
    res.controller.abort();

    const closedInTime = await Promise.race([
      res.closed.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
    ]);
    assert.ok(closedInTime, 'lo stream deve chiudersi dopo l’abort del client');
  });

  // ---------- BONUS: NOTIFY forwarding ----------
  test('NOTIFY su quella fase → un frame "data:" arriva sullo stream', async () => {
    // Apriamo lo stream e aspettiamo il ": connected" così il subscribe è attivo.
    const conn = await openStream({
      path: `/api/realtime/fase/${faseId}`,
      cookie,
      frameMarker: ': connected',
      timeoutMs: 4000,
    });
    assert.equal(conn.statusCode, 200);

    // Continuiamo a leggere lo stream già aperto fino al primo frame "data:".
    // (openStream ha già consegnato lo stream dopo ": connected"; per leggere
    //  oltre apriamo una SECONDA connessione che resta in ascolto del data frame.)
    const waitData = openStream({
      path: `/api/realtime/fase/${faseId}`,
      cookie,
      frameMarker: 'data:',
      timeoutMs: 5000,
    });

    // Diamo un attimo perché il LISTEN del secondo subscriber sia registrato,
    // poi triggeriamo un NOTIFY reale avviando il timer della fase
    // (POST /api/fasi/:id/timer/start emette pg_notify {action:'timer.start'}).
    await new Promise((r) => setTimeout(r, 300));
    const start = await app.inject({
      method: 'POST',
      url: `/api/fasi/${faseId}/timer/start`,
      headers: { host: HOST, 'content-type': 'application/json', cookie },
      payload: {},
    });
    assert.equal(start.statusCode, 200, `timer/start atteso 200, body=${start.body}`);

    const dataRes = await waitData;
    assert.ok(
      dataRes.body.includes('data:'),
      `nessun frame data: ricevuto, body=${JSON.stringify(dataRes.body)}`,
    );
    assert.ok(
      dataRes.body.includes('timer.start'),
      `il frame data: deve contenere l’azione timer.start, body=${JSON.stringify(dataRes.body)}`,
    );

    conn.controller.abort();
    dataRes.controller.abort();
  });
});
