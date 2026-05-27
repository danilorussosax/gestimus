import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';

/**
 * Risposta 400 standard per le validazioni con `safeParse` fallite.
 *
 * Allinea le route al comportamento dell'error handler globale (vedi app.ts):
 * il client riceve SEMPRE un messaggio GENERICO ('richiesta non valida'),
 * mentre i dettagli dello schema Zod (`error.issues`: nomi campo, vincoli,
 * struttura interna) vengono solo LOGGATi lato server per debuggabilità.
 *
 * Motivazione (info-disclosure): echeggiare `error.message`/`flatten()`/
 * `issues` al client rivela i nomi dei campi interni e la forma degli schemi
 * agli utenti dell'API. Qui li teniamo server-side.
 *
 * Mantiene status 400 e la stessa forma di risposta di `reply.badRequest`
 * (@fastify/sensible) già usata ovunque nelle route.
 */
export function replyValidationError(
  reply: FastifyReply,
  req: FastifyRequest,
  error: ZodError,
): FastifyReply {
  req.log.info({ issues: error.issues }, 'validazione input fallita');
  return reply.badRequest('richiesta non valida');
}
