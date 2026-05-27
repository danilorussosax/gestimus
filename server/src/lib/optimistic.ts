import { z } from 'zod';

// #4 — Controllo di concorrenza ottimistico (last-write-wins → conflitto esplicito).
// Il client legge `updatedAt` nella GET e lo rimanda come `expectedUpdatedAt`
// nella PATCH. Se nel frattempo la riga è cambiata (updatedAt diverso) la PATCH
// viene rifiutata con 409 STALE_VERSION invece di sovrascrivere in silenzio la
// modifica altrui. OPT-IN: se il client non invia expectedUpdatedAt non c'è
// controllo (retrocompatibile con i chiamanti esistenti).
//
// Il valore è una stringa libera confrontata con currentUpdatedAt.toISOString():
// un formato non combaciante → versione stale → 409 (fail-safe).
export const expectedVersionField = {
  expectedUpdatedAt: z.string().optional(),
};

/** true → si può procedere; false → versione stale (rispondere 409 STALE_VERSION). */
export function versionFresh(currentUpdatedAt: Date | null | undefined, expected: string | undefined): boolean {
  if (expected === undefined) return true; // opt-in: nessun controllo richiesto
  if (!currentUpdatedAt) return false;
  return currentUpdatedAt.toISOString() === expected;
}

/** Corpo della risposta 409 di conflitto di versione. */
export const STALE_VERSION_BODY = {
  error: 'il record è stato modificato da un altro utente: ricarica e riprova',
  code: 'STALE_VERSION' as const,
};
