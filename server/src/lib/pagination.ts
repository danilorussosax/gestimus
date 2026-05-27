import { z } from 'zod';

/**
 * A1: paginazione per gli endpoint list.
 *
 * - `limit`/`offset` sono opzionali nella query string.
 * - Se `limit` non è fornito si applica DEFAULT_LIMIT (100): un default
 *   *bounded* che evita result set illimitati (DoS / OOM, es. 10K candidati =
 *   ~100MB JSON) senza cambiare la forma della risposta.
 * - MAX_LIMIT resta il cap hard: richieste esplicite oltre il limite vengono
 *   rifiutate dallo schema (come prima).
 * - I client che vogliono finestre più grandi passano un `limit` esplicito
 *   (fino a MAX_LIMIT).
 *
 * Restituisce { limit, offset } già normalizzati e clampati.
 */
export const MAX_LIMIT = 10_000;
export const DEFAULT_LIMIT = 100;

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export function parsePagination(query: unknown): { limit: number; offset: number } {
  const parsed = querySchema.safeParse(query);
  const data = parsed.success ? parsed.data : {};
  return {
    limit: data.limit ?? DEFAULT_LIMIT,
    offset: data.offset ?? 0,
  };
}
