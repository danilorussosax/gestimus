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
