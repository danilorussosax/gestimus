// #1 (architect) — Result tipizzato per i service di dominio. Permette di
// restituire errori di dominio (DomainError) senza accoppiare la logica a
// Fastify (reply): la route mappa il Result in risposta HTTP.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
