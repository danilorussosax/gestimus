import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { deriveKey } from './keys.js';

// TOTP RFC 6238 (HMAC-SHA1, step 30s, 6 cifre) implementato con node:crypto —
// nessuna dipendenza esterna. Compatibile con Google Authenticator/Authy/1Password.

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += B32.charAt((value << (5 - bits)) & 31);
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** Genera un secret TOTP (160 bit) in base32 da mostrare/QR-encodare all'utente. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI per QR code. label = identificativo account (email). */
export function totpUri(secretBase32: string, label: string, issuer = 'Gestimus'): string {
  const enc = encodeURIComponent;
  return (
    `otpauth://totp/${enc(issuer)}:${enc(label)}` +
    `?secret=${secretBase32}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
  );
}

/** Codice TOTP corrente per un secret (utile a test e generazione lato server). */
export function generateTotp(secretBase32: string, nowMs: number = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verifica un codice TOTP a 6 cifre con finestra ±`window` step (default ±1 =
 * tolleranza ±30s per clock skew). Confronto constant-time. `nowMs` iniettabile
 * per i test.
 */
export function verifyTotp(secretBase32: string, token: string, window = 1, nowMs: number = Date.now()): boolean {
  const t = (token || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  const provided = Buffer.from(t);
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(secret, counter + i));
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) return true;
  }
  return false;
}

/** Genera N recovery code one-time (10 char base32, leggibili). */
export function generateRecoveryCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    codes.push(base32Encode(randomBytes(7)).slice(0, 10));
  }
  return codes;
}

/** Hash di un recovery code per lo storage (sono ad alta entropia → SHA-256 ok). */
export function hashRecoveryCode(code: string): string {
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return encodeHexLowerCase(sha256(new TextEncoder().encode(norm)));
}

// --- Challenge MFA al login -------------------------------------------------
// Dopo la verifica password, se l'account ha il 2FA attivo NON emettiamo subito
// la sessione: restituiamo un challenge firmato HMAC (accountId+scadenza) che
// prova "password corretta". La route verify-totp lo valida e, col codice TOTP,
// emette la sessione. Self-contained (nessuno storage), TTL breve.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// HMAC del challenge MFA con sottochiave dedicata 'gestimus:mfa' (HKDF da
// GESTIMUS_SECRET_KEY): separata dalle chiavi audit/SMTP/backup.
const MFA_HMAC_KEY = deriveKey('gestimus:mfa');
function challengeSig(payload: string): string {
  return createHmac('sha256', MFA_HMAC_KEY).update('mfa-challenge:' + payload).digest('base64url');
}

export function createMfaChallenge(accountId: string): string {
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${accountId}.${exp}`;
  return `${payload}.${challengeSig(payload)}`;
}

export function verifyMfaChallenge(token: string): string | null {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [accountId, expStr, sig] = parts as [string, string, string];
  const expected = challengeSig(`${accountId}.${expStr}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  if (!/^\d+$/.test(expStr) || Number(expStr) < Date.now()) return null;
  return accountId;
}
