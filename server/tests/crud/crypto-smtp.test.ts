import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSmtp,
  encryptSmtp,
  isEncryptedSmtp,
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
