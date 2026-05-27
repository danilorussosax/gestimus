import { z } from 'zod';

// Helper Zod condivisi: prima duplicati riga-per-riga nelle route (uuid in 16
// file, emptyToNull in 5). Single source of truth → un solo punto da cambiare.

/** Validatore UUID. */
export const uuid = z.string().uuid();

/**
 * Stringa vuota → null. Da usare in `z.preprocess(emptyToNull, schema.nullable())`
 * per i campi opzionali: i form HTML mandano `''` invece di omettere il campo,
 * e `''` deve diventare `null` (non un valore vuoto valido).
 */
export const emptyToNull = <T>(v: T) => (v === '' ? null : v);
