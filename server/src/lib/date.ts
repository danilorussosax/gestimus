// N100: "oggi" come data-solo (YYYY-MM-DD) nel fuso del piattaforma, non in
// UTC. Le scadenze (`iscrizioniScadenza`, ecc.) sono colonne `date` interpretate
// dall'organizzatore nel proprio fuso; confrontarle contro una data UTC poteva
// sfasare di un giorno vicino alla mezzanotte (es. 01:00 a Roma = giorno prima
// in UTC → scadenza non ancora considerata passata). Centralizzato qui così il
// confronto è esplicito e coerente in tutto il backend.
//
// La piattaforma serve concorsi italiani → Europe/Rome. `en-CA` formatta in
// ISO `YYYY-MM-DD`. Nessuna dipendenza esterna.
const PLATFORM_TZ = 'Europe/Rome';

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data odierna come stringa ISO `YYYY-MM-DD` nel fuso della piattaforma. */
export function todayISODate(now: Date = new Date()): string {
  return isoDateFormatter.format(now);
}

/**
 * M191: età in anni compiuti a "oggi" (fuso piattaforma), da una data di
 * nascita ISO `YYYY-MM-DD`. Confronta componenti intere (anno/mese/giorno) →
 * niente dipendenza dal fuso del processo: `new Date('2008-01-01')` e
 * `new Date()` confrontati a cavallo di mezzanotte potevano sfasare di un anno
 * il giorno del compleanno. Su input non valido ritorna NaN (il caller tratta
 * NaN come "non minorenne", coerente col comportamento precedente).
 */
export function ageYears(dobISO: string, now: Date = new Date()): number {
  const b = dobISO.slice(0, 10).split('-').map(Number);
  const t = todayISODate(now).split('-').map(Number);
  const by = b[0] ?? NaN, bm = b[1] ?? NaN, bd = b[2] ?? NaN;
  const ty = t[0] ?? NaN, tm = t[1] ?? NaN, td = t[2] ?? NaN;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}
