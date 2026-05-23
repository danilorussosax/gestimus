import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { fasi } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { faseChannel, subscribe } from '../realtime/hub.js';

// M5: durata massima di una connessione SSE (1h). Evita stream zombie che
// restano appesi indefinitamente consumando connessioni/file descriptor.
const MAX_SSE_DURATION_MS = 60 * 60 * 1000;

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /realtime/fase/:id (Server-Sent Events)
   * Stream eventi del timer fase. Il client (EventSource) riceve:
   *   data: {"action":"start","at":1234567890,"tempoMinuti":30}
   *
   * Eventi prodotti da NOTIFY fase_<uuid> emessi da /api/fasi/:id/start /conclude.
   */
  app.get('/fase/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    if (!req.tenant) {
      return reply.code(400).send({ error: 'tenant context richiesto' });
    }

    // M5: verifica che la fase appartenga al tenant del richiedente. La query
    // gira sotto RLS (dbTx setta app.tenant_id), quindi una fase di un altro
    // tenant non è visibile → 404. Senza questo, qualunque utente autenticato
    // poteva iscriversi al canale SSE di qualunque fase di qualunque tenant.
    const faseRows = await req.dbTx(async (tx) =>
      tx.select({ id: fasi.id }).from(fasi).where(eq(fasi.id, id)).limit(1),
    );
    if (faseRows.length === 0) {
      return reply.code(404).send({ error: 'fase non trovata' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // N28: backpressure. reply.raw.write() ritorna false quando il buffer del
    // socket è pieno (client lento/bloccato). Se i write non drenano, il buffer
    // cresce illimitato → memory leak. safeWrite chiude la connessione se il
    // buffered amount supera la soglia; il client EventSource si riconnette.
    const MAX_BUFFERED_BYTES = 1 << 20; // 1 MB
    const safeWrite = (chunk: string): void => {
      // writableLength = byte in coda non ancora flushati sul socket.
      if (reply.raw.writableLength > MAX_BUFFERED_BYTES) {
        close();
        return;
      }
      reply.raw.write(chunk);
    };

    // Comment iniziale per aprire la connessione
    reply.raw.write(': connected\n\n');

    const channel = faseChannel(id);
    const unsubscribe = await subscribe(channel, (payload) => {
      safeWrite(`data: ${JSON.stringify(payload)}\n\n`);
    });

    // Keep-alive: ping ogni 25s per evitare timeout proxy
    const keepAlive = setInterval(() => {
      safeWrite(': ping\n\n');
    }, 25000);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      clearTimeout(maxDuration);
      unsubscribe();
      reply.raw.end();
    };

    // M5: chiude forzatamente la connessione dopo MAX_SSE_DURATION_MS. Il
    // client EventSource si riconnette automaticamente se ancora interessato.
    const maxDuration = setTimeout(close, MAX_SSE_DURATION_MS);

    req.raw.on('close', close);
    req.raw.on('error', close);

    // Hold open: Fastify aspetta che chiudiamo manualmente
    return reply;
  });
};
