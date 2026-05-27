import nodemailer, { type Transporter } from 'nodemailer';
import { eq } from 'drizzle-orm';
import { dbSuper } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { decryptSmtp, isEncryptedSmtp, type SmtpConfigPlain } from './crypto-smtp.js';

type CachedTransporter = {
  transporter: Transporter;
  from: string;
  expiresAt: number;
};

const TRANSPORT_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CachedTransporter>();

// M17: sweep periodico delle entry scadute. Senza, la Map cresce di una entry
// per ogni tenant che invia email e le entry scadute vengono pulite solo
// all'access. unref() evita di tenere vivo l'event loop.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      try { entry.transporter.close(); } catch { /* noop */ }
      cache.delete(key);
    }
  }
}, TRANSPORT_TTL_MS);
sweepTimer.unref?.();

function platformConfig(): SmtpConfigPlain | null {
  if (!env.PLATFORM_SMTP_HOST || !env.PLATFORM_SMTP_USER || !env.PLATFORM_SMTP_PASSWORD) {
    return null;
  }
  return {
    host: env.PLATFORM_SMTP_HOST,
    port: env.PLATFORM_SMTP_PORT ?? 587,
    secure: (env.PLATFORM_SMTP_PORT ?? 587) === 465,
    user: env.PLATFORM_SMTP_USER,
    password: env.PLATFORM_SMTP_PASSWORD,
    from: env.PLATFORM_SMTP_FROM ?? env.PLATFORM_SMTP_USER,
  };
}

async function resolveTenantSmtp(tenantId: string): Promise<SmtpConfigPlain | null> {
  const rows = await dbSuper
    .select({ smtpConfig: tenants.smtpConfig })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const raw = rows[0]?.smtpConfig;
  if (!raw) return null;
  if (isEncryptedSmtp(raw)) {
    try {
      return decryptSmtp(raw);
    } catch (err) {
      logger.error({ module: 'email', tenantId, err: (err as Error).message }, 'decrypt SMTP fallita');
      return null;
    }
  }
  // M16: niente fallback a SMTP in chiaro. Se il campo non è nel formato
  // cifrato {v:1, iv, tag, data} lo consideriamo non valido (un breach del DB
  // non deve esporre credenziali SMTP). Il config va riscritto via UI super-admin
  // (che cifra con encryptSmtp).
  logger.error({ module: 'email', tenantId }, 'SMTP config non cifrato — ignorato (riconfigurare via UI super-admin)');
  return null;
}

async function getTransporter(tenantId: string | null): Promise<{ transporter: Transporter; from: string } | null> {
  const cacheKey = tenantId ?? '__platform__';
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { transporter: cached.transporter, from: cached.from };
  }

  let cfg: SmtpConfigPlain | null = null;
  if (tenantId) {
    cfg = await resolveTenantSmtp(tenantId);
  }
  if (!cfg) cfg = platformConfig();
  if (!cfg) return null;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.password },
  });

  // R15: chiudi il transporter precedente prima di sovrascriverlo. Su refresh TTL
  // l'entry scaduta veniva rimpiazzata senza .close(), lasciando aperto il pool
  // SMTP del vecchio transporter fino alla GC (nodemailer non auto-chiude).
  cache.get(cacheKey)?.transporter.close();

  cache.set(cacheKey, {
    transporter,
    from: cfg.from,
    expiresAt: Date.now() + TRANSPORT_TTL_MS,
  });

  return { transporter, from: cfg.from };
}

export function invalidateTransporter(tenantId?: string | null): void {
  // N132: stessa cache key di getTransporter (`tenantId ?? '__platform__'`).
  // Prima invalidateTransporter usava `tenantId` grezzo: per il transporter
  // platform (tenantId null) la chiave non combaciava con '__platform__' →
  // platform transporter mai invalidabile.
  const cacheKey = tenantId ?? '__platform__';
  // N56: chiudere il transporter PRIMA di rimuoverlo dalla cache, altrimenti
  // la connessione TCP/pool SMTP resta aperta fino al restart (resource leak).
  const entry = cache.get(cacheKey);
  if (entry) {
    try { entry.transporter.close(); } catch { /* best-effort */ }
    cache.delete(cacheKey);
  }
}

export type SendMailArgs = {
  tenantId: string | null;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

export async function sendMail(args: SendMailArgs): Promise<{ messageId: string }> {
  const t = await getTransporter(args.tenantId);
  if (!t) {
    throw new Error(
      args.tenantId
        ? 'SMTP non configurato per questo tenant né a livello platform'
        : 'SMTP platform non configurato',
    );
  }
  const info = await t.transporter.sendMail({
    from: t.from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: args.replyTo,
  });
  return { messageId: info.messageId };
}

/**
 * Verifica la connessione SMTP del tenant senza inviare email reali.
 */
export async function verifyTenantSmtp(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = await getTransporter(tenantId);
    if (!t) return { ok: false, error: 'nessuna configurazione disponibile' };
    await t.transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
