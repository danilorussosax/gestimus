import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptSmtp,
  decryptSmtpWith,
  encryptSmtp,
  isEncryptedSmtp,
  smtpKey,
  type SmtpConfigPlain,
} from '../../src/services/crypto-smtp.js';

describe('Crypto SMTP (AES-256-GCM)', () => {
  const sample: SmtpConfigPlain = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'noreply@example.com',
    password: 'super-secret-password-!@#$',
    from: 'Gestimus <noreply@example.com>',
  };

  test('round-trip preserva i valori originali', () => {
    const encrypted = encryptSmtp(sample);
    const decrypted = decryptSmtp(encrypted);
    assert.deepEqual(decrypted, sample);
  });

  // #2: la rotazione chiave si appoggia a decryptSmtpWith che prova le chiavi in
  // ordine (corrente, poi precedente). Simuliamo: blob cifrato con la chiave
  // corrente, lista [chiave_sbagliata, chiave_corretta] → decifra via fallback.
  test('#2 decryptSmtpWith: fallback alla chiave corretta nella lista', () => {
    const encrypted = encryptSmtp(sample);
    const wrong = randomBytes(32);
    const out = decryptSmtpWith(encrypted, [wrong, smtpKey()]);
    assert.deepEqual(out, sample);
    assert.throws(() => decryptSmtpWith(encrypted, [wrong]), 'nessuna chiave valida → throw');
  });

  test('output cifrato non contiene il plaintext password', () => {
    const encrypted = encryptSmtp(sample);
    const serialized = JSON.stringify(encrypted);
    assert.ok(!serialized.includes(sample.password), 'password leakata nell\'output cifrato');
  });

  test('IV randomico: due cifrature dello stesso input differiscono', () => {
    const a = encryptSmtp(sample);
    const b = encryptSmtp(sample);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.data, b.data);
  });

  test('tampering del ciphertext fa fallire la decrittazione (auth tag)', () => {
    const encrypted = encryptSmtp(sample);
    const tampered = {
      ...encrypted,
      data: Buffer.from(encrypted.data, 'base64').reverse().toString('base64'),
    };
    assert.throws(() => decryptSmtp(tampered));
  });

  test('isEncryptedSmtp riconosce il formato', () => {
    const encrypted = encryptSmtp(sample);
    assert.equal(isEncryptedSmtp(encrypted), true);
    assert.equal(isEncryptedSmtp({ host: 'x' }), false);
    assert.equal(isEncryptedSmtp(null), false);
  });
});
