import { expect, type Page } from '@playwright/test';

/**
 * Helper condivisi per i flussi E2E (flows.spec.ts).
 *
 * Strategia: il login avviene via UI (cookie di sessione su HttpOnly cookie);
 * tutte le chiamate API di orchestrazione/cleanup usano `page.evaluate(fetch)`
 * con `credentials: 'include'` così ereditano lo stesso cookie del documento
 * (il proxy Vite preserva l'Host → tenant ente1). Questo evita di duplicare la
 * gestione cookie in un secondo APIRequestContext.
 */

export const ADMIN = { email: 'admin@ente1.test', password: 'Admin123!' };
export const COMMISSARIO = { email: 'commissario@ente1.test', password: 'Demo123!' };

/** Raccoglie le eccezioni JS non gestite emesse dalla pagina. */
export function errorSink(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Logout server-side (invalida la sessione + cancella il cookie). Best-effort:
 * se la pagina non è ancora su un'origine valida (about:blank), prima naviga.
 */
export async function logout(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) {
    await page.goto('/login').catch(() => {});
  }
  await apiFetch(page, '/auth/logout', { method: 'POST' }).catch(() => {});
}

/**
 * Login via UI; aspetta che il router lasci /login.
 *
 * Fa prima un logout server-side: senza, una sessione attiva farebbe
 * redirezionare /login (PublicOnlyRoute → home) e il form non comparirebbe.
 * Questo rende il login robusto anche quando si alterna admin↔commissario nello
 * stesso contesto browser.
 */
export async function login(page: Page, creds: { email: string; password: string }): Promise<void> {
  await logout(page);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

/**
 * Esegue una fetch nel contesto della pagina (cookie di sessione inclusi) e
 * ritorna `{ status, body }`. `body` è il JSON parsato oppure il testo grezzo
 * se non è JSON (es. 204 No Content → null).
 */
export async function apiFetch(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ([p, methodAndBody]) => {
      const hasBody = (methodAndBody as any).body !== undefined;
      const opts: RequestInit = {
        method: (methodAndBody as any).method ?? 'GET',
        credentials: 'include',
        // IMPORTANTE: niente Content-Type quando non c'è body. Fastify rifiuta
        // con 400 una richiesta con content-type application/json ma body vuoto
        // (es. POST /auth/logout, /start, /approve senza payload).
        headers: hasBody ? { 'Content-Type': 'application/json' } : {},
      };
      if (hasBody) {
        opts.body = JSON.stringify((methodAndBody as any).body);
      }
      const res = await fetch(p as string, opts);
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    },
    [path, { method: init?.method, body: init?.body }] as const,
  );
}

/** Id del primo concorso del tenant (seed: "Concorso Solisti 2026"). */
export async function getConcorsoId(page: Page): Promise<string> {
  const { status, body } = await apiFetch(page, '/api/concorsi');
  expect(status, 'GET /api/concorsi').toBe(200);
  expect(Array.isArray(body) && body.length > 0, 'almeno un concorso seedato').toBeTruthy();
  return body[0].id;
}

/** commissarioId legato all'account corrente (da /auth/me). */
export async function getMyCommissarioId(page: Page): Promise<string | null> {
  const { body } = await apiFetch(page, '/auth/me');
  return body?.commissarioId ?? null;
}

/** Prossimo `ordine` libero per una nuova fase del concorso (max+1). */
export async function nextFaseOrdine(page: Page, concorsoId: string): Promise<number> {
  const { body } = await apiFetch(page, `/api/fasi?concorsoId=${concorsoId}&limit=1000`);
  const fasi: Array<{ ordine: number }> = Array.isArray(body) ? body : [];
  return fasi.reduce((m, f) => Math.max(m, f.ordine ?? 0), 0) + 1;
}

/** Marcatore univoco per i record creati dai test (facilita il cleanup). */
export function tag(prefix: string): string {
  return `[E2E-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}]`;
}
