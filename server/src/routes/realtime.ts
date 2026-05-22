import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { faseChannel, subscribe } from '../realtime/hub.js';

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

    // Verifica autorizzazione: l'utente deve avere accesso al tenant corrente
    // (il middleware tenant ha già controllato che il tenant esista ed sia attivo)
    if (!req.tenant) {
      return reply.code(400).send({ error: 'tenant context richiesto' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Comment iniziale per aprire la connessione
    reply.raw.write(': connected\n\n');

    const channel = faseChannel(id);
    const unsubscribe = await subscribe(channel, (payload) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    // Keep-alive: ping ogni 25s per evitare timeout proxy
    const keepAlive = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 25000);

    const close = () => {
      clearInterval(keepAlive);
      unsubscribe();
      reply.raw.end();
    };

    req.raw.on('close', close);
    req.raw.on('error', close);

    // Hold open: Fastify aspetta che chiudiamo manualmente
    return reply;
  });
};
