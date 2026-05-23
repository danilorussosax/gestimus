import { randomBytes } from 'node:crypto';

/**
 * Token URL-safe casuale (192 bit). Usato per i link di verifica email
 * iscrizioni e per i link pubblici del calendario.
 */
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}
