import { hkdfSync } from 'node:crypto';
import { env } from '../env.js';

// Separazione di dominio delle chiavi (HKDF-SHA256).
//
// PROBLEMA: GESTIMUS_SECRET_KEY era usato GREZZO da più sottosistemi
// (HMAC audit-log, AES SMTP, AES backup, HMAC challenge MFA). Un leak del
// master comprometteva tutto in un colpo solo, e SMTP/backup condividevano
// letteralmente la stessa chiave (stesso keyBuffer).
//
// SOLUZIONE: da un'unica master derivare sottochiavi indipendenti per dominio
// via HKDF (RFC 5869). HKDF è progettato per "key separation": dato lo stesso
// master, label `info` diverse producono chiavi crittograficamente scorrelate.
// Compromettere una sottochiave non rivela il master né le altre.
//
// salt: fisso app-wide e versionato (`v1`). Non è segreto (HKDF non lo richiede);
//   serve a vincolare la derivazione a questa applicazione/versione. Bump del
//   suffisso (`v2`, ...) = rotazione di TUTTE le sottochiavi in un colpo.
// info: la label di dominio (es. 'gestimus:audit'). È ciò che separa i domini.
//
// #2 — ROTAZIONE: cambiare il master invaliderebbe tutti i blob/firme prodotti
// con quello vecchio. Per rotare senza perdere i dati si imposta
// GESTIMUS_SECRET_KEY_PREVIOUS = vecchio master: deriveKeysWithFallback() prova
// prima la sottochiave corrente, poi quella derivata dal master precedente, così
// SMTP/backup restano decifrabili e le firme audit/MFA verificabili finché non
// si è re-cifrato/re-firmato tutto con la chiave nuova (poi si rimuove il
// PREVIOUS). Le NUOVE cifrature/firme usano sempre la chiave corrente.
const HKDF_SALT = Buffer.from('gestimus-hkdf-v1');

function masterKeyBytes(): Buffer {
  return Buffer.from(env.GESTIMUS_SECRET_KEY);
}

function previousMasterKeyBytes(): Buffer | null {
  return env.GESTIMUS_SECRET_KEY_PREVIOUS ? Buffer.from(env.GESTIMUS_SECRET_KEY_PREVIOUS) : null;
}

/**
 * Deriva una sottochiave domain-separated dal master GESTIMUS_SECRET_KEY.
 *
 * @param label  etichetta di dominio (HKDF `info`), es. 'gestimus:audit'.
 * @param length lunghezza in byte della sottochiave (default 32 = AES-256 /
 *               HMAC-SHA256 a piena entropia).
 */
export function deriveKey(label: string, length = 32): Buffer {
  // hkdfSync ritorna un ArrayBuffer → va incapsulato in Buffer per le API crypto.
  return Buffer.from(hkdfSync('sha256', masterKeyBytes(), HKDF_SALT, Buffer.from(label), length));
}

/** #2: sottochiave derivata dal master PRECEDENTE (null se non in rotazione). */
export function derivePreviousKey(label: string, length = 32): Buffer | null {
  const prev = previousMasterKeyBytes();
  if (!prev) return null;
  return Buffer.from(hkdfSync('sha256', prev, HKDF_SALT, Buffer.from(label), length));
}

/**
 * #2: chiavi da provare in decrypt/verify, in ordine: corrente, poi (se in
 * rotazione) quella del master precedente. Per FIRMARE/CIFRARE usa sempre
 * deriveKey() (la corrente), mai questa.
 */
export function deriveKeysWithFallback(label: string, length = 32): Buffer[] {
  const keys = [deriveKey(label, length)];
  const prev = derivePreviousKey(label, length);
  if (prev) keys.push(prev);
  return keys;
}
