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
// NB: cambiare master, salt o label invalida i blob/firme già prodotti
// (audit sig, SMTP/backup cifrati). Accettabile: nessun dato di produzione.
const HKDF_SALT = Buffer.from('gestimus-hkdf-v1');

function masterKeyBytes(): Buffer {
  return Buffer.from(env.GESTIMUS_SECRET_KEY);
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
