import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey, deriveKeysWithFallback } from './keys.js';

const ALGO = 'aes-256-gcm';

// N130 / separazione di dominio: chiave AES-256 per i credenziali SMTP derivata
// via HKDF da GESTIMUS_SECRET_KEY con label dedicata 'gestimus:smtp'. Prima era
// la stessa chiave del backup (keyBuffer condiviso); ora sono DISTINTE
// ('gestimus:smtp' vs 'gestimus:backup') → un leak del cifrato SMTP non aiuta a
// decifrare i backup, e viceversa. 32 byte = AES-256.
export function smtpKey(): Buffer {
  return deriveKey('gestimus:smtp', 32);
}

// #2: chiavi da provare in decrypt — corrente + (in rotazione) precedente.
function smtpKeys(): Buffer[] {
  return deriveKeysWithFallback('gestimus:smtp', 32);
}

export type SmtpConfigPlain = {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  password: string;
  from: string;
};

export type SmtpConfigEncrypted = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

export function encryptSmtp(config: SmtpConfigPlain): SmtpConfigEncrypted {
  const key = smtpKey();
  const iv = randomBytes(12); // 96-bit IV raccomandato per GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(config), 'utf8');
  const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptWith(e: SmtpConfigEncrypted, key: Buffer): SmtpConfigPlain {
  const iv = Buffer.from(e.iv, 'base64');
  const tag = Buffer.from(e.tag, 'base64');
  const data = Buffer.from(e.data, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * #2: prova a decifrare con ogni chiave in `keys` nell'ordine (corrente, poi
 * precedente in rotazione). La verifica GCM fallisce con un throw se la chiave è
 * sbagliata → si passa alla successiva. Se nessuna funziona, rilancia l'ultimo
 * errore. Esportata per i test (verifica del fallback senza toccare le env).
 */
export function decryptSmtpWith(encrypted: SmtpConfigEncrypted | unknown, keys: Buffer[]): SmtpConfigPlain {
  const e = encrypted as SmtpConfigEncrypted;
  if (!e || e.v !== 1) {
    throw new Error('formato cifrato SMTP non valido');
  }
  let lastErr: unknown;
  for (const key of keys) {
    try {
      return decryptWith(e, key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('decrypt SMTP fallito (nessuna chiave valida)');
}

export function decryptSmtp(encrypted: SmtpConfigEncrypted | unknown): SmtpConfigPlain {
  return decryptSmtpWith(encrypted, smtpKeys());
}

export function isEncryptedSmtp(value: unknown): value is SmtpConfigEncrypted {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    'iv' in value &&
    'tag' in value &&
    'data' in value
  );
}
