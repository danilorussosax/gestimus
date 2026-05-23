import { z } from 'zod';

/**
 * A1: paginazione opt-in per gli endpoint list.
 *
 * - `limit`/`offset` sono opzionali nella query string.
 * - Se non forniti, si applica un cap di sicurezza alto (MAX_LIMIT) che NON
 *   cambia il comportamento per tenant di dimensioni realistiche (centinaia di
 *   record) ma impedisce query/payload illimitati (DoS / OOM).
 * - I client che vogliono paginare passano limit/offset espliciti.
 *
 * Restituisce { limit, offset } già normalizzati e clampati.
 */
export const MAX_LIMIT = 10_000;

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export function parsePagination(query: unknown): { limit: number; offset: number } {
  const parsed = querySchema.safeParse(query);
  const data = parsed.success ? parsed.data : {};
  return {
    limit: data.limit ?? MAX_LIMIT,
    offset: data.offset ?? 0,
  };
}
