import type { FastifyRequest } from 'fastify';
import { sendMail } from './email.js';
import { env } from '../env.js';

// #11 + #4 — costruzione e invio dell'email di verifica iscrizione. Estratto da
// routes/iscrizioni.ts così sia la route (resend, invio diretto) sia l'handler
// dell'outbox (#4) possono riusare verifyEmailContent senza dipendere dalla route.
export type EmailLang = 'it' | 'en';

// #11: lingua dall'header Accept-Language: 'en*' → inglese, altrimenti italiano.
export function pickEmailLang(acceptLanguage: string | undefined): EmailLang {
  return acceptLanguage && /^\s*en\b/i.test(acceptLanguage) ? 'en' : 'it';
}

// URL di verifica (hash-route frontend che esegue la POST /verify). N27: base URL
// da env (non spoofabile) se configurata, altrimenti dagli header.
export function buildVerifyUrl(req: FastifyRequest, token: string): string {
  let baseUrl: string;
  if (env.PUBLIC_BASE_URL) {
    baseUrl = env.PUBLIC_BASE_URL.replace(/\{tenant\}/g, req.tenant!.slug).replace(/\/$/, '');
  } else {
    const host = req.headers.host ?? '';
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    baseUrl = `${proto}://${host}`;
  }
  return `${baseUrl}/#/iscrizione/verify?t=${encodeURIComponent(token)}`;
}

export function verifyEmailContent(lang: EmailLang, verifyUrl: string): { subject: string; text: string; html: string } {
  if (lang === 'en') {
    return {
      subject: 'Confirm your registration',
      text: `Thank you for registering.\n\nConfirm your email address by opening this link:\n${verifyUrl}\n\nIf you did not request this registration, please ignore this message.`,
      html: `<p>Thank you for registering.</p><p>Confirm your email address by clicking the link below:</p><p><a href="${verifyUrl}">Confirm registration</a></p><p style="color:#888;font-size:12px">If you did not request this registration, please ignore this message.</p>`,
    };
  }
  return {
    subject: 'Conferma la tua iscrizione',
    text: `Grazie per la tua iscrizione.\n\nConferma il tuo indirizzo email aprendo questo link:\n${verifyUrl}\n\nSe non hai richiesto questa iscrizione, ignora questo messaggio.`,
    html: `<p>Grazie per la tua iscrizione.</p><p>Conferma il tuo indirizzo email cliccando il link qui sotto:</p><p><a href="${verifyUrl}">Conferma iscrizione</a></p><p style="color:#888;font-size:12px">Se non hai richiesto questa iscrizione, ignora questo messaggio.</p>`,
  };
}

// Invio diretto (best-effort), usato dal resend (feedback immediato all'utente).
// La creazione iscrizione usa invece l'outbox (#4, services/event-handlers.ts).
export async function sendVerificationEmail(req: FastifyRequest, to: string, token: string): Promise<void> {
  const c = verifyEmailContent(pickEmailLang(req.headers['accept-language']), buildVerifyUrl(req, token));
  await sendMail({ tenantId: req.tenant!.id, to, subject: c.subject, text: c.text, html: c.html });
}
