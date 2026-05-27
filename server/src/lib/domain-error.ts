import type { FastifyReply } from 'fastify';

// #1 (architect) — errore di dominio disaccoppiato da HTTP. I service ritornano
// DomainError dentro un Result; la route lo traduce in risposta con
// replyDomainError. `status` mappa il codice HTTP; `code` è un identificatore
// stabile opzionale per il client.
export interface DomainError {
  status: number;
  message: string;
  code?: string;
}

export const forbidden = (message: string, code?: string): DomainError => ({ status: 403, message, code });
export const notFoundError = (message = 'non trovato', code?: string): DomainError => ({ status: 404, message, code });
export const conflictError = (message: string, code?: string): DomainError => ({ status: 409, message, code });
export const badRequestError = (message: string, code?: string): DomainError => ({ status: 400, message, code });

/**
 * Traduce un DomainError in risposta Fastify, preservando le forme esistenti:
 * 404 → reply.notFound() (@fastify/sensible), altrimenti { error, code? }.
 */
export function replyDomainError(reply: FastifyReply, e: DomainError): FastifyReply {
  if (e.status === 404) return reply.notFound();
  return reply.code(e.status).send(e.code ? { error: e.message, code: e.code } : { error: e.message });
}
