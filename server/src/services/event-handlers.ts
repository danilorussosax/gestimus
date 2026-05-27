import { registerEventHandler } from './events.js';
import { sendMail } from './email.js';
import { verifyEmailContent, type EmailLang } from './iscrizione-email.js';

// #4 (architect) — registrazione degli handler dei domain events. Chiamata una
// volta all'avvio (index.ts). Ogni handler è idempotente per quanto possibile e
// può lanciare: l'outbox riprova fino a MAX_ATTEMPTS poi marca 'failed'.
export const ISCRIZIONE_VERIFY_EMAIL = 'iscrizione.verify_email';

export function registerDomainEventHandlers(): void {
  // Invio (con retry) dell'email di verifica iscrizione. Payload risolto al
  // momento della pubblicazione: { to, verifyUrl, lang }.
  registerEventHandler(ISCRIZIONE_VERIFY_EMAIL, async (ev) => {
    const p = ev.payload as { to?: string; verifyUrl?: string; lang?: EmailLang };
    if (!p.to || !p.verifyUrl) throw new Error('payload iscrizione.verify_email incompleto');
    const c = verifyEmailContent(p.lang === 'en' ? 'en' : 'it', p.verifyUrl);
    await sendMail({ tenantId: ev.tenantId, to: p.to, subject: c.subject, text: c.text, html: c.html });
  });
}
